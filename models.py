from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(String(20), primary_key=True)          # us000001
    full_name = Column(String(200), nullable=False)
    birth_date = Column(String(20), nullable=True)
    role = Column(String(30), nullable=False)          # admin / warehouse / cleaner / handyman
    status = Column(String(20), default="active")      # active / blocked / fired
    password_hash = Column(String(200), nullable=False)
    phone = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class EquipmentType(Base):
    """EAN / manufacturer barcode = product type"""
    __tablename__ = "equipment_types"
    ean = Column(String(50), primary_key=True)
    name = Column(String(200), nullable=False)
    category = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Equipment(Base):
    __tablename__ = "equipment"
    id = Column(String(20), primary_key=True)          # dd75647253
    ean = Column(String(50), ForeignKey("equipment_types.ean"), nullable=True)
    name = Column(String(200), nullable=False)
    status = Column(String(40), default="in_cell")     # in_cell / in_bag / issued / damaged / missing / receiving
    cell_code = Column(String(40), nullable=True)      # DY0010661/2
    bag_id = Column(String(20), nullable=True)
    last_user_1 = Column(String(20), nullable=True)    # last two users who touched
    last_user_2 = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Cell(Base):
    __tablename__ = "cells"
    code = Column(String(40), primary_key=True)        # DY0010661/2
    warehouse_no = Column(String(10), nullable=True)   # 001
    region = Column(String(10), nullable=True)         # 066
    shelf = Column(String(10), nullable=True)          # 1
    slot = Column(String(10), nullable=True)           # 2
    created_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Bag(Base):
    __tablename__ = "bags"
    id = Column(String(20), primary_key=True)          # sumka14024
    status = Column(String(40), default="free")
    # free / assembling / at_transfer / in_use / awaiting_unpack
    order_id = Column(String(30), nullable=True)
    executor_id = Column(String(20), nullable=True)    # us...
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
    id = Column(String(30), primary_key=True)          # ORD83775
    client_name = Column(String(200), nullable=True)
    address = Column(String(500), nullable=False)
    cleaning_type = Column(String(100), nullable=True)
    executor_id = Column(String(20), nullable=True)
    status = Column(String(40), default="new")
    # new / awaiting_assembly / assembling / ready / issued / done / cancelled
    cutoff_minutes = Column(Integer, default=10)
    bag_id = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    signal_sent = Column(Boolean, default=False)


class Operation(Base):
    __tablename__ = "operations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    datetime = Column(DateTime, default=datetime.utcnow)
    type = Column(String(50), nullable=False)
    # assembly_start / assembly_item / assembly_done / transfer /
    # issue_to_executor / unpack_item / damage / missing / receive / place_cell
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
    status = Column(String(20), default="open")        # open / closed
    created_at = Column(DateTime, default=datetime.utcnow)


class TransferPoint(Base):
    __tablename__ = "transfer_points"
    code = Column(String(30), primary_key=True)  # TP01
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
