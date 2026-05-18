"""
Conversation Memory — session-scoped conversation state.

Location: backend/services/conversation_memory.py

Responsibilities:
- Store last N exchanges per session
- Track partial registration state
- Track clarification context
- Session-scoped (WebSocket lifetime)

In production, this would use Redis for persistence across restarts.
For now, uses an in-memory store keyed by session_id.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

MAX_HISTORY = 10  # Keep last 10 exchanges for better multi-step flow tracking


@dataclass
class ConversationExchange:
    """A single user ↔ system exchange."""
    user_text: str
    action: Optional[str] = None
    system_response: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class SessionMemory:
    """Full memory for one WebSocket session."""
    session_id: str
    language: str = "en"
    exchanges: list[ConversationExchange] = field(default_factory=list)
    partial_registration: dict[str, Any] = field(default_factory=dict)
    clarification_state: Optional[dict[str, Any]] = None
    clarification_count: int = 0
    last_clarification_question: str = ""
    created_at: float = field(default_factory=time.time)

    def add_exchange(
        self,
        user_text: str,
        action: Optional[str] = None,
        system_response: Optional[str] = None,
    ) -> None:
        """Add an exchange and trim to MAX_HISTORY."""
        self.exchanges.append(
            ConversationExchange(
                user_text=user_text,
                action=action,
                system_response=system_response,
            )
        )
        if len(self.exchanges) > MAX_HISTORY:
            self.exchanges = self.exchanges[-MAX_HISTORY:]

    def update_partial_registration(self, data: dict[str, Any]) -> None:
        """Merge new patient fields into partial registration state."""
        self.partial_registration.update(data)

    def get_registration_fields(self) -> dict[str, Any]:
        """Return the current partial registration state."""
        return dict(self.partial_registration)

    def set_clarification(self, context: dict[str, Any]) -> None:
        """Mark that we're waiting for a clarification response. Tracks count to prevent loops."""
        question = context.get("message", "")
        # Check if same question repeated
        if question and self._is_same_question(question):
            self.clarification_count += 1
        else:
            self.clarification_count = 1
            self.last_clarification_question = question
        self.clarification_state = context
        logger.info(
            "Clarification set (count=%d): %s",
            self.clarification_count,
            question[:50],
        )

    def should_stop_clarifying(self) -> bool:
        """Returns True if clarification has been repeated too many times (max 2)."""
        return self.clarification_count >= 2

    def clear_clarification(self) -> None:
        self.clarification_state = None
        self.clarification_count = 0
        self.last_clarification_question = ""

    def _is_same_question(self, question: str) -> bool:
        """Fuzzy match for repeated questions."""
        if not self.last_clarification_question:
            return False
        return self.last_clarification_question[:30].lower() == question[:30].lower()

    def get_history_for_prompt(self) -> list[dict[str, str]]:
        """
        Format the last exchanges for the LLM system prompt.
        Returns a list of {role, content} dicts.
        """
        history = []
        for ex in self.exchanges:
            history.append({"role": "user", "content": ex.user_text})
            if ex.system_response:
                history.append({"role": "assistant", "content": ex.system_response})
        return history


# ── In-memory session store ───────────────────────────────────────────────────

_sessions: dict[str, SessionMemory] = {}


def get_or_create_session(session_id: str, language: str = "en") -> SessionMemory:
    """Get existing session or create a new one."""
    if session_id not in _sessions:
        _sessions[session_id] = SessionMemory(session_id=session_id, language=language)
        logger.info("Created new conversation session: %s", session_id)
    return _sessions[session_id]


def get_session(session_id: str) -> Optional[SessionMemory]:
    """Get a session by ID, or None if not found."""
    return _sessions.get(session_id)


def delete_session(session_id: str) -> None:
    """Remove a session (e.g., on WebSocket disconnect)."""
    if session_id in _sessions:
        del _sessions[session_id]
        logger.info("Deleted conversation session: %s", session_id)


def cleanup_stale_sessions(max_age_seconds: int = 3600) -> int:
    """Remove sessions older than max_age_seconds. Returns count removed."""
    now = time.time()
    stale = [
        sid for sid, mem in _sessions.items()
        if (now - mem.created_at) > max_age_seconds
    ]
    for sid in stale:
        del _sessions[sid]
    if stale:
        logger.info("Cleaned up %d stale sessions", len(stale))
    return len(stale)
