from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, Float
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
    # admin / warehouse / cleaner / handyman / supervisor
    status = Column(String(20), default="active")
    block_reason = Column(Text, nullable=True)
    password_hash = Column(String(200), nullable=False)
    phone = Column(String(30), nullable=True)
    home_warehouse = Column(String(10), nullable=True)  # основной склад
    created_at = Column(DateTime, default=datetime.utcnow)


class Warehouse(Base):
    __tablename__ = "warehouses"
    code = Column(String(10), primary_key=True)  # 001066
    name = Column(String(200), nullable=False)
    is_main = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ShiftEntry(Base):
    """Кто на смене сегодня на складе."""
    __tablename__ = "shift_entries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    warehouse_code = Column(String(10), nullable=False)
    user_id = Column(String(20), nullable=False)
    shift_date = Column(String(10), nullable=False)  # YYYY-MM-DD
    marked_by = Column(String(20), nullable=True)
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
    # in_cell / in_bag / issued / damaged / missing / receiving / written_off / in_shipment
    cell_code = Column(String(40), nullable=True)
    bag_id = Column(String(20), nullable=True)
    warehouse_code = Column(String(10), nullable=True)
    shipment_id = Column(String(20), nullable=True)
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
    warehouse_code = Column(String(10), nullable=True)
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
    cutoff_minutes = Column(Integer, default=30)  # минут до заказа, когда сумка должна быть готова
    scheduled_at = Column(DateTime, nullable=True)  # время выезда/заказа
    assembly_started_at = Column(DateTime, nullable=True)
    assembly_finished_at = Column(DateTime, nullable=True)
    issued_at = Column(DateTime, nullable=True)
    returned_at = Column(DateTime, nullable=True)
    warehouse_code = Column(String(10), nullable=True)


class Order(Base):
    __tablename__ = "orders"
    id = Column(String(30), primary_key=True)
    client_name = Column(String(200), nullable=True)
    address = Column(String(500), nullable=False)
    cleaning_type = Column(String(100), nullable=True)
    object_info = Column(Text, nullable=True)
    executor_id = Column(String(20), nullable=True)
    bag_id = Column(String(20), nullable=True)
    status = Column(String(40), default="new")
    cutoff_minutes = Column(Integer, default=30)  # минут до заказа, когда сумка должна быть готова
    scheduled_at = Column(DateTime, nullable=True)  # время выезда/заказа
    is_late = Column(Boolean, default=False)
    late_minutes = Column(Integer, nullable=True)
    signal_sent = Column(Boolean, default=False)
    warehouse_code = Column(String(10), nullable=True)
    completion_requested_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(20), nullable=True)


class TransferPoint(Base):
    __tablename__ = "transfer_points"
    code = Column(String(40), primary_key=True)
    name = Column(String(200), nullable=False)
    warehouse_code = Column(String(10), nullable=True)
    active = Column(Boolean, default=True)


class Operation(Base):
    __tablename__ = "operations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(String(50), nullable=False)
    user_id = Column(String(20), nullable=False)
    equipment_id = Column(String(20), nullable=True)
    bag_id = Column(String(20), nullable=True)
    order_id = Column(String(30), nullable=True)
    cell_code = Column(String(40), nullable=True)
    shipment_id = Column(String(20), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class MissingReport(Base):
    __tablename__ = "missing_reports"
    id = Column(Integer, primary_key=True, autoincrement=True)
    equipment_id = Column(String(20), nullable=False)
    bag_id = Column(String(20), nullable=True)
    order_id = Column(String(30), nullable=True)
    shipment_id = Column(String(20), nullable=True)
    warehouse_code = Column(String(10), nullable=True)
    last_user_1 = Column(String(20), nullable=True)
    last_user_2 = Column(String(20), nullable=True)
    reported_by = Column(String(20), nullable=True)
    kind = Column(String(20), default="missing")
    status = Column(String(20), default="open")
    created_at = Column(DateTime, default=datetime.utcnow)


class UserChangeLog(Base):
    __tablename__ = "user_change_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(20), nullable=False)
    changed_by = Column(String(20), nullable=False)
    field = Column(String(50), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Shipment(Base):
    """Межскладская поставка. id = 11 цифр."""
    __tablename__ = "shipments"
    id = Column(String(20), primary_key=True)
    from_warehouse = Column(String(10), nullable=False)
    to_warehouse = Column(String(10), nullable=False)
    # forming / sent / receiving / received / received_shortage / cancelled
    status = Column(String(40), default="forming")
    kind = Column(String(30), default="transfer")  # transfer / return_defect
    assembler_id = Column(String(20), nullable=True)
    created_by = Column(String(20), nullable=True)
    sent_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    received_by = Column(String(20), nullable=True)
    season = Column(Integer, nullable=True)
    season_year = Column(Integer, nullable=True)
    shortage_json = Column(Text, nullable=True)  # JSON list of missing items
    shortage_visualized = Column(Boolean, default=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ShipmentItem(Base):
    __tablename__ = "shipment_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    shipment_id = Column(String(20), nullable=False)
    equipment_id = Column(String(20), nullable=False)
    ean = Column(String(50), nullable=True)
    name = Column(String(200), nullable=True)
    # packed / received / missing
    status = Column(String(20), default="packed")
    received_cell = Column(String(40), nullable=True)
    packed_by = Column(String(20), nullable=True)
    received_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
