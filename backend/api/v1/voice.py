"""
Voice API — V2 LLM-Orchestrated Voice-First Architecture.

Endpoints:
  POST   /intent        – REST endpoint for text-based intent (LLM-orchestrated)
  WS     /stream        – WebSocket for streaming audio → STT → LLM → Tool → TTS

Flow:
  Audio → Sarvam STT → Sarvam LLM (tool mode) → JSON validation → Tool execution → TTS
  Falls back to keyword matching if Sarvam AI is unreachable.
"""

import json
import uuid
import base64
import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.config import settings
from schemas.api_models import VoiceIntentRequest, VoiceIntentResponse
from services.llm_orchestrator import orchestrate_voice, orchestrate_text
from services.conversation_memory import (
    get_or_create_session,
    delete_session,
)
import httpx

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/intent")
async def process_voice_intent(
    request: VoiceIntentRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    REST endpoint for processing voice/text commands via the LLM orchestrator.
    
    Accepts either:
    - audio_base64: base64-encoded audio for STT → LLM pipeline
    - A text transcript directly (if audio_base64 is empty or "text:<message>")
    """
    session_id = str(uuid.uuid4())
    memory = get_or_create_session(session_id, request.language)

    audio_data = request.audio_base64

    # Check if client is sending text directly (prefixed with "text:")
    if audio_data.startswith("text:"):
        text = audio_data[5:].strip()
        result = await orchestrate_text(text, request.language, memory, db)
    else:
        # Decode base64 audio and run full STT → LLM pipeline
        try:
            audio_bytes = base64.b64decode(audio_data)
        except Exception:
            return {"error": "Invalid base64 audio data"}
        result = await orchestrate_voice(
            audio_bytes,
            request.language,
            memory,
            db,
        )

    # Clean up one-shot session
    delete_session(session_id)

    return result.to_ws_message()


@router.post("/chat")
async def chat_with_llama(request: dict):
    """
    Generic text-chat completion endpoint using Hugging Face Llama 3 Router API (OpenAI compatible).
    """
    hf_token = settings.HF_TOKEN
    if not hf_token:
        raise HTTPException(status_code=500, detail="HF_TOKEN not configured")
    
    HF_LLM_URL = "https://router.huggingface.co/v1/chat/completions"
    HF_LLM_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct"
    
    # Force hospital-only context
    language = request.get("language", "English")
    hospital_system_prompt = (
        f"You are MediKiosk, an AI assistant for AMD General Hospital. "
        f"You must ONLY answer questions related to the hospital, medical services, departments, "
        f"queue status, and patient care. You MUST respond in {language}. "
        f"If the user asks about anything else (like travel, programming, entertainment, general knowledge, etc.), "
        f"politely decline and say you can only help with hospital-related queries."
    )
    
    # Extract messages and remove any client-provided system prompts to prevent jailbreaks
    messages = request.get("messages", [])
    filtered_messages = [m for m in messages if m.get("role") != "system"]
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                HF_LLM_URL,
                headers={
                    "Authorization": f"Bearer {hf_token}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": HF_LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": hospital_system_prompt},
                        *filtered_messages
                    ],
                    "max_tokens": 500,
                    "temperature": 0.7
                }
            )
            response.raise_for_status()
            data = response.json()
            
            # Extract content from choices if present (OpenAI format)
            if "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0]["message"]["content"]
                return {"generated_text": content}
            
            return data
    except Exception as e:
        logger.error("Chat proxy failed: %s", e)
        raise HTTPException(status_code=500, detail=f"HF API error: {str(e)}")


@router.websocket("/stream")
async def websocket_voice_stream(websocket: WebSocket):
    """
    V2 WebSocket for LLM-orchestrated voice streaming.

    Protocol:
    1. Client connects and sends initial config JSON:
       {"type": "config", "language": "Telugu", "session_id": "...", "current_screen": "HOME"}
    
    2. Client sends audio as binary frames OR text commands as JSON:
       Binary: raw audio bytes (WAV/PCM)
       JSON: {"type": "text", "text": "user message", "current_screen": "REGISTRATION"}
    
    3. Server responds with orchestrator results:
       {"type": "orchestrator_result", "status": "...", "command": {...}, ...}
       {"type": "tts_audio", "audio_base64": "..."}
       {"type": "status", "status": "listening|processing|speaking"}
    """
    await websocket.accept()

    session_id = str(uuid.uuid4())
    language = "en"
    current_screen = "HOME"
    workflow_state = "IDLE"
    registration_step = "IDLE"
    pending_question = ""
    memory = get_or_create_session(session_id, language)

    # Get a DB session for this connection
    from core.database import async_session_maker
    from services.workflow_state import cleanup_session_workflows
    
    logger.info("Voice WebSocket connected: session=%s", session_id)

    try:
        while True:
            # Receive either text (JSON) or binary (audio) frames
            message = await websocket.receive()

            if "text" in message:
                # JSON text frame
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "error": "Invalid JSON",
                    }))
                    continue

                msg_type = data.get("type", "")

                # ── Config message (sets language, session, screen) ────
                if msg_type == "config":
                    language = data.get("language", "en")
                    current_screen = data.get("current_screen", current_screen)
                    workflow_state = data.get("workflow_state", workflow_state)
                    registration_step = data.get("registration_step", registration_step)
                    pending_question = data.get("pending_question", pending_question)
                    custom_session = data.get("session_id")
                    if custom_session:
                        delete_session(session_id)
                        session_id = custom_session
                        memory = get_or_create_session(session_id, language)
                    else:
                        memory.language = language

                    await websocket.send_text(json.dumps({
                        "type": "config_ack",
                        "session_id": session_id,
                        "language": language,
                        "current_screen": current_screen,
                    }))
                    continue

                # ── Screen update (lightweight context sync) ──────────
                if msg_type == "screen_update":
                    current_screen = data.get("current_screen", current_screen)
                    workflow_state = data.get("workflow_state", workflow_state)
                    registration_step = data.get("registration_step", registration_step)
                    pending_question = data.get("pending_question", pending_question)
                    continue

                # ── Text command (skip STT) ───────────────────────────
                if msg_type == "text":
                    text = data.get("text", "").strip()
                    # Allow per-message screen override
                    msg_screen = data.get("current_screen", current_screen)
                    if not text:
                        continue

                    # Send processing status
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "status": "processing",
                        "transcript": text,
                    }))

                    # Allow per-message pending_question override
                    msg_pending = data.get("pending_question", pending_question)
                    msg_reg_step = data.get("registration_step", registration_step)

                    async with async_session_maker() as db:
                        result = await orchestrate_text(
                            text, language, memory, db,
                            current_screen=msg_screen,
                            workflow_state=workflow_state,
                            registration_step=msg_reg_step,
                            pending_question=msg_pending,
                        )

                    # Send orchestrator result
                    ws_msg = result.to_ws_message()
                    await websocket.send_text(json.dumps(ws_msg))

                    # Send speaking status with the response message
                    response_msg = result.clarification or (
                        result.tool_result.get("message", "") if result.tool_result else ""
                    )
                    if response_msg:
                        await websocket.send_text(json.dumps({
                            "type": "status",
                            "status": "speaking",
                            "transcript": response_msg,
                        }))

                    # Send TTS audio as binary frame (MP3/WAV bytes)
                    if result.tts_audio:
                        await websocket.send_bytes(result.tts_audio)

                    # Back to idle after a short pause
                    await asyncio.sleep(0.5)
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "status": "idle",
                    }))
                    continue

                # ── Ping/keepalive ────────────────────────────────────
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                    continue

            elif "bytes" in message:
                # ── Binary audio frame ────────────────────────────────
                audio_bytes = message["bytes"]

                if len(audio_bytes) < 100:
                    # Too small to be meaningful audio
                    continue

                # Send processing status
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "status": "processing",
                }))

                async with async_session_maker() as db:
                    result = await orchestrate_voice(
                        audio_bytes, language, memory, db,
                        current_screen=current_screen,
                        workflow_state=workflow_state,
                        registration_step=registration_step,
                        pending_question=pending_question,
                    )

                # Send transcript if we got one
                if result.transcript:
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "status": "processing",
                        "transcript": result.transcript,
                    }))

                # Send orchestrator result
                ws_msg = result.to_ws_message()
                await websocket.send_text(json.dumps(ws_msg))

                # Send speaking status
                response_msg = result.clarification or (
                    result.tool_result.get("message", "") if result.tool_result else ""
                )
                if response_msg:
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "status": "speaking",
                        "transcript": response_msg,
                    }))

                # Send TTS audio as binary frame (MP3/WAV bytes)
                if result.tts_audio:
                    await websocket.send_bytes(result.tts_audio)

                # Back to idle after a short pause
                await asyncio.sleep(0.5)
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "status": "idle",
                }))

    except WebSocketDisconnect:
        logger.info("Voice WebSocket disconnected: session=%s", session_id)
    except Exception as e:
        logger.error("Voice WebSocket error: %s", e, exc_info=True)
    finally:
        delete_session(session_id)
        cleanup_session_workflows(session_id)
        logger.info("Cleaned up session: %s", session_id)
