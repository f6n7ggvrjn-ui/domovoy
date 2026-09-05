from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean
from datetime import datetime

try:
    from .database import Base
except ImportError:
    from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(String(20), primary_key=True)
    full_name = Column(String(200), nullable=False)
    birth_date = Column(String(20), nullable=True)
    role = Column(String(30), nullable=False)
    status = Column(String(20), default="active")
    password_hash = Column(String(200), nullable=False)
    phone = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class EquipmentType(Base):
    __tablename__ = "equipment_types"
    ean = Column(String(50), primary_key=True)
    name = Column(String(200), nullable=False)
    category = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Equipment(Base):
    __tablename__ = "equipment"
    id = Column(String(20), primary_key=True)
    ean = Column(String(50), nullable=True)
    name = Column(String(200), nullable=False)
    status = Column(String(40), default="in_cell")
    cell_code = Column(String(40), nullable=True)
    bag_id = Column(String(20), nullable=True)
    last_user_1 = Column(String(20), nullable=True)
    last_user_2 = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Cell(Base):
    __tablename__ = "cells"
    code = Column(String(40), primary_key=True)
    warehouse_no = Column(String(10), nullable=True)
    region = Column(String(10), nullable=True)
    shelf = Column(String(10), nullable=True)
    slot = Column(String(10), nullable=True)
    created_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Bag(Base):
    __tablename__ = "bags"
    id = Column(String(20), primary_key=True)
    status = Column(String(40), default="free")
    order_id = Column(String(30), nullable=True)
    executor_id = Column(String(20), nullable=True)
    transfer_point = Column(String(100), nullable=True)
    assembled_by = Column(String(20), nullable=True)
    cutoff_minutes = Column(Integer, default=10)
    assembly_started_at = Column(DateTime, nullable=True)
    assembly_finished_at = Column(DateTime, nullable=True)
    issued_at = Column(DateTime, nullable=True)
    returned_at = Column(DateTime, nullable=True)
    comment = Column(Text, nullable=True)


class Order(Base):
    __tablename__ = "orders"
    id = Column(String(30), primary_key=True)
    client_name = Column(String(200), nullable=True)
    address = Column(String(500), nullable=False)
    cleaning_type = Column(String(100), nullable=True)
    object_info = Column(Text, nullable=True)
    executor_id = Column(String(20), nullable=True)
    status = Column(String(40), default="new")
    cutoff_minutes = Column(Integer, default=10)
    bag_id = Column(String(20), nullable=True)
    is_late = Column(Boolean, default=False)
    late_minutes = Column(Integer, nullable=True)
    completion_requested_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    signal_sent = Column(Boolean, default=False)


class Operation(Base):
    __tablename__ = "operations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    datetime = Column(DateTime, default=datetime.utcnow)
    type = Column(String(50), nullable=False)
    user_id = Column(String(20), nullable=False)
    bag_id = Column(String(20), nullable=True)
    equipment_id = Column(String(20), nullable=True)
    cell_code = Column(String(40), nullable=True)
    order_id = Column(String(30), nullable=True)
    comment = Column(Text, nullable=True)


class MissingReport(Base):
    __tablename__ = "missing_reports"
    id = Column(Integer, primary_key=True, autoincrement=True)
    equipment_id = Column(String(20), nullable=False)
    bag_id = Column(String(20), nullable=True)
    order_id = Column(String(30), nullable=True)
    reported_by = Column(String(20), nullable=False)
    last_user_1 = Column(String(20), nullable=True)
    last_user_2 = Column(String(20), nullable=True)
    status = Column(String(20), default="open")
    kind = Column(String(20), default="missing")
    created_at = Column(DateTime, default=datetime.utcnow)


class TransferPoint(Base):
    __tablename__ = "transfer_points"
    code = Column(String(30), primary_key=True)
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
