"""
Fallback Intent Parser — keyword-based intent matching when Sarvam AI is unavailable.

Location: backend/services/fallback_intent.py

Responsibilities:
- Keyword-based intent extraction from transcript text
- Limited action set compared to full LLM mode
- Returns same LLMAction structure for consistent downstream handling

Hospital operations must never depend solely on LLM availability.
"""

import logging
import re
from typing import Optional

from services.json_validator import LLMAction

logger = logging.getLogger(__name__)

# ── Keyword patterns → action mapping ─────────────────────────────────────────

# Each pattern is (compiled_regex, action_name, default_params)
_INTENT_PATTERNS: list[tuple[re.Pattern, str, dict]] = [
    # Registration — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(register|registration|new patient|op registration|book|admit"
            r"|నమోదు|రిజిస్ట్రేషన్|కొత్త పేషెంట్|డాక్టర్|చూడాలి|చూడండి"
            r"|पंजीकरण|रजिस्ट्रेशन|नया मरीज|डॉक्टर|दिखाना|मिलना"
            r"|பதிவு|புதிய நோயாளி|டாக்டர்)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "REGISTRATION"},
    ),
    # Queue — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(queue|waiting|wait time|how long|token status|line"
            r"|క్యూ|వేచి|ఎంతసేపు|నంబర్|టోకెన్"
            r"|कतार|इंतजार|कितना टाइम|नंबर|टोकन"
            r"|வரிசை|காத்திருப்பு|எவ்வளவு நேரம்|டோக்கன்)\b",
            re.IGNORECASE,
        ),
        "get_queue_status",
        {},
    ),
    # Directions / Navigation — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(direction|navigate|where is|how to get|find|location|map|way to"
            r"|ఎక్కడ|దారి|గది|ఎక్కడికి"
            r"|कहाँ|रास्ता|कमरा|किधर"
            r"|எங்கே|வழி|அறை)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "NAVIGATION"},
    ),
    # Complaint — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(complaint|complain|problem|issue|feedback|report"
            r"|ఫిర్యాదు|సమస్య|కంప్లైంట్"
            r"|शिकायत|समस्या|कंप्लेंट"
            r"|புகார்|பிரச்சினை)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "COMPLAINT"},
    ),
    # Token lookup — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(lookup|look up|find token|check token|my token|scan"
            r"|టోకెన్ చూడండి|నా టోకెన్|చెక్ చేయండి"
            r"|टोकन देखो|मेरा टोकन|चेक करो"
            r"|டோக்கன் பாருங்கள்|என் டோக்கன்)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "QUEUE"},
    ),
    # Lab tests — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(lab|test|scan|report|lab test|blood test|x-ray"
            r"|లాబ్|పరీక్ష|రక్తం|రిపోర్ట్"
            r"|लैब|जांच|खून|रिपोर्ट"
            r"|லேப்|சோதனை|இரத்தம்|ரிப்போர்ட்)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "LAB_TESTS"},
    ),
    # Home — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(home|start|main|menu|beginning|back"
            r"|హోమ్|మొదటి|వెనక్కి"
            r"|होम|शुरू|वापस"
            r"|முகப்பு|தொடக்கம்|திரும்பு)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "HOME"},
    ),
    # Language change — English + Telugu + Hindi + Tamil
    (
        re.compile(
            r"\b(language|telugu|hindi|tamil|english|bhasha"
            r"|భాష|తెలుగు|హిందీ"
            r"|भाषा|तेलुगु|हिंदी"
            r"|மொழி|தெலுங்கு|இந்தி)\b",
            re.IGNORECASE,
        ),
        "navigate_screen",
        {"screen": "LANGUAGE"},
    ),
]

# ── Specific entity extraction ────────────────────────────────────────────────

