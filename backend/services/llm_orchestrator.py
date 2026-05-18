"""
LLM Orchestrator — core voice-to-action pipeline.

Location: backend/services/llm_orchestrator.py

Responsibilities:
1. Receive transcript from STT (Whisper via HF Inference API)
2. Build system prompt with language + conversation memory
3. Send to Llama 3 via HF Inference API (tool mode)
4. Validate JSON response
5. Execute selected tool
6. Return structured result

The LLM interprets. The backend executes.
"""

import base64
import json
import logging
import time
from typing import Any, Optional

import httpx

from core.config import settings
from services.json_validator import validate_llm_output, LLMAction
from services.conversation_memory import SessionMemory
from services.fallback_intent import parse_fallback_intent

logger = logging.getLogger(__name__)

# ── Hugging Face Inference API ─────────────────────────────────────────────────

HF_BASE_URL = "https://router.huggingface.co/hf-inference/models"
HF_STT_MODEL = "openai/whisper-large-v3"  # Supports Indic languages
HF_LLM_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct"

HF_STT_URL = f"{HF_BASE_URL}/{HF_STT_MODEL}"
HF_LLM_URL = "https://router.huggingface.co/v1/chat/completions"

# ── Sarvam AI API ─────────────────────────────────────────────────────────────
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"

# Language code mapping (kept for TTS voice descriptions & prompt context)
LANGUAGE_CODES = {
    "Telugu": "te",
    "Hindi": "hi",
    "English": "en",
    "Tamil": "ta",
    "en": "en",
    "te": "te",
    "hi": "hi",
    "ta": "ta",
}

# TTS voice description for indic-parler-tts
TTS_VOICE_DESCRIPTIONS = {
    "te": "A female speaker delivers a calm and clear narration in Telugu.",
    "hi": "A female speaker delivers a calm and clear narration in Hindi.",
    "en": "A female speaker delivers a calm and clear narration in English.",
    "ta": "A female speaker delivers a calm and clear narration in Tamil.",
}

# ── Localized message templates for TTS (tool results are in English, TTS needs native language) ──

_LOCALIZED_MESSAGES: dict[str, dict[str, str]] = {
    "registration_success": {
        "en": "Registration done! Your token is {token}. You are number {position} in {department}. Wait about {wait} minutes.",
        "te": "నమోదు అయింది! మీ టోకెన్ {token}. మీరు {department} లో {position} వ స్థానంలో ఉన్నారు. దాదాపు {wait} నిమిషాలు ఆగండి.",
        "hi": "पंजीकरण हो गया! आपका टोकन {token} है। आप {department} में {position} नंबर पर हैं। लगभग {wait} मिनट इंतजार करें.",
        "ta": "பதிவு முடிந்தது! உங்கள் டோக்கன் {token}. நீங்கள் {department} இல் {position} வது இடத்தில் இருக்கிறீர்கள். சுமார் {wait} நிமிடங்கள் காத்திருங்கள்.",
    },
    "queue_status": {
        "en": "Queue status: {summary}",
        "te": "క్యూ స్థితి: {summary}",
        "hi": "कतार की स्थिति: {summary}",
        "ta": "வரிசை நிலை: {summary}",
    },
    "no_queue": {
        "en": "No patients in queue yet today.",
        "te": "ఈ రోజు ఇంకా క్యూలో ఎవరూ లేరు.",
        "hi": "आज अभी कतार में कोई नहीं है।",
        "ta": "இன்று இன்னும் வரிசையில் யாரும் இல்லை.",
    },
    "directions": {
        "en": "Walk to {to_node}. About {time} minutes walk.",
        "te": "{to_node} కి వెళ్ళండి. దాదాపు {time} నిమిషాలు నడక.",
        "hi": "{to_node} की तरफ जाइए। लगभग {time} मिनट पैदल।",
        "ta": "{to_node} க்கு செல்லுங்கள். சுமார் {time} நிமிடங்கள் நடை.",
    },
    "token_found": {
        "en": "Token {token}: {name} in {department}, position {position}, wait about {wait} minutes.",
        "te": "టోకెన్ {token}: {name}, {department} లో {position} వ స్థానం, దాదాపు {wait} నిమిషాలు ఆగండి.",
        "hi": "टोकन {token}: {name}, {department} में {position} नंबर, लगभग {wait} मिनट इंतजार।",
        "ta": "டோக்கன் {token}: {name}, {department} இல் {position} வது இடம், சுமார் {wait} நிமிடங்கள் காத்திருங்கள்.",
    },
    "token_not_found": {
        "en": "Token {token} not found for today.",
        "te": "టోకెన్ {token} ఈ రోజు కనుగొనబడలేదు.",
        "hi": "टोकन {token} आज नहीं मिला।",
        "ta": "டோக்கன் {token} இன்று கிடைக்கவில்லை.",
    },
    "complaint_success": {
        "en": "Your complaint has been submitted. Our team will look into it.",
        "te": "మీ ఫిర్యాదు నమోదైంది. మా బృందం దానిని పరిశీలిస్తుంది.",
        "hi": "आपकी शिकायत दर्ज हो गई। हमारी टीम इसे देखेगी।",
        "ta": "உங்கள் புகார் சமர்ப்பிக்கப்பட்டது. எங்கள் குழு இதை பார்க்கும்.",
    },
    "navigate": {
        "en": "Going to {screen} screen.",
        "te": "{screen} పేజీకి వెళ్తున్నాము.",
        "hi": "{screen} पेज पर जा रहे हैं।",
        "ta": "{screen} பக்கத்திற்கு செல்கிறோம்.",
    },
    "error_generic": {
        "en": "Sorry, something went wrong. Please try again.",
        "te": "క్షమించండి, ఏదో తప్పు జరిగింది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
        "hi": "माफ कीजिए, कुछ गलत हो गया। कृपया फिर से कोशिश करें।",
        "ta": "மன்னிக்கவும், ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.",
    },
    "form_fill": {
        "en": "I have filled the details for you.",
        "te": "మీ వివరాలు నింపాను.",
        "hi": "मैंने आपकी जानकारी भर दी है।",
        "ta": "உங்கள் விவரங்களை நிரப்பிவிட்டேன்.",
    },
}

