import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, JSON
from sqlalchemy.orm import relationship
from core.database import Base

class Role(Base):
    __tablename__ = "roles"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(50), unique=True, nullable=False)
    users = relationship("User", back_populates="role")

class HospitalBranch(Base):
    __tablename__ = "hospital_branches"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    location = Column(String(200))
    users = relationship("User", back_populates="branch")

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True)
    hashed_password = Column(String(200), nullable=False)
    role_id = Column(String(36), ForeignKey("roles.id"))
    branch_id = Column(String(36), ForeignKey("hospital_branches.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    role = relationship("Role", back_populates="users")
    branch = relationship("HospitalBranch", back_populates="users")

class OPRegistration(Base):
    __tablename__ = "op_registrations"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id = Column(String(36), ForeignKey("users.id"))
    branch_id = Column(String(36), ForeignKey("hospital_branches.id"))
    form_data = Column(JSON, nullable=False, default=dict)
    status = Column(String(50), default="registered")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    patient = relationship("User", foreign_keys=[patient_id])
    branch = relationship("HospitalBranch")

class QueuePosition(Base):
    __tablename__ = "queue_positions"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    registration_id = Column(String(36), ForeignKey("op_registrations.id"))
    department = Column(String(100), nullable=False)
    position = Column(Integer, nullable=False)
    status = Column(String(50), default="waiting")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    registration = relationship("OPRegistration")


class LabTestScan(Base):
    """Stores scanned lab test results with cloud sync status."""
    __tablename__ = "lab_test_scans"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    registration_id = Column(String(36), nullable=True)
    tests_data = Column(JSON, nullable=False, default=list)  # [{id, name, price, status}]
    total_amount = Column(Integer, default=0)
    cloud_storage_path = Column(String(500), nullable=True)
    cloud_download_url = Column(String(1000), nullable=True)
    sync_status = Column(String(20), default="synced")  # synced | pending | failed
    created_at = Column(DateTime, default=datetime.utcnow)
