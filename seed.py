from datetime import datetime, timedelta

try:
    from database import SessionLocal
    from models import (
        User, Equipment, EquipmentType, Cell, Bag, Order, TransferPoint, Warehouse,
    )
    from auth import hash_password
except ImportError:
    from .database import SessionLocal
    from .models import (
        User, Equipment, EquipmentType, Cell, Bag, Order, TransferPoint, Warehouse,
    )
    from .auth import hash_password


def seed():
    db = SessionLocal()
    if db.query(User).first():
        db.close()
        return
    # warehouses
    db.add(Warehouse(code="001066", name="Основной склад", is_main=True))
    db.add(Warehouse(code="002010", name="Склад №2", is_main=False))
    db.flush()

    users = [
        ("us000001", "Администратор", "admin", "admin123", "001066"),
        ("us000002", "Кладовщик Иванов", "warehouse", "warehouse123", "001066"),
        ("us000003", "Прототип 1", "cleaner", "cleaner123", "001066"),
        ("us000004", "Мария Сидорова", "cleaner", "cleaner123", "001066"),
        ("us000005", "Алексей Мастеров", "handyman", "master123", "001066"),
        ("us000006", "Старший смены", "supervisor", "senior123", "001066"),
    ]
    for uid, name, role, pwd, wh in users:
        db.add(User(
            id=uid, full_name=name, role=role, status="active",
            password_hash=hash_password(pwd), birth_date="1990-01-01",
            home_warehouse=wh,
        ))

    types = [
        ("4601234567890", "Пылесос Karcher T 15/1", "Пылесосы"),
        ("4601234567891", "Пароочиститель Karcher SC 3", "Пароочистители"),
        ("4601234567892", "Швабра Vileda Pro", "Швабры"),
    ]
    for ean, name, cat in types:
        db.add(EquipmentType(ean=ean, name=name, category=cat))
    db.flush()

    cells = ["DY0010661/2", "DY0010661/3", "DY0010662/1", "DY0020101/1"]
    for c in cells:
        wh = c[2:8]  # 001066 from DY0010661/2
        db.add(Cell(
            code=c, warehouse_no=c[2:5], region=c[5:8],
            shelf=c.split("/")[0][-1], slot=c.split("/")[1],
            warehouse_code=wh, created_by="us000001",
        ))
    db.flush()

    for tp in [("TP01", "Точка передачи A"), ("TP02", "Точка передачи B"), ("TP03", "Стеллаж у выхода")]:
        db.add(TransferPoint(code=tp[0], name=tp[1], warehouse_code="001066"))
    db.flush()

    equip = [
        ("dd10000001", "4601234567890", "Пылесос №1", "DY0010661/2", "001066"),
        ("dd10000002", "4601234567890", "Пылесос №2", "DY0010661/3", "001066"),
        ("dd10000003", "4601234567891", "Пароочиститель №1", "DY0010662/1", "001066"),
        ("dd10000004", "4601234567892", "Швабра №1", "DY0020101/1", "002010"),
        ("dd10000005", "4601234567892", "Швабра №2", "DY0020101/1", "002010"),
    ]
    for eid, ean, name, cell, wh in equip:
        db.add(Equipment(id=eid, ean=ean, name=name, status="in_cell", cell_code=cell, warehouse_code=wh))

    for b in ["sumka14024", "sumka14025", "sumka14026", "sumka14027"]:
        db.add(Bag(id=b, status="free", warehouse_code="001066"))

    db.add(Order(
        id="ORD83775", client_name="ООО Ромашка",
        address="г. Москва, ул. Ленина, 10, офис 301",
        cleaning_type="Генеральная уборка", object_info="Домофон 301#, 3 этаж",
        executor_id="us000003", status="awaiting_assembly", cutoff_minutes=10,
        warehouse_code="001066",
        created_at=datetime.utcnow(), signal_sent=True,
    ))
    db.add(Order(
        id="ORD85736", client_name="ИП Смирнов",
        address="г. Москва, пр. Мира, 25",
        cleaning_type="Поддерживающая", object_info="Парковка сзади",
        executor_id="us000004", status="awaiting_assembly", cutoff_minutes=20,
        warehouse_code="001066",
        created_at=datetime.utcnow() - timedelta(minutes=5), signal_sent=True,
    ))
    db.commit()
    db.close()
    print("Seed OK")
