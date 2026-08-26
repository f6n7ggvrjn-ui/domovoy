from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, List
import os

from database import Base, engine, get_db, SessionLocal
from models import (
    User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint
)
from auth import (
    hash_password, verify_password, make_token, get_current_user, require_roles, ROLE_LABELS
)
from codes import (
    is_bag, is_equipment, is_user, is_cell, parse_cell, is_problem_zone, is_ean, normalize, PROBLEM_ZONE
)
from seed import seed

Base.metadata.create_all(bind=engine)
db0 = SessionLocal()
try:
    seed(db0)
finally:
    db0.close()

app = FastAPI(title="Домовой", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

_here = os.path.dirname(os.path.abspath(__file__))
# try: .../backend/app -> .../frontend  OR  /app/backend/app -> /app/frontend
FRONTEND = os.path.join(os.path.dirname(os.path.dirname(_here)), "frontend")
if not os.path.isdir(FRONTEND):
    FRONTEND = os.path.join(os.path.dirname(_here), "frontend")
if not os.path.isdir(FRONTEND):
    FRONTEND = "/app/frontend"


# ---------- schemas ----------
class LoginIn(BaseModel):
    login: str
    password: str

class EmployeeIn(BaseModel):
    full_name: str
    birth_date: Optional[str] = None
    role: str  # warehouse / cleaner / handyman

class CellIn(BaseModel):
    code: str

class EanIn(BaseModel):
    ean: str
    name: str
    category: Optional[str] = None

class ScanIn(BaseModel):
    code: str

class AssemblyStartIn(BaseModel):
    bag_id: str
    order_id: str

class AssemblyItemIn(BaseModel):
    bag_id: str
    equipment_id: str

class AssemblyFinishIn(BaseModel):
    bag_id: str
    transfer_point: str

class IssueIn(BaseModel):
    executor_id: str
    bag_id: str

class UnpackItemIn(BaseModel):
    bag_id: str
    equipment_id: str
    cell_code: str

class DamageIn(BaseModel):
    bag_id: str
    equipment_id: str
    zone_code: str

class ReceiveIn(BaseModel):
    ean: str
    equipment_id: str

class PlaceIn(BaseModel):
    equipment_id: str
    cell_code: str

class OrderCreateIn(BaseModel):
    client_name: Optional[str] = None
    address: str
    cleaning_type: Optional[str] = None
    executor_id: Optional[str] = None
    cutoff_minutes: int = 10
    send_to_assembly: bool = True

class TransferPointIn(BaseModel):
    code: str
    name: str

class ReturnBagIn(BaseModel):
    bag_id: str


def touch_equipment(eq: Equipment, user_id: str):
    eq.last_user_2 = eq.last_user_1
    eq.last_user_1 = user_id


def log_op(db, type_, user_id, **kw):
    db.add(Operation(type=type_, user_id=user_id, **kw))


def bag_cutoff_left(bag: Bag) -> Optional[int]:
    if not bag.assembly_started_at or bag.status not in ("assembling",):
        return None
    end = bag.assembly_started_at + timedelta(minutes=bag.cutoff_minutes or 10)
    left = int((end - datetime.utcnow()).total_seconds() // 60)
    return left


# ---------- auth ----------
@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    login = normalize(data.login).lower()
    user = db.query(User).filter(User.id == login).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    if user.status != "active":
        raise HTTPException(403, "Учётная запись неактивна")
    return {
        "access_token": make_token(user.id, user.role),
        "user": {
            "id": user.id, "full_name": user.full_name, "role": user.role,
            "role_label": ROLE_LABELS.get(user.role, user.role),
        },
    }


@app.get("/api/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id, "full_name": user.full_name, "role": user.role,
        "role_label": ROLE_LABELS.get(user.role, user.role),
    }


# ---------- employees ----------
@app.get("/api/employees/next-id")
def next_employee_id(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    last = db.query(User).order_by(User.id.desc()).first()
    n = 1
    if last and last.id.startswith("us"):
        try:
            n = int(last.id[2:]) + 1
        except ValueError:
            n = 1
    return {"id": f"us{n:06d}"}


@app.post("/api/employees")
def create_employee(data: EmployeeIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if data.role not in ("warehouse", "cleaner", "handyman"):
        raise HTTPException(400, "Роль: warehouse / cleaner / handyman")
    nid = next_employee_id(db, user)["id"]
    while db.query(User).filter(User.id == nid).first():
        n = int(nid[2:]) + 1
        nid = f"us{n:06d}"
    u = User(
        id=nid, full_name=data.full_name, birth_date=data.birth_date,
        role=data.role, status="active",
        password_hash=hash_password("123456"),
    )
    db.add(u)
    db.commit()
    return {"id": u.id, "full_name": u.full_name, "role": u.role, "password": "123456"}


@app.get("/api/employees")
def list_employees(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    q = db.query(User).order_by(User.id)
    return [
        {"id": u.id, "full_name": u.full_name, "role": u.role,
         "role_label": ROLE_LABELS.get(u.role, u.role), "status": u.status,
         "birth_date": u.birth_date}
        for u in q.all()
    ]


# ---------- cells ----------
@app.post("/api/cells")
def add_cell(data: CellIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    parsed = parse_cell(data.code)
    if not parsed:
        raise HTTPException(400, "Неверный формат ячейки. Пример: DY0010661/2")
    code = data.code.strip()
    if not code.startswith("DY"):
        code = "DY" + code[2:] if code.upper().startswith("DY") else code
    # normalize to DY + rest
    if code[:2].upper() == "DY":
        code = "DY" + code[2:]
    if db.query(Cell).filter(Cell.code == code).first():
        raise HTTPException(400, "Ячейка уже существует")
    cell = Cell(
        code=code, warehouse_no=parsed["warehouse_no"], region=parsed["region"],
        shelf=parsed["shelf"], slot=parsed["slot"], created_by=user.id,
    )
    db.add(cell)
    db.commit()
    return {"code": cell.code, "warehouse_no": cell.warehouse_no, "region": cell.region,
            "shelf": cell.shelf, "slot": cell.slot}


@app.get("/api/cells")
def list_cells(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [{"code": c.code, "warehouse_no": c.warehouse_no, "region": c.region,
             "shelf": c.shelf, "slot": c.slot} for c in db.query(Cell).order_by(Cell.code).all()]


# ---------- bags / assembly board ----------
@app.get("/api/assembly/board")
def assembly_board(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    orders = db.query(Order).filter(Order.status.in_(["awaiting_assembly", "assembling", "ready"])).order_by(Order.created_at).all()
    rows = []
    for o in orders:
        left = None
        status_label = {
            "awaiting_assembly": "Ожидает сборки",
            "assembling": "Сборка",
            "ready": "Готово / точка передачи",
        }.get(o.status, o.status)
        if o.bag_id:
            bag = db.query(Bag).filter(Bag.id == o.bag_id).first()
            if bag and bag.status == "assembling" and bag.assembly_started_at:
                end = bag.assembly_started_at + timedelta(minutes=bag.cutoff_minutes or o.cutoff_minutes or 10)
                left = max(0, int((end - datetime.utcnow()).total_seconds() // 60))
                status_label = "Сборка"
        elif o.status == "awaiting_assembly":
            left = o.cutoff_minutes
        rows.append({
            "order_id": o.id, "address": o.address, "status": o.status,
            "status_label": status_label, "cutoff_left": left,
            "cutoff_minutes": o.cutoff_minutes, "bag_id": o.bag_id,
            "executor_id": o.executor_id,
        })
    return rows


@app.get("/api/bags")
def list_bags(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    labels = {
        "free": "Свободна",
        "assembling": "Собирается на заказ",
        "at_transfer": "Ожидает в точке передачи",
        "in_use": "В использовании",
        "awaiting_unpack": "Принята после исполнителя, ждёт разбор",
    }
    result = []
    for b in db.query(Bag).order_by(Bag.id).all():
        label = labels.get(b.status, b.status)
        if b.status == "in_use" and b.executor_id:
            label = f"В использовании ({b.executor_id})"
        result.append({
            "id": b.id, "status": b.status, "status_label": label,
            "order_id": b.order_id, "executor_id": b.executor_id,
            "transfer_point": b.transfer_point,
        })
    return result


# ---------- assembly flow ----------
@app.post("/api/assembly/start")
def assembly_start(data: AssemblyStartIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки. Формат: sumka + 5 цифр (sumka14024)")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена в системе")
    if bag.status != "free":
        raise HTTPException(400, f"Сумка занята (статус: {bag.status})")
    order = db.query(Order).filter(Order.id == data.order_id).first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status not in ("awaiting_assembly", "new"):
        raise HTTPException(400, f"Заказ нельзя собирать (статус: {order.status})")

    bag.status = "assembling"
    bag.order_id = order.id
    bag.assembled_by = user.id
    bag.cutoff_minutes = order.cutoff_minutes or 10
    bag.assembly_started_at = datetime.utcnow()
    order.status = "assembling"
    order.bag_id = bag.id
    log_op(db, "assembly_start", user.id, bag_id=bag.id, order_id=order.id)
    db.commit()
    return {
        "ok": True, "bag_id": bag.id, "order_id": order.id,
        "cutoff_minutes": bag.cutoff_minutes,
        "address": order.address,
        "message": f"Сборка начата. Cut off: {bag.cutoff_minutes} мин",
    }


@app.post("/api/assembly/add-item")
def assembly_add_item(data: AssemblyItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    eq_id = normalize(data.equipment_id).lower()
    if not is_equipment(eq_id):
        raise HTTPException(400, "Неверный код оборудования. Формат: dd + 8 цифр")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag or bag.status != "assembling":
        raise HTTPException(400, "Сумка не в режиме сборки")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    if eq.status not in ("in_cell",):
        raise HTTPException(400, f"Нельзя положить в сумку: статус «{eq.status}»")

    eq.status = "in_bag"
    eq.bag_id = bag.id
    eq.cell_code = None
    touch_equipment(eq, user.id)
    log_op(db, "assembly_item", user.id, bag_id=bag.id, equipment_id=eq.id, order_id=bag.order_id)
    db.commit()
    items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    return {
        "ok": True, "equipment_id": eq.id, "name": eq.name,
        "items_count": len(items),
        "items": [{"id": i.id, "name": i.name} for i in items],
    }


@app.post("/api/assembly/finish")
def assembly_finish(data: AssemblyFinishIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag or bag.status != "assembling":
        raise HTTPException(400, "Сумка не в режиме сборки")
    tp = normalize(data.transfer_point).upper()
    if not tp:
        raise HTTPException(400, "Укажите точку передачи")
    # accept TP01 style or free text for flexibility
    tp_row = db.query(TransferPoint).filter(TransferPoint.code == tp).first()
    if not tp_row and tp.startswith("TP"):
        raise HTTPException(400, f"Точка передачи {tp} не найдена. Добавьте в справочник.")
    tp_display = f"{tp_row.code} — {tp_row.name}" if tp_row else tp

    bag.status = "at_transfer"
    bag.transfer_point = tp_display
    bag.assembly_finished_at = datetime.utcnow()
    if bag.order_id:
        order = db.query(Order).filter(Order.id == bag.order_id).first()
        if order:
            order.status = "ready"
    log_op(db, "transfer", user.id, bag_id=bag.id, order_id=bag.order_id, comment=tp)
    db.commit()
    return {"ok": True, "message": f"Сумка {bag.id} на точке передачи: {tp}", "status": "at_transfer"}


# ---------- issue to executor ----------
@app.post("/api/issue")
def issue_bag(data: IssueIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    exec_id = normalize(data.executor_id).lower()
    bag_id = normalize(data.bag_id).lower()
    if not is_user(exec_id):
        raise HTTPException(400, "Неверный код сотрудника. Формат: us + 6 цифр")
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    executor = db.query(User).filter(User.id == exec_id).first()
    if not executor or executor.status != "active":
        raise HTTPException(404, "Исполнитель не найден или неактивен")
    if executor.role not in ("cleaner", "handyman"):
        raise HTTPException(400, "Выдавать сумку можно только клинеру или мастеру")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    if bag.status != "at_transfer":
        raise HTTPException(400, f"Сумка не на точке передачи (статус: {bag.status})")

    bag.status = "in_use"
    bag.executor_id = exec_id
    bag.issued_at = datetime.utcnow()
    if bag.order_id:
        order = db.query(Order).filter(Order.id == bag.order_id).first()
        if order:
            order.status = "issued"
            order.executor_id = exec_id
    for eq in db.query(Equipment).filter(Equipment.bag_id == bag.id).all():
        eq.status = "issued"
        touch_equipment(eq, user.id)
    log_op(db, "issue_to_executor", user.id, bag_id=bag.id, order_id=bag.order_id, comment=exec_id)
    db.commit()
    return {
        "ok": True,
        "message": f"Сумка {bag.id} выдана {executor.full_name} ({exec_id})",
        "executor": {"id": executor.id, "name": executor.full_name},
    }


# ---------- unpack ----------
@app.post("/api/unpack/start")
def unpack_start(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.code).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки. Формат: sumka + 5 цифр")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    if bag.status not in ("in_use", "awaiting_unpack"):
        # allow return from executor
        if bag.status == "in_use":
            pass
        else:
            raise HTTPException(400, f"Сумку нельзя разбирать (статус: {bag.status})")
    bag.status = "awaiting_unpack"
    bag.returned_at = datetime.utcnow()
    items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    db.commit()
    return {
        "ok": True, "bag_id": bag.id,
        "expected": [{"id": e.id, "name": e.name, "status": e.status} for e in items],
        "message": "Сканируйте оборудование, затем ячейку",
    }


@app.post("/api/unpack/item")
def unpack_item(data: UnpackItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    eq_id = normalize(data.equipment_id).lower()
    cell_code = normalize(data.cell_code)
    if not is_equipment(eq_id):
        raise HTTPException(400, "Неверный код оборудования")
    if not is_cell(cell_code):
        raise HTTPException(400, "Неверный код ячейки. Пример: DY0010661/2")
    if not db.query(Cell).filter(Cell.code == cell_code).first():
        # auto-accept format but prefer existing cells
        parsed = parse_cell(cell_code)
        if not parsed:
            raise HTTPException(400, "Ячейка не найдена и формат неверный")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    if eq.bag_id != bag.id:
        raise HTTPException(400, "Это оборудование не из данной сумки")

    eq.status = "in_cell"
    eq.cell_code = cell_code
    eq.bag_id = None
    touch_equipment(eq, user.id)
    log_op(db, "unpack_item", user.id, bag_id=bag.id, equipment_id=eq.id, cell_code=cell_code)
    remaining = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    if not remaining:
        bag.status = "free"
        bag.order_id = None
        bag.executor_id = None
        bag.transfer_point = None
        bag.assembly_started_at = None
    db.commit()
    return {
        "ok": True, "remaining": len(remaining),
        "remaining_items": [{"id": e.id, "name": e.name} for e in remaining],
        "bag_empty": len(remaining) == 0,
        "message": "Размещено" if remaining else "Сумка разобрана",
    }


@app.post("/api/unpack/damage")
def unpack_damage(data: DamageIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    if not is_problem_zone(data.zone_code):
        raise HTTPException(400, f"Отсканируйте зону {PROBLEM_ZONE}")
    eq_id = normalize(data.equipment_id).lower()
    bag_id = normalize(data.bag_id).lower()
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    eq.status = "damaged"
    eq.bag_id = None
    eq.cell_code = PROBLEM_ZONE
    touch_equipment(eq, user.id)
    log_op(db, "damage", user.id, bag_id=bag_id, equipment_id=eq.id, comment=PROBLEM_ZONE)
    db.commit()
    return {"ok": True, "message": f"{eq.id} отправлено в {PROBLEM_ZONE}"}


@app.post("/api/unpack/declare-empty")
def declare_empty(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    """Оборудование размещено — показать чего не хватает"""
    bag_id = normalize(data.code).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    missing = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    return {
        "bag_id": bag.id,
        "missing": [{"id": e.id, "name": e.name, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2} for e in missing],
        "has_missing": len(missing) > 0,
    }


@app.post("/api/unpack/start-investigation")
def start_investigation(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.code).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    missing = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    reports = []
    for eq in missing:
        eq.status = "missing"
        eq.bag_id = None
        touch_equipment(eq, user.id)
        rep = MissingReport(
            equipment_id=eq.id, bag_id=bag.id, order_id=bag.order_id,
            reported_by=user.id, last_user_1=eq.last_user_1, last_user_2=eq.last_user_2,
        )
        db.add(rep)
        reports.append(eq.id)
        log_op(db, "missing", user.id, bag_id=bag.id, equipment_id=eq.id)
    bag.status = "free"
    bag.order_id = None
    bag.executor_id = None
    db.commit()
    return {"ok": True, "missing_ids": reports, "message": "Расследование запущено. Сумка свободна."}


# ---------- receiving ----------
@app.post("/api/equipment-types")
def add_ean(data: EanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    ean = normalize(data.ean)
    if db.query(EquipmentType).filter(EquipmentType.ean == ean).first():
        raise HTTPException(400, "EAN уже есть")
    t = EquipmentType(ean=ean, name=data.name, category=data.category)
    db.add(t)
    db.commit()
    return {"ean": t.ean, "name": t.name}


@app.get("/api/equipment-types")
def list_eans(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [{"ean": t.ean, "name": t.name, "category": t.category} for t in db.query(EquipmentType).all()]


@app.post("/api/receive")
def receive_unit(data: ReceiveIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    ean = normalize(data.ean)
    eq_id = normalize(data.equipment_id).lower()
    if not is_equipment(eq_id):
        raise HTTPException(400, "Код единицы: dd + 8 цифр")
    t = db.query(EquipmentType).filter(EquipmentType.ean == ean).first()
    if not t:
        raise HTTPException(404, "EAN не найден. Админ должен добавить тип оборудования")
    if db.query(Equipment).filter(Equipment.id == eq_id).first():
        raise HTTPException(400, "Такой код единицы уже существует")
    eq = Equipment(id=eq_id, ean=ean, name=t.name, status="receiving")
    touch_equipment(eq, user.id)
    db.add(eq)
    log_op(db, "receive", user.id, equipment_id=eq.id, comment=ean)
    db.commit()
    return {"ok": True, "equipment_id": eq.id, "name": eq.name, "message": "Принято. Отсканируйте ячейку"}


@app.post("/api/receive/place")
def receive_place(data: PlaceIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    eq_id = normalize(data.equipment_id).lower()
    cell_code = normalize(data.cell_code)
    if not is_cell(cell_code):
        raise HTTPException(400, "Неверный код ячейки")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    eq.status = "in_cell"
    eq.cell_code = cell_code
    touch_equipment(eq, user.id)
    log_op(db, "place_cell", user.id, equipment_id=eq.id, cell_code=cell_code)
    db.commit()
    return {"ok": True, "message": f"{eq.id} размещён в {cell_code}"}


# ---------- missing / admin ----------
@app.get("/api/missing")
def list_missing(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    rows = db.query(MissingReport).filter(MissingReport.status == "open").order_by(MissingReport.created_at.desc()).all()
    result = []
    for r in rows:
        eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
        result.append({
            "id": r.id, "equipment_id": r.equipment_id,
            "name": eq.name if eq else r.equipment_id,
            "bag_id": r.bag_id, "order_id": r.order_id,
            "last_user_1": r.last_user_1, "last_user_2": r.last_user_2,
            "reported_by": r.reported_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return result


@app.get("/api/equipment")
def list_equipment(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [
        {"id": e.id, "name": e.name, "status": e.status, "cell_code": e.cell_code,
         "bag_id": e.bag_id, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2}
        for e in db.query(Equipment).order_by(Equipment.id).all()
    ]


@app.get("/api/orders")
def list_orders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Order).order_by(Order.created_at.desc())
    if user.role in ("cleaner", "handyman"):
        q = q.filter(Order.executor_id == user.id)
    return [
        {"id": o.id, "address": o.address, "status": o.status, "executor_id": o.executor_id,
         "bag_id": o.bag_id, "cutoff_minutes": o.cutoff_minutes, "client_name": o.client_name,
         "cleaning_type": o.cleaning_type}
        for o in q.all()
    ]



# ---------- transfer points ----------
@app.get("/api/transfer-points")
def list_tp(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [{"code": t.code, "name": t.name} for t in db.query(TransferPoint).order_by(TransferPoint.code).all()]


@app.post("/api/transfer-points")
def add_tp(data: TransferPointIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    code = normalize(data.code).upper()
    if not code.startswith("TP"):
        raise HTTPException(400, "Код точки должен начинаться с TP (пример: TP01)")
    if db.query(TransferPoint).filter(TransferPoint.code == code).first():
        raise HTTPException(400, "Точка уже существует")
    tp = TransferPoint(code=code, name=data.name)
    db.add(tp)
    db.commit()
    return {"code": tp.code, "name": tp.name}


# ---------- orders create / send to assembly ----------
def _next_order_id(db: Session) -> str:
    last = db.query(Order).order_by(Order.id.desc()).first()
    n = 1
    if last and last.id.startswith("ORD"):
        try:
            n = int(last.id.replace("ORD", "")) + 1
        except ValueError:
            n = 1
    return f"ORD{n:05d}"


@app.post("/api/orders")
def create_order(data: OrderCreateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if not data.address or not data.address.strip():
        raise HTTPException(400, "Укажите адрес объекта")
    if data.executor_id:
        ex = db.query(User).filter(User.id == normalize(data.executor_id).lower()).first()
        if not ex or ex.role not in ("cleaner", "handyman"):
            raise HTTPException(400, "Исполнитель: клинер или мастер (us…)")
    oid = _next_order_id(db)
    status = "awaiting_assembly" if data.send_to_assembly else "new"
    order = Order(
        id=oid,
        client_name=data.client_name,
        address=data.address.strip(),
        cleaning_type=data.cleaning_type,
        executor_id=normalize(data.executor_id).lower() if data.executor_id else None,
        status=status,
        cutoff_minutes=data.cutoff_minutes or 10,
        signal_sent=bool(data.send_to_assembly),
        created_at=datetime.utcnow(),
    )
    db.add(order)
    log_op(db, "order_created", user.id, order_id=oid, comment="to_assembly" if data.send_to_assembly else "draft")
    db.commit()
    return {
        "id": order.id,
        "status": order.status,
        "signal": order.signal_sent,
        "message": f"Заказ {order.id} " + ("отправлен на сборку" if data.send_to_assembly else "создан"),
    }


@app.post("/api/orders/{order_id}/send-to-assembly")
def send_to_assembly(order_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status not in ("new", "cancelled"):
        raise HTTPException(400, f"Нельзя отправить (статус: {order.status})")
    order.status = "awaiting_assembly"
    order.signal_sent = True
    log_op(db, "send_to_assembly", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": f"Заказ {order.id} на сборке", "signal": True}


@app.get("/api/tsd/signals")
def tsd_signals(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    """Новые заказы для сигнала на ТСД"""
    orders = db.query(Order).filter(
        Order.status == "awaiting_assembly",
        Order.signal_sent == True,
    ).order_by(Order.created_at.desc()).limit(20).all()
    return [
        {
            "order_id": o.id,
            "address": o.address,
            "cutoff_minutes": o.cutoff_minutes,
            "executor_id": o.executor_id,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "beep": True,
        }
        for o in orders
    ]


# ---------- return bag from executor ----------
@app.post("/api/bags/return")
def return_bag(data: ReturnBagIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    if bag.status != "in_use":
        raise HTTPException(400, f"Сумка не у исполнителя (статус: {bag.status})")
    bag.status = "awaiting_unpack"
    bag.returned_at = datetime.utcnow()
    if bag.order_id:
        order = db.query(Order).filter(Order.id == bag.order_id).first()
        if order and order.status == "issued":
            order.status = "done"
    log_op(db, "bag_return", user.id, bag_id=bag.id, order_id=bag.order_id)
    db.commit()
    return {
        "ok": True,
        "message": f"Сумка {bag.id} принята, ждёт разбор",
        "status": "awaiting_unpack",
    }


# validate transfer point on assembly finish - patch existing if needed

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Домовой", "version": "2.0"}


# ---------- frontend ----------
@app.get("/")
def index():
    path = os.path.join(FRONTEND, "index.html")
    if os.path.isfile(path):
        return FileResponse(path)
    return HTMLResponse("<h1>Домовой</h1><p>Frontend not found</p>")


@app.get("/app.js")
def app_js():
    return FileResponse(os.path.join(FRONTEND, "app.js"))


@app.get("/styles.css")
def app_css():
    return FileResponse(os.path.join(FRONTEND, "styles.css"))
