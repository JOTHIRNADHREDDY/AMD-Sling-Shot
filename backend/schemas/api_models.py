from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
from datetime import datetime

# --- Voice Intent Schemas ---

class VoiceIntentRequest(BaseModel):
    audio_base64: str = Field(..., description="Base64 encoded audio fragment")
    language: str = Field(default="en-IN", description="Expected language code")

class VoiceIntentResponse(BaseModel):
    intent: str
    confidence: float
    extracted_entities: Dict[str, Any]
    transcript: str

# --- Chat Schemas ---

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = "sarvam-m"
    temperature: float = 0.7
    top_p: float = 1.0
    max_tokens: int = 1000
    language: Optional[str] = "English"

# --- Queue Schemas ---

class QueueStatusResponse(BaseModel):
    department: str
    current_serving: int
    total_waiting: int
    estimated_wait_time_mins: int

# --- Map Schemas ---

class RouteStep(BaseModel):
    instruction: str
    distance_meters: int
    direction: str # e.g., "straight", "left", "right"

class MapDirectionResponse(BaseModel):
    from_node: str
    to_node: str
    total_distance_meters: int
    estimated_time_mins: int
    steps: list[RouteStep]

# --- Registration Schemas ---

class RegistrationRequest(BaseModel):
    name: str
    age: str
    gender: str = "Male"
    phone: str = ""
    department: str
    language: str = "en"

class RegistrationResponse(BaseModel):
    registration_id: str
    token_number: str
    department: str
    position: int
    estimated_wait_time_mins: int
    patient_name: str
    patient_age: str
    patient_gender: str
    patient_phone: str
    language: str
    created_at: str

class PatientLookupResponse(BaseModel):
    registration_id: str
    token_number: str
    department: str
    position: int
    queue_status: str
    estimated_wait_time_mins: int
    patient_name: str
    patient_age: str
    patient_gender: str
    patient_phone: str
    language: str
    created_at: str

# --- Generic Schemas ---

class ErrorResponse(BaseModel):
    detail: str