_DEPARTMENT_KEYWORDS = {
    # English
    "cardiology": "Cardiology",
    "heart": "Cardiology",
    "ortho": "Orthopedics",
    "orthopedics": "Orthopedics",
    "bone": "Orthopedics",
    "derma": "Dermatology",
    "skin": "Dermatology",
    "dermatology": "Dermatology",
    "general": "General Medicine",
    "medicine": "General Medicine",
    "gastro": "Gastroenterology",
    "stomach": "Gastroenterology",
    "pharmacy": "Pharmacy",
    "pediatrics": "Pediatrics",
    "child": "Pediatrics",
    "children": "Pediatrics",
    "eye": "Ophthalmology",
    "ent": "ENT",
    "fever": "General Medicine",
    "gynecology": "Gynecology",
    "women": "Gynecology",
    # Telugu
    "గుండె": "Cardiology",
    "హృదయం": "Cardiology",
    "ఎముక": "Orthopedics",
    "ఎముకలు": "Orthopedics",
    "చర్మం": "Dermatology",
    "జ్వరం": "General Medicine",
    "పిల్లలు": "Pediatrics",
    "పిల్లల": "Pediatrics",
    "కంటి": "Ophthalmology",
    "మహిళల": "Gynecology",
    "చెవి": "ENT",
    "ముక్కు": "ENT",
    "గొంతు": "ENT",
    # Hindi
    "दिल": "Cardiology",
    "हृदय": "Cardiology",
    "हड्डी": "Orthopedics",
    "त्वचा": "Dermatology",
    "बुखार": "General Medicine",
    "बच्चा": "Pediatrics",
    "बच्चों": "Pediatrics",
    "आंख": "Ophthalmology",
    "महिला": "Gynecology",
    "कान": "ENT",
    "नाक": "ENT",
    "गला": "ENT",
    # Tamil
    "இதயம்": "Cardiology",
    "எலும்பு": "Orthopedics",
    "தோல்": "Dermatology",
    "காய்ச்சல்": "General Medicine",
    "குழந்தை": "Pediatrics",
    "கண்": "Ophthalmology",
    "பெண்கள்": "Gynecology",
}

# Match tokens with or without hyphen: D-001, D001, d001
_TOKEN_PATTERN = re.compile(r"\b([A-Z]-\d{3})\b", re.IGNORECASE)
_TOKEN_NO_HYPHEN = re.compile(r"\b([A-Z])(\d{3})\b", re.IGNORECASE)


def _extract_department(text: str) -> Optional[str]:
    """Try to extract a department name from text."""
    text_lower = text.lower()
    for keyword, dept in _DEPARTMENT_KEYWORDS.items():
        if keyword in text_lower:
            return dept
    return None


def _extract_token(text: str) -> Optional[str]:
    """Try to extract a token number (e.g., C-003 or D001) from text."""
    # Try with hyphen first
    match = _TOKEN_PATTERN.search(text)
    if match:
        return match.group(1).upper()
    # Try without hyphen: D001 → D-001
    match = _TOKEN_NO_HYPHEN.search(text)
    if match:
        return f"{match.group(1).upper()}-{match.group(2)}"
    return None


# ── Public API ────────────────────────────────────────────────────────────────


def parse_fallback_intent(transcript: str) -> Optional[LLMAction]:
    """
    Attempt keyword-based intent matching from a transcript.

    Returns an LLMAction if a match is found, None otherwise.
    This provides a degraded but functional experience when the LLM is unavailable.
    """
    if not transcript or not transcript.strip():
        return None

    text = transcript.strip()

    # Try to match token lookup specifically if we see a token pattern
    token = _extract_token(text)
    if token:
        return LLMAction(
            action="lookup_token",
            parameters={"token_number": token},
        )

    # Try keyword patterns
    for pattern, action, default_params in _INTENT_PATTERNS:
        if pattern.search(text):
            params = dict(default_params)

            # Enrich with extracted entities
            dept = _extract_department(text)
            if dept:
                if action == "get_queue_status":
                    params["department"] = dept
                elif action == "get_directions":
                    params["to_node"] = dept
                elif action == "navigate_screen" and params.get("screen") == "REGISTRATION":
                    # Don't override screen, but note the department
                    params["department"] = dept

            logger.info(
                "Fallback intent matched: action=%s, params=%s",
                action,
                params,
            )
            return LLMAction(action=action, parameters=params)

    # No match found
    logger.info("Fallback: no intent matched for transcript: %s", text[:100])
    return None