# Screen name localization for TTS
_SCREEN_NAMES: dict[str, dict[str, str]] = {
    "HOME": {"en": "Home", "te": "హోమ్", "hi": "होम", "ta": "முகப்பு"},
    "REGISTRATION": {"en": "Registration", "te": "నమోదు", "hi": "पंजीकरण", "ta": "பதிவு"},
    "QUEUE": {"en": "Queue", "te": "క్యూ", "hi": "कतार", "ta": "வரிசை"},
    "NAVIGATION": {"en": "Navigation", "te": "దిశలు", "hi": "दिशा", "ta": "திசை"},
    "COMPLAINT": {"en": "Complaint", "te": "ఫిర్యాదు", "hi": "शिकायत", "ta": "புகார்"},
    "LANGUAGE": {"en": "Language", "te": "భాష", "hi": "भाषा", "ta": "மொழி"},
    "RECEIPT": {"en": "Receipt", "te": "రసీదు", "hi": "रसीद", "ta": "ரசீது"},
    "LAB_TESTS": {"en": "Lab Tests", "te": "లాబ్ పరీక్షలు", "hi": "लैब जांच", "ta": "லேப் சோதனை"},
}


def _localize_message(key: str, language: str, **kwargs: Any) -> str:
    """Get a localized message template and fill in parameters."""
    lang_code = LANGUAGE_CODES.get(language, "en")
    templates = _LOCALIZED_MESSAGES.get(key, {})
    template = templates.get(lang_code, templates.get("en", ""))
    if not template:
        return ""
    try:
        return template.format(**kwargs)
    except (KeyError, IndexError):
        return templates.get("en", "").format(**kwargs) if "en" in templates else ""


def _localize_screen(screen: str, language: str) -> str:
    """Get a localized screen name for TTS."""
    lang_code = LANGUAGE_CODES.get(language, "en")
    names = _SCREEN_NAMES.get(screen.upper(), {})
    return names.get(lang_code, names.get("en", screen))

# ── System Prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT_TEMPLATE = """You are MediKiosk, a friendly hospital helper at a self-service kiosk.
You help patients who may not read well. Speak simply. Be warm and patient like a kind grandparent.

CURRENT LANGUAGE: {language}
You MUST respond in {language}. The "message" field in your JSON MUST be written in {language} script.
If language is Telugu, write message in Telugu (తెలుగు). If Hindi, write in Hindi (हिंदी). If Tamil, write in Tamil (தமிழ்).
NEVER write the message in English when the language is Telugu/Hindi/Tamil.

─── SCREEN & WORKFLOW CONTEXT (Architecture Section 4) ───
CurrentScreen: {current_screen}
AllowedActions: {allowed_actions}
WorkflowState: {workflow_state}
You MUST choose ONLY from the AllowedActions listed above. Any other action will be rejected.

─── CROSS-SCREEN COMMAND RULES ───
Some actions work on ANY screen: navigate_screen, clarify, get_queue_status, get_directions, lookup_token.
If the user says "What is my queue status?" while on LAB_TESTS screen, DO execute get_queue_status — it works everywhere.
If the user says "Find cardiology room" on any screen, DO execute get_directions — it works everywhere.
NEVER ignore a command just because the user is on a different screen.

