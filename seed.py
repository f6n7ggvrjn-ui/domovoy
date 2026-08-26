from datetime import datetime, timedelta
from models import User, EquipmentType, Equipment, Cell, Bag, Order, TransferPoint
from auth import hash_password

def seed(db):
    if db.query(User).count() > 0:
        return

    users = [
        ("us000001", "Администратор", "admin", "admin123"),
        ("us000002", "Кладовщик Иванов", "warehouse", "sklad123"),
        ("us000003", "Иван Петров", "cleaner", "cleaner123"),
        ("us000004", "Мария Сидорова", "cleaner", "cleaner123"),
        ("us000005", "Алексей Мастеров", "handyman", "master123"),
    ]
    for uid, name, role, pwd in users:
        db.add(User(
            id=uid, full_name=name, role=role, status="active",
            password_hash=hash_password(pwd), birth_date="1990-01-01",
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
        db.add(Cell(
            code=c, warehouse_no=c[2:5], region=c[5:8],
            shelf=c.split("/")[0][-1], slot=c.split("/")[1],
            created_by="us000001",
        ))
    db.flush()

    equip = [
        ("dd10000001", "4601234567890", "Пылесос №1", "DY0010661/2"),
        ("dd10000002", "4601234567890", "Пылесос №2", "DY0010661/3"),
        ("dd10000003", "4601234567891", "Пароочиститель №1", "DY0010662/1"),
        ("dd10000004", "4601234567892", "Швабра №1", "DY0020101/1"),
        ("dd10000005", "4601234567892", "Швабра №2", "DY0020101/1"),
    ]
    for eid, ean, name, cell in equip:
        db.add(Equipment(
            id=eid, ean=ean, name=name, status="in_cell", cell_code=cell,
        ))

    for tp in [("TP01", "Точка передачи A"), ("TP02", "Точка передачи B"), ("TP03", "Стеллаж у выхода")]:
        db.add(TransferPoint(code=tp[0], name=tp[1]))
    db.flush()

    bags = ["sumka14024", "sumka14025", "sumka14026", "sumka14027"]
    for b in bags:
        db.add(Bag(id=b, status="free"))

    db.add(Order(
        id="ORD83775",
        client_name="ООО Ромашка",
        address="г. Москва, ул. Ленина, 10, офис 301",
        cleaning_type="Генеральная уборка",
        executor_id="us000003",
        status="awaiting_assembly",
        cutoff_minutes=10,
        created_at=datetime.utcnow(),
        signal_sent=True,
    ))
    db.add(Order(
        id="ORD85736",
        client_name="ИП Смирнов",
        address="г. Москва, пр. Мира, 25",
        cleaning_type="Поддерживающая",
        executor_id="us000004",
        status="awaiting_assembly",
        cutoff_minutes=20,
        created_at=datetime.utcnow() - timedelta(minutes=5),
        signal_sent=True,
    ))

    db.commit()
    print("Seed OK")
    print("  us000001 / admin123   (Админ)")
    print("  us000002 / sklad123   (Склад)")
    print("  us000003 / cleaner123 (Клинер)")