─── STEP-BY-STEP CONVERSATION FLOW ───
For registration, follow this EXACT sequence (one question per turn):
1. First ask: "What is your mobile number?" (10-digit number, in the patient's language)
2. Then ask: "What is your name?" (in the patient's language)
3. Then ask: "What is your age?" 
4. Then ask: "Which doctor? Heart, Fever, Bone, Child, Eye, Skin, Women, Ear Nose Throat?"
5. Then confirm: "I will register [name], age [age], phone [phone], for [department]. Is that okay?"
6. Only THEN execute register_patient with all collected info INCLUDING phone.

NEVER skip steps. NEVER ask multiple questions at once.
If the user gives name + age + department all at once, still ask for phone if not provided, then go to step 5 (confirm).

IMPORTANT — LOW LITERACY USERS:
- These users may have NEVER used a phone or computer before.
- They may speak incomplete sentences or mix languages.
- They may give vague commands like "I want doctor" / "నాకు డాక్టర్ కావాలి" / "मुझे डॉक्टर चाहिए".
- NEVER use medical/technical words. Use SIMPLE words only.
- Ask ONLY ONE question at a time. Never ask multiple things.
- Keep your messages SHORT — max 1-2 simple sentences.
- ALWAYS confirm before doing anything.

DEPARTMENT SIMPLE NAMES (use these in the user's language, not English medical terms):
- "General Medicine" = "Fever Doctor" / "జ్వరం డాక్టర్" / "बुखार डॉक्टर" / "காய்ச்சல் டாக்டர்"
- "Cardiology" = "Heart Doctor" / "గుండె డాక్టర్" / "दिल डॉक्टर" / "இதய டாக்டர்"
- "Orthopedics" = "Bone Doctor" / "ఎముక డాక్టర్" / "हड्डी डॉक्टर" / "எலும்பு டாக்டர்"
- "Pediatrics" = "Child Doctor" / "పిల్లల డాక్టర్" / "बच्चों का डॉक्टर" / "குழந்தை டாக்டர்"
- "Gynecology" = "Women Doctor" / "మహిళల డాక్టర్" / "महिला डॉक्टर" / "பெண்கள் டாக்டர்"
- "Ophthalmology" = "Eye Doctor" / "కంటి డాక్టర్" / "आंखों का डॉक्टर" / "கண் டாக்டர்"
- "Dermatology" = "Skin Doctor" / "చర్మ డాక్టర్" / "त्वचा डॉक्टर" / "தோல் டாக்டர்"
- "ENT" = "Ear Nose Throat" / "చెవి ముక్కు గొంతు" / "कान नाक गला" / "காது மூக்கு தொண்டை"

INTENT GUESSING (be smart about vague input):
- "I want doctor" / "doctor chahiye" / "డాక్టర్ కావాలి" / "டாக்டர் வேணும்" → Ask (in their language): "Which problem? Heart, Fever, Bone, Child, Eye, Skin?"
- "register" / "new" / "నమోదు" / "पंजीकरण" / "பதிவு" → navigate_screen to REGISTRATION
- "queue" / "waiting" / "ఎంతసేపు" / "kitna time" / "எவ்வளவு நேரம்" → get_queue_status
- "where" / "find" / "ఎక్కడ" / "kahan" / "எங்கே" → Ask: "Which place?"
- "complaint" / "problem" / "సమస్య" / "शिकायत" / "புகார்" → navigate_screen to COMPLAINT
- "token" / "ticket" / "టోకెన్" / "टोकन" / "டோக்கன்" → IF token number given, use lookup_token. ELSE ask: "What is your token number?"
- "I don't know" / "help" → Guide: "You can: Register, Check Queue, Find Room, or Complain"
- If user provides name and age together → start registration, ask for department

You MUST respond ONLY with valid JSON:
{{"action": "tool_name", "parameters": {{...}}, "confidence": "high", "suggestions": ["Heart", "Bone", "Child"]}}

For clarification (message MUST be in {language}) — ALWAYS include already-collected data in parameters:
{{"action": "clarify", "message": "Short simple question in {language}?", "parameters": {{"name": "Rajesh"}}, "confidence": "medium", "suggestions": ["Heart", "Fever", "Bone"]}}
IMPORTANT: When you ask a follow-up question, you MUST include ALL data you have collected so far in the "parameters" field.
Example flow:
  User: "Register"
  You: {{"action": "clarify", "message": "What is your mobile number?", "parameters": {{}}, "confidence": "medium", "suggestions": []}}
  User: "9876543210"
  You: {{"action": "clarify", "message": "What is your name?", "parameters": {{"phone": "9876543210"}}, "confidence": "medium", "suggestions": []}}
  User: "Rajesh"
  You: {{"action": "clarify", "message": "What is your age?", "parameters": {{"phone": "9876543210", "name": "Rajesh"}}, "confidence": "medium", "suggestions": ["30", "45", "60"]}}
  User: "45"
  You: {{"action": "clarify", "message": "Which doctor? Heart, Fever, Bone?", "parameters": {{"phone": "9876543210", "name": "Rajesh", "age": "45"}}, "confidence": "medium", "suggestions": ["Heart", "Fever", "Bone"]}}
  User: "Heart"
  You: {{"action": "clarify", "message": "I will register Rajesh, 45, phone 9876543210, Heart Doctor. OK?", "parameters": {{"phone": "9876543210", "name": "Rajesh", "age": "45", "department": "Cardiology"}}, "confidence": "high", "suggestions": ["Yes", "No"]}}
  User: "Yes"
  You: {{"action": "register_patient", "parameters": {{"phone": "9876543210", "name": "Rajesh", "age": "45", "department": "Cardiology"}}, "confidence": "high"}}
NEVER repeat a question you already asked. Check conversation history AND partial registration state below.

SUGGESTIONS should be in the user's language (1-2 words each).

AVAILABLE TOOLS:
- register_patient: New patient. Needs: phone, name, age, department. Optional: gender, language
- get_queue_status: How long to wait. Optional: department
- get_directions: Find a room. Needs: to_node (where to go)
- lookup_token: Find patient by token number (like "C-003"). Needs: token_number
- submit_complaint: Report a problem. Needs: complaint_text
- upload_receipt: Show receipt page. Needs: registration_id
- upload_lab_scan: Show lab test page
- navigate_screen: Go to a screen (HOME, REGISTRATION, QUEUE, NAVIGATION, COMPLAINT, LANGUAGE, RECEIPT, LAB_TESTS)
- batch_fill_form: Fill multiple form fields at once. Needs: target (form name), fields (dict)
- trigger_button: Click a UI button. Needs: button_id

PARTIAL REGISTRATION STATE:
{partial_registration}

─── CURRENT QUESTION CONTEXT ───
RegistrationStep: {registration_step}
PendingQuestion: {pending_question}
CRITICAL: If PendingQuestion is not empty, the user's LAST message is the ANSWER to that question.
Treat it as the value for the corresponding registration field. Do NOT ask the same question again.
For example, if PendingQuestion is "What is your name?" and user says "Lucky", then name="Lucky".
If PendingQuestion is "What is your age?" and user says "18" or "eighteen", then age="18".

RULES:
- NEVER give medical advice or diagnose
- NEVER prescribe medicine
- Be warm, kind, and reassuring
- Ask only ONE question at a time
- Message field MUST be in {language} (Telugu/Hindi/Tamil/English)
- ALWAYS confirm before executing: "I will do X. Is that okay?" (in user's language)
- If not enough info, use "clarify" with a simple question
- Only output valid JSON
- For registration: collect name, age, department (minimum)
- Use simple words the patient understands
- Only choose from AllowedActions, never use actions outside that list
"""


async def _build_system_prompt(
    language: str,
    memory: SessionMemory,
    current_screen: str = "HOME",
    workflow_state: str = "IDLE",
    registration_step: str = "IDLE",
    pending_question: str = "",
) -> str:
    """Build the system prompt with current screen context, workflow state, and allowed actions."""
    from services.screen_capabilities import get_allowed_actions

    partial = memory.get_registration_fields()
    partial_str = json.dumps(partial) if partial else "{}"
    
    # Build a human-readable summary of what's been collected so the LLM doesn't re-ask
    collected_parts = []
    if partial.get("name"):
        collected_parts.append(f"Name: {partial['name']}")
    if partial.get("age"):
        collected_parts.append(f"Age: {partial['age']}")
    if partial.get("department"):
        collected_parts.append(f"Department: {partial['department']}")
    if partial.get("gender"):
        collected_parts.append(f"Gender: {partial['gender']}")
    if partial.get("phone"):
        collected_parts.append(f"Phone: {partial['phone']}")
    
    if collected_parts:
        partial_str += f"\nALREADY COLLECTED (DO NOT ask for these again): {', '.join(collected_parts)}"
    
    # Include clarification state from memory if available but not already tracked
    effective_pending = pending_question
    if not effective_pending and memory.clarification_state:
        effective_pending = memory.clarification_state.get("message", "")
    
    allowed = get_allowed_actions(current_screen)
    
    base_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        language=language,
        partial_registration=partial_str,
        current_screen=current_screen,
        allowed_actions=json.dumps(allowed),
        workflow_state=workflow_state,
        registration_step=registration_step,
        pending_question=effective_pending,
    )
    
    # The system prompt already instructs the LLM to respond in the target language.
    # No translation step is needed — the Llama 3 model handles multilingual output.
    return base_prompt


# ── Hugging Face STT (Whisper) ────────────────────────────────────────────────


import io
import pydub

# Configure ffmpeg path if provided in settings
if settings.FFMPEG_PATH:
    pydub.AudioSegment.converter = settings.FFMPEG_PATH

async def transcribe_audio(
    audio_bytes: bytes,
    language: str = "en",
) -> tuple[Optional[str], Optional[str]]:
    """
    Convert audio to WAV and send to HF Whisper Inference API.
    Returns (transcript, error_message).
    """
    hf_token = settings.HF_TOKEN
    if not hf_token:
        logger.warning("HF_TOKEN not set — STT unavailable")
        return None, "HF_TOKEN is missing. Please check backend configuration."
        
    try:
        # Convert webm to WAV format for Whisper
        audio = pydub.AudioSegment.from_file(io.BytesIO(audio_bytes))
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_bytes = wav_io.getvalue()
    except Exception as e:
        logger.error("Audio conversion failed: %s", e)
        # Fallback to original bytes if conversion fails
        wav_bytes = audio_bytes

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            # HF Inference API for ASR: send raw audio bytes
            response = await client.post(
                HF_STT_URL,
                headers={
                    "Authorization": f"Bearer {hf_token}",
                    "Content-Type": "audio/wav",
                },
                content=wav_bytes,
            )
            
            # Handle model loading (cold start) — HF returns 503 while loading
            if response.status_code == 503:
                body = response.json()
                wait_time = body.get("estimated_time", 20)
                logger.info("STT model loading, estimated wait: %.1fs", wait_time)
                import asyncio
                await asyncio.sleep(min(wait_time, 30))
                # Retry once
                response = await client.post(
                    HF_STT_URL,
                    headers={
                        "Authorization": f"Bearer {hf_token}",
                        "Content-Type": "audio/wav",
                    },
                    content=wav_bytes,
                )
            
            response.raise_for_status()
            result = response.json()
            
            # HF Whisper returns {"text": "transcribed text"}
            transcript = result.get("text", "").strip()
            
            if not transcript:
                return None, "Audio was too short or unclear to transcribe."
                 
            logger.info("STT transcript: %s", transcript[:100])
            return transcript, None
            
    except httpx.HTTPStatusError as e:
        error_details = e.response.text[:200]
        logger.error("HF STT HTTP error: %s %s", e.response.status_code, error_details)
        if e.response.status_code == 401:
            return None, "STT API Authentication failed (401). Check HF_TOKEN."
        elif e.response.status_code == 429:
            return None, "STT API Rate limited (429). Too many requests."
        return None, f"STT API HTTP Error {e.response.status_code}: {error_details}"
    except httpx.TimeoutException:
        logger.error("HF STT Timeout")
        return None, "STT Connection timed out. Please try speaking again."
    except Exception as e:
        logger.error("HF STT failed: %s", e)
        return None, f"STT Unexpected error: {str(e)}"


# ── Hugging Face LLM (Meta-Llama-3-8B-Instruct) ─────────────────────────────


def _format_llama3_prompt(system_prompt: str, messages: list[dict], user_text: str) -> str:
    """
    Format conversation into Llama 3 Instruct chat template.
    
    Template:
    <|begin_of_text|><|start_header_id|>system<|end_header_id|>
    {system}<|eot_id|><|start_header_id|>user<|end_header_id|>
    {user}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
    """
    parts = [f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|>"]
    
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        parts.append(f"<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>")
    
    parts.append(f"<|start_header_id|>user<|end_header_id|>\n\n{user_text}<|eot_id|>")
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    
    return "".join(parts)


async def call_llm(
    transcript: str,
    language: str,
    memory: SessionMemory,
    current_screen: str = "HOME",
    workflow_state: str = "IDLE",
    registration_step: str = "IDLE",
    pending_question: str = "",
) -> Optional[str]:
    """
    Send the transcript + context to Llama 3 via HF Inference API.
    Returns the raw LLM output string, or None if the call fails.
    """
    hf_token = settings.HF_TOKEN
    if not hf_token:
        logger.warning("HF_TOKEN not set — LLM unavailable")
        return None

    system_prompt = await _build_system_prompt(language, memory, current_screen, workflow_state, registration_step, pending_question)
    
    # Build conversation history for Llama 3 prompt
    history_messages = memory.get_history_for_prompt()
    prompt = _format_llama3_prompt(system_prompt, history_messages, transcript)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                HF_LLM_URL,
                headers={
                    "Authorization": f"Bearer {hf_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": HF_LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        *history_messages,
                        {"role": "user", "content": transcript}
                    ],
                    "max_tokens": 500,
                    "temperature": 0.1,
                },
            )
            
            # (Cold start logic simplified as router handles it better)
            response.raise_for_status()
            result = response.json()
            
            # Router Chat API returns {"choices": [{"message": {"content": "..."}}]}
            if "choices" in result and len(result["choices"]) > 0:
                content = result["choices"][0]["message"]["content"].strip()
            # Fallback for old direct model response format if it ever happens
            elif isinstance(result, list) and len(result) > 0:
                content = result[0].get("generated_text", "").strip()
            elif isinstance(result, dict):
                content = result.get("generated_text", "").strip()
            else:
                logger.warning("LLM returned unexpected format: %s", type(result))
                return None
            
            if not content:
                logger.warning("LLM returned empty content")
                return None
            
            logger.info("LLM raw output: %s", content[:200])
            return content
            
    except httpx.HTTPStatusError as e:
        logger.error("HF LLM HTTP error: %s %s", e.response.status_code, e.response.text[:200])
        return None
    except Exception as e:
        logger.error("HF LLM failed: %s", e)
        return None


# ── Hugging Face TTS (ai4bharat/indic-parler-tts) ────────────────────────────


async def synthesize_speech(
    text: str,
    language: str = "en",
) -> Optional[bytes]:
    """
    Send text to Sarvam AI TTS and return audio bytes (WAV).
    Returns None if TTS fails.
    """
    sarvam_key = settings.SARVAM_API_KEY
    if not sarvam_key:
        logger.error("SARVAM_API_KEY not configured")
        return None

    lang_code = LANGUAGE_CODES.get(language, "en")
    
    # Sarvam expects BCP-47 codes like 'en-IN', 'te-IN', etc.
    sarvam_lang_map = {
        "en": "en-IN",
        "te": "te-IN",
        "hi": "hi-IN",
        "ta": "ta-IN"
    }
    target_lang = sarvam_lang_map.get(lang_code, "en-IN")

    # Pick best speaker per language for clarity
    # Only these speakers are compatible with bulbul:v2:
    # anushka, abhilash, manisha, vidya, arya, karun, hitesh
    speaker_map = {
        "te-IN": "arya",
        "hi-IN": "arya",
        "ta-IN": "arya",
        "en-IN": "arya",
    }
    speaker = speaker_map.get(target_lang, "arya")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                SARVAM_TTS_URL,
                headers={
                    "api-subscription-key": sarvam_key,
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "target_language_code": target_lang,
                    "speaker": speaker,
                    "model": "bulbul:v2",
                    "speech_sample_rate": 22050,
                    "enable_preprocessing": True,
                },
            )
            
            response.raise_for_status()
            
            # Sarvam returns JSON with base64 encoded audio in 'audios' list
            data = response.json()
            audios = data.get("audios", [])
            
            if audios and len(audios) > 0:
                audio_base64 = audios[0]
                audio_bytes = base64.b64decode(audio_base64)
                logger.info("Sarvam TTS generated %d bytes of audio", len(audio_bytes))
                return audio_bytes
            
            logger.warning("Sarvam TTS returned empty audio list")
            return None
    except Exception as e:
        logger.error("Sarvam TTS failed: %s", e)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  AUDIT LOGGING (Section 11 — Safety Controls)
# ═══════════════════════════════════════════════════════════════════════════════


def _audit_log(event: str, data: dict) -> None:
    """
    Structured audit log for all voice/text interactions.
    In production this would write to a durable audit store.
    """
    logger.info("[AUDIT] %s | %s", event, json.dumps(data, default=str)[:500])


# ═══════════════════════════════════════════════════════════════════════════════
#  REGISTRATION FIELD PRE-PROCESSOR (bypass LLM for clear field answers)
# ═══════════════════════════════════════════════════════════════════════════════

import re as _re

_STEP_TO_FIELD: dict[str, str] = {
    "MOBILE": "phone",
    "NAME": "name",
    "AGE": "age",
    "GENDER": "gender",
    "DEPARTMENT": "department",
}

# Multilingual prompts for each NEXT field to ask
_REG_NEXT_PROMPTS: dict[str, dict[str, str]] = {
    "phone": {
        "English": "What is your mobile number?",
        "Hindi": "आपका मोबाइल नंबर क्या है?",
        "Telugu": "మీ మొబైల్ నంబర్ ఏమిటి?",
        "Tamil": "உங்கள் மொபைல் எண் என்ன?",
        "en": "What is your mobile number?",
        "hi": "आपका मोबाइल नंबर क्या है?",
        "te": "మీ మొబైల్ నంబర్ ఏమిటి?",
        "ta": "உங்கள் மொபைல் எண் என்ன?",
    },
    "name": {
        "English": "What is your name?",
        "Hindi": "आपका नाम क्या है?",
        "Telugu": "మీ పేరు ఏమిటి?",
        "Tamil": "உங்கள் பெயர் என்ன?",
        "en": "What is your name?",
        "hi": "आपका नाम क्या है?",
        "te": "మీ పేరు ఏమిటి?",
        "ta": "உங்கள் பெயர் என்ன?",
    },
    "age": {
        "English": "What is your age?",
        "Hindi": "आपकी उम्र क्या है?",
        "Telugu": "మీ వయస్సు ఎంత?",
        "Tamil": "உங்கள் வயது என்ன?",
        "en": "What is your age?",
        "hi": "आपकी उम्र क्या है?",
        "te": "మీ వయస్సు ఎంత?",
        "ta": "உங்கள் வயது என்ன?",
    },
    "department": {
        "English": "Which doctor? Heart, Fever, Bone, Child, Eye, Skin?",
        "Hindi": "कौन सा डॉक्टर? दिल, बुखार, हड्डी, बच्चा, आंख, त्वचा?",
        "Telugu": "ఏ డాక్టర్? గుండె, జ్వరం, ఎముక, పిల్లల, కంటి, చర్మ?",
        "Tamil": "எந்த டாக்டர்? இதயம், காய்ச்சல், எலும்பு, குழந்தை, கண், தோல்?",
        "en": "Which doctor? Heart, Fever, Bone, Child, Eye, Skin?",
        "hi": "कौन सा डॉक्टर? दिल, बुखार, हड्डी, बच्चा, आंख, त्वचा?",
        "te": "ఏ డాక్టర్? గుండె, జ్వరం, ఎముక, పిల్లల, కంటి, చర్మ?",
        "ta": "எந்த டாக்டர்? இதயம், காய்ச்சல், எலும்பு, குழந்தை, கண், தோல்?",
    },
}

_DEPT_KEYWORDS: dict[str, str] = {
    "heart": "Cardiology", "cardiac": "Cardiology", "cardiology": "Cardiology", "chest": "Cardiology",
    "fever": "General Medicine", "general": "General Medicine", "cold": "General Medicine", "cough": "General Medicine",
    "bone": "Orthopedics", "ortho": "Orthopedics", "fracture": "Orthopedics", "joint": "Orthopedics",
    "child": "Pediatrics", "baby": "Pediatrics", "kid": "Pediatrics", "pediatrics": "Pediatrics",
    "eye": "Ophthalmology", "vision": "Ophthalmology", "ophthalmology": "Ophthalmology",
    "skin": "Dermatology", "rash": "Dermatology", "dermatology": "Dermatology",
    "ear": "ENT", "nose": "ENT", "throat": "ENT", "ent": "ENT",
    "women": "Gynecology", "pregnancy": "Gynecology", "gynecology": "Gynecology",
    "brain": "Neurology", "neuro": "Neurology", "headache": "Neurology",
}


def _get_next_reg_prompt(partial: dict[str, Any], language: str) -> tuple[Optional[str], list[str]]:
    """
    Based on which registration fields are already collected,
    return (next_question, suggestions) or (None, []) if all fields ready for confirmation.
    """
    field_order = ["phone", "name", "age", "department"]
    for field in field_order:
        if not partial.get(field):
            prompts = _REG_NEXT_PROMPTS.get(field, {})
            msg = prompts.get(language, prompts.get("English", f"Please provide your {field}."))
            suggestions = []
            if field == "department":
                suggestions = ["Heart", "Fever", "Bone", "Child", "Eye", "Skin"]
            elif field == "age":
                suggestions = ["25", "35", "45", "60"]
            return msg, suggestions
    return None, []


async def _try_extract_registration_field(
    transcript: str,
    language: str,
    memory: SessionMemory,
    registration_step: str,
    pending_question: str,
) -> "Optional[OrchestratorResult]":
    """
    Try to extract a registration field value directly from the transcript
    when we're mid-registration flow. Bypasses the LLM for clear, unambiguous answers
    like phone numbers, ages, names, departments.
    Returns None if extraction fails (falls through to LLM).
    """
    if not registration_step or registration_step in ("IDLE", "CONFIRM", "SUBMITTED"):
        return None

    field = _STEP_TO_FIELD.get(registration_step)
    if not field:
        return None

    lower = transcript.lower().strip()
    digits_only = _re.sub(r"\D", "", transcript)
    extracted_value = None

    if field == "phone":
        if len(digits_only) >= 10:
            phone = digits_only[-10:]
            if _re.match(r"[6-9]\d{9}", phone):
                extracted_value = phone

    elif field == "name":
        name = transcript.strip()
        # Remove common prefixes like "my name is ..."
        name = _re.sub(
            r"^(?:my name is|i am|this is|name is|i'm|mera naam|naa peru|en peyar)\s*",
            "", name, flags=_re.IGNORECASE,
        ).strip()
        # Keep only letters (Latin, Devanagari, Telugu, Tamil) + spaces + dots
        name = _re.sub(r"[^a-zA-Z\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF\s.]", "", name).strip()
        if name and 1 < len(name) < 100:
            extracted_value = name

    elif field == "age":
        age_match = _re.search(r"\d{1,3}", transcript)
        if age_match:
            age_val = int(age_match.group())
            if 0 < age_val < 150:
                extracted_value = str(age_val)

    elif field == "gender":
        gender_map = {
            "male": "Male", "man": "Male", "boy": "Male",
            "female": "Female", "woman": "Female", "girl": "Female",
            "other": "Other",
        }
        for kw, gv in gender_map.items():
            if kw in lower:
                extracted_value = gv
                break

    elif field == "department":
        for kw, dept in _DEPT_KEYWORDS.items():
            if kw in lower:
                extracted_value = dept
                break

    if not extracted_value:
        return None

    logger.info(
        "Registration pre-processor: step=%s, field=%s, value=%s (bypassing LLM)",
        registration_step, field, extracted_value,
    )

    # Update partial registration in session memory
    memory.update_partial_registration({field: extracted_value})
    partial = memory.get_registration_fields()

    # Determine next question or confirmation
    next_question, suggestions = _get_next_reg_prompt(partial, language)

    if next_question:
        # Still collecting fields → return clarification with next question
        tts_audio = await synthesize_speech(next_question, language)
        memory.add_exchange(user_text=transcript, action="clarify", system_response=next_question)
        memory.set_clarification({"pending": True, "message": next_question})

        result = OrchestratorResult(
            transcript=transcript,
            action="clarify",
            clarification=next_question,
            tts_audio=tts_audio,
        )
        result.confidence = "high"
        result.suggestions = suggestions
        _audit_log("reg_field_extracted", {"field": field, "value": extracted_value, "next": next_question})
        return result
    else:
        # All fields collected → generate confirmation prompt
        name = partial.get("name", "Patient")
        age = partial.get("age", "?")
        phone = partial.get("phone", "?")
        dept = partial.get("department", "?")

        # Build confirmation in user's language
        confirm_templates = {
            "English": f"I will register {name}, age {age}, phone {phone}, for {dept} doctor. Is that OK?",
            "Hindi": f"मैं {name}, उम्र {age}, फ़ोन {phone}, {dept} डॉक्टर के लिए रजिस्टर करूंगी। ठीक है?",
            "Telugu": f"నేను {name}, వయస్సు {age}, ఫోన్ {phone}, {dept} డాక్టర్ కోసం నమోదు చేస్తాను. సరేనా?",
            "Tamil": f"நான் {name}, வயது {age}, போன் {phone}, {dept} டாக்டருக்கு பதிவு செய்கிறேன். சரியா?",
            "en": f"I will register {name}, age {age}, phone {phone}, for {dept} doctor. Is that OK?",
            "hi": f"मैं {name}, उम्र {age}, फ़ोन {phone}, {dept} डॉक्टर के लिए रजिस्टर करूंगी। ठीक है?",
            "te": f"నేను {name}, వయస్సు {age}, ఫోన్ {phone}, {dept} డాక్టర్ కోసం నమోదు చేస్తాను. సరేనా?",
            "ta": f"நான் {name}, வயது {age}, போன் {phone}, {dept} டாக்டருக்கு பதிவு செய்கிறேன். சரியா?",
        }
        confirm_msg = confirm_templates.get(language, confirm_templates["English"])

        tts_audio = await synthesize_speech(confirm_msg, language)
        memory.add_exchange(user_text=transcript, action="clarify", system_response=confirm_msg)
        memory.set_clarification({"pending": True, "message": confirm_msg})

        result = OrchestratorResult(
            transcript=transcript,
            action="clarify",
            clarification=confirm_msg,
            tts_audio=tts_audio,
        )
        result.confidence = "high"
        result.suggestions = ["Yes", "No"]
        _audit_log("reg_all_fields_collected", {"partial": partial})
        return result


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN ORCHESTRATION PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════


class OrchestratorResult:
    """The final result of the orchestration pipeline."""

    def __init__(
        self,
        transcript: Optional[str] = None,
        action: Optional[str] = None,
        tool_result: Optional[dict] = None,
        clarification: Optional[str] = None,
        tts_audio: Optional[bytes] = None,
        navigate_to: Optional[str] = None,
        is_fallback: bool = False,
        error: Optional[str] = None,
        command_envelope: Optional[dict] = None,
    ):
        self.transcript = transcript
        self.action = action
        self.tool_result = tool_result
        self.clarification = clarification
        self.tts_audio = tts_audio
        self.navigate_to = navigate_to
        self.is_fallback = is_fallback
        self.error = error
        self.confidence = None
        self.suggestions = []
        self.command_envelope = command_envelope

    def to_ws_message(self) -> dict[str, Any]:
        """Convert to a WebSocket JSON message for the frontend."""
        msg: dict[str, Any] = {
            "type": "orchestrator_result",
            "transcript": self.transcript or "",
        }

        if self.error:
            msg["status"] = "error"
            msg["error"] = self.error
            return msg

        if self.clarification:
            msg["status"] = "clarification"
            msg["message"] = self.clarification
            msg["action"] = "clarify"
            if self.confidence:
                msg["confidence"] = self.confidence
            if self.suggestions:
                msg["suggestions"] = self.suggestions
            return msg

        msg["status"] = "action_complete"
        msg["action"] = self.action or ""
        msg["is_fallback"] = self.is_fallback
        
        if self.tool_result:
            msg["result"] = self.tool_result
            
        if self.navigate_to:
            msg["navigate_to"] = self.navigate_to

        if self.tool_result and self.tool_result.get("message"):
            msg["message"] = self.tool_result["message"]
            
        if self.confidence:
            msg["confidence"] = self.confidence
        if self.suggestions:
            msg["suggestions"] = self.suggestions
        if self.command_envelope:
            msg["command"] = self.command_envelope

        return msg


async def orchestrate_voice(
    audio_bytes: bytes,
    language: str,
    memory: SessionMemory,
    db: Any,
    current_screen: str = "HOME",
    workflow_state: str = "IDLE",
    registration_step: str = "IDLE",
    pending_question: str = "",
) -> OrchestratorResult:
    """
    Full voice → action pipeline (Architecture Section 3):
    1. STT (Whisper via HF)
    2. LLM Tool Selection (Llama 3 via HF) — with screen context & allowed actions
    3. JSON Validation
    4. Screen Capability Check
    5. Tool Execution
    6. Command Envelope Generation
    7. TTS (indic-parler-tts via HF)
    
    Falls back to keyword matching if HF is unreachable.
    """
    from services.llm_tools import execute_tool
    from services.command_engine import build_command
    from services.screen_capabilities import is_action_allowed

    _audit_log("voice_start", {"language": language, "screen": current_screen})

    # ── Step 1: Speech-to-Text ────────────────────────────────────────────
    transcript, error_msg = await transcribe_audio(audio_bytes, language)
    
    if not transcript:
        return OrchestratorResult(
            error=error_msg or "Could not transcribe audio. Please try again.",
        )

    # ── Step 1.5: Registration field pre-processor (bypass LLM for clear answers) ──
    reg_result = await _try_extract_registration_field(
        transcript, language, memory, registration_step, pending_question,
    )
    if reg_result:
        return reg_result

    # ── Step 2: LLM Tool Selection ───────────────────────────────────────
    llm_output = await call_llm(transcript, language, memory, current_screen, workflow_state, registration_step, pending_question)

    if not llm_output:
        # Sarvam LLM unavailable — use fallback (Section 11)
        logger.warning("LLM unavailable, using fallback intent parser")
        fallback_action = parse_fallback_intent(transcript)
        
        if fallback_action:
            tool_result = await execute_tool(
                fallback_action.action,
                fallback_action.parameters,
                db,
            )
            memory.add_exchange(
                user_text=transcript,
                action=fallback_action.action,
                system_response=tool_result.message,
            )
            envelope, _ = build_command(fallback_action.action, tool_result.to_dict(), current_screen)
            _audit_log("fallback_action", {"action": fallback_action.action, "transcript": transcript})
            return OrchestratorResult(
                transcript=transcript,
                action=fallback_action.action,
                tool_result=tool_result.to_dict(),
                navigate_to=tool_result.navigate_to,
                is_fallback=True,
                command_envelope=envelope.to_dict() if envelope else None,
            )
        else:
            return OrchestratorResult(
                transcript=transcript,
                error="I'm sorry, I couldn't understand that. Please try using the touch screen.",
                is_fallback=True,
            )

    # ── Step 3: JSON Validation (Section 5) ──────────────────────────────
    validation = validate_llm_output(llm_output)

    if not validation.success:
        logger.warning("LLM output validation failed: %s", validation.error)
        fallback_action = parse_fallback_intent(transcript)
        if fallback_action:
            tool_result = await execute_tool(
                fallback_action.action,
                fallback_action.parameters,
                db,
            )
            memory.add_exchange(
                user_text=transcript,
                action=fallback_action.action,
                system_response=tool_result.message,
            )
            envelope, _ = build_command(fallback_action.action, tool_result.to_dict(), current_screen)
            return OrchestratorResult(
                transcript=transcript,
                action=fallback_action.action,
                tool_result=tool_result.to_dict(),
                navigate_to=tool_result.navigate_to,
                is_fallback=True,
                command_envelope=envelope.to_dict() if envelope else None,
            )
        return OrchestratorResult(
            transcript=transcript,
            error="I had trouble understanding. Could you please rephrase?",
        )

    action = validation.action
    assert action is not None  # guaranteed by validation.success

    # ── Step 3b: Screen Capability Check (Section 11) ────────────────────
    if not is_action_allowed(current_screen, action.action):
        logger.warning(
            "Action '%s' rejected: not allowed on screen '%s'",
            action.action, current_screen,
        )
        _audit_log("action_rejected", {"action": action.action, "screen": current_screen})
        return OrchestratorResult(
            transcript=transcript,
            error=f"That action is not available on this screen. Please navigate to the right screen first.",
        )

    # ── Step 4: Handle clarification ─────────────────────────────────────
    if action.action == "clarify":
        # Save any partial parameters the LLM included (e.g. collected name/age)
        if action.parameters:
            memory.update_partial_registration(action.parameters)
        memory.add_exchange(
            user_text=transcript,
            action="clarify",
            system_response=action.message,
        )
        memory.set_clarification({"pending": True, "message": action.message})

        # ── Clarification loop guard (max 2 repeats of same question) ────
        if memory.should_stop_clarifying():
            logger.warning("Clarification loop detected (count=%d), sending manual input prompt", memory.clarification_count)
            fallback_msg = "I'm having trouble understanding. Please type your answer on the screen."
            tts_audio = await synthesize_speech(fallback_msg, language)
            memory.clear_clarification()
            result = OrchestratorResult(
                transcript=transcript,
                action="clarify",
                clarification=fallback_msg,
                tts_audio=tts_audio,
            )
            result.confidence = "low"
            result.suggestions = []
            return result

        tts_audio = await synthesize_speech(action.message or "", language)

        result = OrchestratorResult(
            transcript=transcript,
            action="clarify",
            clarification=action.message,
            tts_audio=tts_audio,
        )
        result.confidence = action.confidence
        result.suggestions = action.suggestions
        return result

    # ── Step 5: Tool Execution (Section 6) ───────────────────────────────
    memory.clear_clarification()
    
    if action.action == "register_patient":
        memory.update_partial_registration(action.parameters)

    tool_result = await execute_tool(action.action, action.parameters, db)

    memory.add_exchange(
        user_text=transcript,
        action=action.action,
        system_response=tool_result.message,
    )

    # ── Step 6: Command Envelope (Section 7) ─────────────────────────────
    envelope, cmd_error = build_command(action.action, tool_result.to_dict(), current_screen)
    if cmd_error:
        logger.warning("Command envelope build failed: %s", cmd_error)

    _audit_log("tool_executed", {
        "action": action.action,
        "success": tool_result.success,
        "screen": current_screen,
    })

    # ── Step 7: TTS ──────────────────────────────────────────────────────
    # Use localized message for TTS if available; otherwise use English message
    tts_text = tool_result.message
    if tool_result.localization_key:
        localized = _localize_message(
            tool_result.localization_key, language, **tool_result.localization_params
        )
        if localized:
            tts_text = localized
    tts_audio = await synthesize_speech(tts_text, language)

    result = OrchestratorResult(
        transcript=transcript,
        action=action.action,
        tool_result=tool_result.to_dict(),
        tts_audio=tts_audio,
        navigate_to=tool_result.navigate_to,
        command_envelope=envelope.to_dict() if envelope else None,
    )
    result.confidence = action.confidence
    result.suggestions = action.suggestions
    return result


async def orchestrate_text(
    text: str,
    language: str,
    memory: SessionMemory,
    db: Any,
    current_screen: str = "HOME",
    workflow_state: str = "IDLE",
    registration_step: str = "IDLE",
    pending_question: str = "",
) -> OrchestratorResult:
    """
    Text-based orchestration (skips STT).
    Used when the frontend sends pre-transcribed text.
    Follows same pipeline as orchestrate_voice minus the STT step.
    """
    from services.llm_tools import execute_tool
    from services.command_engine import build_command
    from services.screen_capabilities import is_action_allowed

    _audit_log("text_start", {"text": text[:100], "language": language, "screen": current_screen})

    # ── Registration field pre-processor (bypass LLM for clear answers) ──
    reg_result = await _try_extract_registration_field(
        text, language, memory, registration_step, pending_question,
    )
    if reg_result:
        return reg_result

    # ── LLM Tool Selection ───────────────────────────────────────────────
    llm_output = await call_llm(text, language, memory, current_screen, workflow_state, registration_step, pending_question)

    if not llm_output:
        fallback_action = parse_fallback_intent(text)
        if fallback_action:
            tool_result = await execute_tool(
                fallback_action.action,
                fallback_action.parameters,
                db,
            )
            memory.add_exchange(
                user_text=text,
                action=fallback_action.action,
                system_response=tool_result.message,
            )
            envelope, _ = build_command(fallback_action.action, tool_result.to_dict(), current_screen)
            return OrchestratorResult(
                transcript=text,
                action=fallback_action.action,
                tool_result=tool_result.to_dict(),
                navigate_to=tool_result.navigate_to,
                is_fallback=True,
                command_envelope=envelope.to_dict() if envelope else None,
            )
        return OrchestratorResult(
            transcript=text,
            error="I'm sorry, I couldn't understand that.",
            is_fallback=True,
        )

    validation = validate_llm_output(llm_output)

    if not validation.success:
        fallback_action = parse_fallback_intent(text)
        if fallback_action:
            tool_result = await execute_tool(
                fallback_action.action,
                fallback_action.parameters,
                db,
            )
            memory.add_exchange(
                user_text=text,
                action=fallback_action.action,
                system_response=tool_result.message,
            )
            envelope, _ = build_command(fallback_action.action, tool_result.to_dict(), current_screen)
            return OrchestratorResult(
                transcript=text,
                action=fallback_action.action,
                tool_result=tool_result.to_dict(),
                navigate_to=tool_result.navigate_to,
                is_fallback=True,
                command_envelope=envelope.to_dict() if envelope else None,
            )
        return OrchestratorResult(
            transcript=text,
            error="I had trouble understanding. Could you please rephrase?",
        )

    action = validation.action
    assert action is not None

    # Screen capability check
    if not is_action_allowed(current_screen, action.action):
        logger.warning("Action '%s' rejected on screen '%s'", action.action, current_screen)
        _audit_log("action_rejected", {"action": action.action, "screen": current_screen})
        return OrchestratorResult(
            transcript=text,
            error="That action is not available on this screen.",
        )

    if action.action == "clarify":
        # Save any partial parameters the LLM included (e.g. collected name/age)
        if action.parameters:
            memory.update_partial_registration(action.parameters)
        memory.add_exchange(
            user_text=text,
            action="clarify",
            system_response=action.message,
        )
        memory.set_clarification({"pending": True, "message": action.message})

        # ── Clarification loop guard (max 2 repeats of same question) ────
        if memory.should_stop_clarifying():
            logger.warning("Clarification loop detected in text mode (count=%d)", memory.clarification_count)
            fallback_msg = "I'm having trouble understanding. Please type your answer on the screen."
            tts_audio = await synthesize_speech(fallback_msg, language)
            memory.clear_clarification()
            result = OrchestratorResult(
                transcript=text,
                action="clarify",
                clarification=fallback_msg,
                tts_audio=tts_audio,
            )
            result.confidence = "low"
            result.suggestions = []
            return result

        tts_audio = await synthesize_speech(action.message or "", language)
        result = OrchestratorResult(
            transcript=text,
            action="clarify",
            clarification=action.message,
            tts_audio=tts_audio,
        )
        result.confidence = action.confidence
        result.suggestions = action.suggestions
        return result

    memory.clear_clarification()
    if action.action == "register_patient":
        memory.update_partial_registration(action.parameters)

    tool_result = await execute_tool(action.action, action.parameters, db)
    memory.add_exchange(
        user_text=text,
        action=action.action,
        system_response=tool_result.message,
    )

    # Command Envelope
    envelope, cmd_error = build_command(action.action, tool_result.to_dict(), current_screen)
    if cmd_error:
        logger.warning("Command envelope build failed: %s", cmd_error)

    _audit_log("tool_executed", {
        "action": action.action,
        "success": tool_result.success,
        "screen": current_screen,
    })

    # Use localized message for TTS if available
    tts_text = tool_result.message
    if tool_result.localization_key:
        localized = _localize_message(
            tool_result.localization_key, language, **tool_result.localization_params
        )
        if localized:
            tts_text = localized
    tts_audio = await synthesize_speech(tts_text, language)

    result = OrchestratorResult(
        transcript=text,
        action=action.action,
        tool_result=tool_result.to_dict(),
        tts_audio=tts_audio,
        navigate_to=tool_result.navigate_to,
        command_envelope=envelope.to_dict() if envelope else None,
    )
    result.confidence = action.confidence
    result.suggestions = action.suggestions
    return result
