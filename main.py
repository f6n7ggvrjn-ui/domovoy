
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, List
import os

try:
    from database import Base, engine, get_db, SessionLocal
    from models import (
        User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint, UserChangeLog
    )
    from auth import (
        hash_password, verify_password, make_token, get_current_user, require_roles, ROLE_LABELS
    )
    from codes import (
        is_bag, is_equipment, is_user, is_cell, parse_cell, is_problem_zone, is_ean, normalize, PROBLEM_ZONE
    )
    from seed import seed
except ImportError:
    from .database import Base, engine, get_db, SessionLocal
    from .models import (
        User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint, UserChangeLog
    )
    from .auth import (
        hash_password, verify_password, make_token, get_current_user, require_roles, ROLE_LABELS
    )
    from .codes import (
        is_bag, is_equipment, is_user, is_cell, parse_cell, is_problem_zone, is_ean, normalize, PROBLEM_ZONE
    )
    from .seed import seed

Base.metadata.create_all(bind=engine)
# soft-add columns for existing sqlite
def _migrate():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        cols = {
            "orders": [
                ("object_info", "TEXT"),
                ("is_late", "BOOLEAN DEFAULT 0"),
                ("late_minutes", "INTEGER"),
                ("completion_requested_at", "DATETIME"),
                ("completed_at", "DATETIME"),
                ("completed_by", "VARCHAR(20)"),
            ],
            "missing_reports": [
                ("kind", "VARCHAR(20) DEFAULT 'missing'"),
            ],
            "users": [
                ("block_reason", "TEXT"),
            ],
        }
        for table, additions in cols.items():
            existing = set()
            try:
                rows = db.execute(text(f"PRAGMA table_info({table})")).fetchall()
                existing = {r[1] for r in rows}
            except Exception:
                continue
            for name, typ in additions:
                if name not in existing:
                    try:
                        db.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {typ}"))
                        db.commit()
                    except Exception:
                        db.rollback()
    finally:
        db.close()

try:
    _migrate()
except Exception as e:
    print("migrate skip", e)

db0 = SessionLocal()
try:
    seed(db0)
finally:
    db0.close()

app = FastAPI(title="Домовой", version="2.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

_here = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(os.path.dirname(_here))
for cand in [
    os.path.join(os.path.dirname(os.path.dirname(_here)), "frontend"),
    os.path.join(os.path.dirname(_here), "frontend"),
    _here,
    "/app/frontend",
]:
    if os.path.isfile(os.path.join(cand, "index.html")):
        FRONTEND = cand
        break

ORDER_LABELS = {
    "new": "Новый",
    "awaiting_assembly": "Ожидает сборки",
    "assembling": "Сборка",
    "assembling_late": "Сборка (опоздание)",
    "ready": "На точке передачи",
    "issued": "На заказе",
    "completion_pending": "Ожидает подтверждения завершения",
    "done": "Завершён",
    "cancelled": "Отменён",
}

class LoginIn(BaseModel):
    login: str
    password: str

class EmployeeIn(BaseModel):
    full_name: str
    birth_date: Optional[str] = None
    role: str
    password: Optional[str] = None

class EmployeeUpdateIn(BaseModel):
    full_name: Optional[str] = None
    birth_date: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    status: Optional[str] = None
    block_reason: Optional[str] = None

class BlockIn(BaseModel):
    reason: str

class PasswordChangeIn(BaseModel):
    old_password: Optional[str] = None
    new_password: str

class BagCreateIn(BaseModel):
    bag_id: str

class AdminSelfIn(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None

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
    object_info: Optional[str] = None
    executor_id: Optional[str] = None
    cutoff_minutes: int = 10
    send_to_assembly: bool = True

class TransferPointIn(BaseModel):
    code: str
    name: str

class TransferPointUpdateIn(BaseModel):
    name: str

class ReturnBagIn(BaseModel):
    bag_id: str

class ReassignIn(BaseModel):
    executor_id: str

class MissingActionIn(BaseModel):
    report_id: int
    cell_code: Optional[str] = None

def touch_equipment(eq: Equipment, user_id: str):
    eq.last_user_2 = eq.last_user_1
    eq.last_user_1 = user_id

def log_op(db, type_, user_id, **kw):
    db.add(Operation(type=type_, user_id=user_id, **kw))

def log_user_change(db, user_id, changed_by, field, old, new):
    db.add(UserChangeLog(
        user_id=user_id, changed_by=changed_by, field=field,
        old_value=None if old is None else str(old),
        new_value=None if new is None else str(new),
    ))

def mark_late_if_needed(bag: Bag, order: Optional[Order]):
    if not bag.assembly_started_at:
        return
    mins = bag.cutoff_minutes or (order.cutoff_minutes if order else 10) or 10
    end = bag.assembly_started_at + timedelta(minutes=mins)
    if datetime.utcnow() > end:
        late = int((datetime.utcnow() - end).total_seconds() // 60)
        if order:
            order.is_late = True
            order.late_minutes = max(order.late_minutes or 0, late)
            if order.status == "assembling":
                order.status = "assembling_late"

# ---------- auth ----------
@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    login = normalize(data.login).lower()
    user = db.query(User).filter(User.id == login).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    if user.status == "fired":
        raise HTTPException(403, "Учётная запись отключена")
    return {
        "access_token": make_token(user.id, user.role),
        "user": {
            "id": user.id, "full_name": user.full_name, "role": user.role,
            "role_label": ROLE_LABELS.get(user.role, user.role),
            "status": user.status,
        },
    }

@app.get("/api/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id, "full_name": user.full_name, "role": user.role,
        "role_label": ROLE_LABELS.get(user.role, user.role),
        "status": user.status,
        "block_reason": user.block_reason if user.role == "admin" else None,
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
    if data.role not in ("warehouse", "cleaner", "handyman", "admin"):
        raise HTTPException(400, "Роль: warehouse / cleaner / handyman / admin")
    nid = next_employee_id(db, user)["id"]
    while db.query(User).filter(User.id == nid).first():
        n = int(nid[2:]) + 1
        nid = f"us{n:06d}"
    pwd = data.password or "123456"
    u = User(
        id=nid, full_name=data.full_name, birth_date=data.birth_date,
        role=data.role,
        status="active", password_hash=hash_password(pwd),
    )
    db.add(u)
    log_user_change(db, u.id, user.id, "created", None, f"{u.role}/{u.full_name}")
    db.commit()
    return {"id": u.id, "full_name": u.full_name, "role": u.role, "password": pwd}

@app.patch("/api/employees/{emp_id}")
def update_employee(emp_id: str, data: EmployeeUpdateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Сотрудник не найден")
    if data.full_name is not None and data.full_name != u.full_name:
        log_user_change(db, u.id, user.id, "full_name", u.full_name, data.full_name)
        u.full_name = data.full_name
    if data.birth_date is not None and data.birth_date != u.birth_date:
        log_user_change(db, u.id, user.id, "birth_date", u.birth_date, data.birth_date)
        u.birth_date = data.birth_date
    if data.role is not None and data.role in ("warehouse", "cleaner", "handyman", "admin") and data.role != u.role:
        log_user_change(db, u.id, user.id, "role", u.role, data.role)
        u.role = data.role
    if data.status is not None and data.status in ("active", "blocked", "fired") and data.status != u.status:
        log_user_change(db, u.id, user.id, "status", u.status, data.status)
        u.status = data.status
        if data.status == "active":
            u.block_reason = None
    if data.block_reason is not None:
        log_user_change(db, u.id, user.id, "block_reason", u.block_reason, data.block_reason)
        u.block_reason = data.block_reason
    if data.password:
        log_user_change(db, u.id, user.id, "password", "***", "***")
        u.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True, "id": u.id}

@app.post("/api/employees/{emp_id}/block")
def block_employee(emp_id: str, data: BlockIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    if u.id == user.id:
        raise HTTPException(400, "Нельзя заблокировать себя")
    reason = (data.reason or "").strip()
    if not reason:
        raise HTTPException(400, "Укажите причину блокировки")
    log_user_change(db, u.id, user.id, "status", u.status, "blocked")
    log_user_change(db, u.id, user.id, "block_reason", u.block_reason, reason)
    u.status = "blocked"
    u.block_reason = reason
    db.commit()
    return {"ok": True, "message": f"{u.id} заблокирован"}

@app.post("/api/employees/{emp_id}/unblock")
def unblock_employee(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    log_user_change(db, u.id, user.id, "status", u.status, "active")
    log_user_change(db, u.id, user.id, "block_reason", u.block_reason, None)
    u.status = "active"
    u.block_reason = None
    db.commit()
    return {"ok": True, "message": f"{u.id} разблокирован"}

@app.get("/api/employees/{emp_id}/history")
def employee_history(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    rows = db.query(UserChangeLog).filter(UserChangeLog.user_id == emp_id).order_by(UserChangeLog.created_at.desc()).limit(100).all()
    return [{
        "field": r.field, "old_value": r.old_value, "new_value": r.new_value,
        "changed_by": r.changed_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]

@app.get("/api/employees/search")
def search_employee(q: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    qn = normalize(q).lower()
    u = db.query(User).filter(User.id == qn).first()
    if not u:
        # partial
        rows = db.query(User).filter(User.id.contains(qn)).limit(10).all()
        return [{"id": x.id, "full_name": x.full_name, "role": x.role,
                 "role_label": ROLE_LABELS.get(x.role, x.role), "status": x.status,
                 "block_reason": x.block_reason, "birth_date": x.birth_date} for x in rows]
    return [{
        "id": u.id, "full_name": u.full_name, "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role), "status": u.status,
        "block_reason": u.block_reason, "birth_date": u.birth_date,
    }]

@app.delete("/api/employees/{emp_id}")
def delete_employee(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    if u.id == user.id:
        raise HTTPException(400, "Нельзя уволить себя")
    log_user_change(db, u.id, user.id, "status", u.status, "fired")
    u.status = "fired"
    u.block_reason = None
    db.commit()
    return {"ok": True, "message": f"{emp_id} уволен (можно восстановить)"}

@app.post("/api/employees/{emp_id}/restore")
def restore_employee(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    if u.status not in ("fired", "blocked"):
        raise HTTPException(400, f"Сейчас статус: {u.status}")
    log_user_change(db, u.id, user.id, "status", u.status, "active")
    log_user_change(db, u.id, user.id, "block_reason", u.block_reason, None)
    u.status = "active"
    u.block_reason = None
    db.commit()
    return {"ok": True, "message": f"{u.id} восстановлен, можно входить"}

@app.post("/api/missing/restore")
def restore_missing(data: MissingActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    r = db.query(MissingReport).filter(MissingReport.id == data.report_id).first()
    if not r or r.status != "open":
        raise HTTPException(404, "Запись не найдена")
    cell = data.cell_code or "DY0010661/2"
    if not is_cell(cell):
        raise HTTPException(400, "Укажите ячейку для возврата")
    eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
    if eq:
        eq.status = "in_cell"
        eq.cell_code = cell
        eq.bag_id = None
        touch_equipment(eq, user.id)
    r.status = "restored"
    log_op(db, "restore", user.id, equipment_id=r.equipment_id, cell_code=cell)
    db.commit()
    return {"ok": True, "message": f"Возвращено на учёт в {cell}"}

# ---------- orders ----------
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
        raise HTTPException(400, "Укажите адрес")
    if data.executor_id:
        ex = db.query(User).filter(User.id == normalize(data.executor_id).lower()).first()
        if not ex or ex.role not in ("cleaner", "handyman"):
            raise HTTPException(400, "Исполнитель: клинер или мастер")
    oid = _next_order_id(db)
    status = "awaiting_assembly" if data.send_to_assembly else "new"
    order = Order(
        id=oid, client_name=data.client_name, address=data.address.strip(),
        cleaning_type=data.cleaning_type, object_info=data.object_info,
        executor_id=normalize(data.executor_id).lower() if data.executor_id else None,
        status=status, cutoff_minutes=data.cutoff_minutes or 10,
        signal_sent=bool(data.send_to_assembly), created_at=datetime.utcnow(),
    )
    db.add(order)
    log_op(db, "order_created", user.id, order_id=oid)
    db.commit()
    return {"id": order.id, "status": order.status, "signal": order.signal_sent,
            "message": f"Заказ {order.id} " + ("на сборку" if data.send_to_assembly else "создан")}

@app.post("/api/orders/{order_id}/send-to-assembly")
def send_to_assembly(order_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    if order.status not in ("new", "cancelled"):
        raise HTTPException(400, f"Нельзя ({order.status})")
    order.status = "awaiting_assembly"
    order.signal_sent = True
    log_op(db, "send_to_assembly", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": f"{order.id} на сборке", "signal": True}

@app.post("/api/orders/{order_id}/request-complete")
def request_complete(order_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    if user.role in ("cleaner", "handyman") and order.executor_id != user.id:
        raise HTTPException(403, "Не ваш заказ")
    if order.status != "issued":
        raise HTTPException(400, "Заказ не на исполнении")
    order.status = "completion_pending"
    order.completion_requested_at = datetime.utcnow()
    log_op(db, "complete_request", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": "Запрос на завершение отправлен админу"}

@app.post("/api/orders/{order_id}/confirm-complete")
def confirm_complete(order_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    if order.status != "completion_pending":
        raise HTTPException(400, "Нет запроса на завершение")
    order.status = "done"
    order.completed_at = datetime.utcnow()
    order.completed_by = user.id
    log_op(db, "complete_confirm", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": f"Заказ {order.id} завершён"}

@app.post("/api/orders/{order_id}/reassign")
def reassign_order(order_id: str, data: ReassignIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    eid = normalize(data.executor_id).lower()
    ex = db.query(User).filter(User.id == eid).first()
    if not ex or ex.role not in ("cleaner", "handyman") or ex.status != "active":
        raise HTTPException(400, "Некорректный исполнитель")
    old = order.executor_id
    order.executor_id = eid
    if order.bag_id:
        bag = db.query(Bag).filter(Bag.id == order.bag_id).first()
        if bag and bag.status == "in_use":
            bag.executor_id = eid
    log_op(db, "reassign", user.id, order_id=order.id, comment=f"{old}->{eid}")
    db.commit()
    return {"ok": True, "message": f"Исполнитель: {ex.full_name}"}

@app.get("/api/orders")
def list_orders(scope: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # purge done orders older than 3 months
    cutoff = datetime.utcnow() - timedelta(days=90)
    old_done = db.query(Order).filter(Order.status == "done", Order.completed_at != None, Order.completed_at < cutoff).all()
    for o in old_done:
        db.delete(o)
    if old_done:
        db.commit()

    q = db.query(Order).order_by(Order.created_at.desc())
    if user.role in ("cleaner", "handyman"):
        q = q.filter(Order.executor_id == user.id)
        if scope == "history":
            # current month completed
            now = datetime.utcnow()
            start = datetime(now.year, now.month, 1)
            q = q.filter(Order.status == "done", Order.completed_at >= start)
        else:
            q = q.filter(Order.status != "done")
    else:
        if scope == "history":
            q = q.filter(Order.status == "done")
        elif scope == "active":
            q = q.filter(Order.status != "done")
    result = []
    for o in q.all():
        bag = db.query(Bag).filter(Bag.id == o.bag_id).first() if o.bag_id else None
        result.append({
            "id": o.id, "address": o.address, "status": o.status,
            "status_label": ORDER_LABELS.get(o.status, o.status),
            "executor_id": o.executor_id, "bag_id": o.bag_id,
            "cutoff_minutes": o.cutoff_minutes, "client_name": o.client_name,
            "cleaning_type": o.cleaning_type, "object_info": o.object_info,
            "is_late": bool(o.is_late), "late_minutes": o.late_minutes,
            "bag_status": bag.status if bag else None,
            "transfer_point": bag.transfer_point if bag else None,
            "completed_at": o.completed_at.isoformat() if o.completed_at else None,
            "completed_by": o.completed_by,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        })
    return result


@app.get("/api/orders/{order_id}/history")
def order_history(order_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ops = db.query(Operation).filter(Operation.order_id == order_id).order_by(Operation.datetime).all()
    return [{"type": o.type, "user_id": o.user_id, "comment": o.comment,
             "datetime": o.datetime.isoformat() if o.datetime else None,
             "bag_id": o.bag_id, "equipment_id": o.equipment_id} for o in ops]

@app.get("/api/transfer-points")
def list_tp(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [{"code": t.code, "name": t.name} for t in db.query(TransferPoint).order_by(TransferPoint.code).all()]

@app.post("/api/transfer-points")
def add_tp(data: TransferPointIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    code = normalize(data.code).upper()
    if not code.startswith("TP"):
        raise HTTPException(400, "Код: TP01 …")
    if db.query(TransferPoint).filter(TransferPoint.code == code).first():
        raise HTTPException(400, "Уже есть")
    tp = TransferPoint(code=code, name=data.name)
    db.add(tp)
    db.commit()
    return {"code": tp.code, "name": tp.name}

@app.patch("/api/transfer-points/{code}")
def edit_tp(code: str, data: TransferPointUpdateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    tp = db.query(TransferPoint).filter(TransferPoint.code == code.upper()).first()
    if not tp:
        raise HTTPException(404, "Не найдена")
    tp.name = data.name
    db.commit()
    return {"code": tp.code, "name": tp.name}

@app.delete("/api/transfer-points/{code}")
def del_tp(code: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    tp = db.query(TransferPoint).filter(TransferPoint.code == code.upper()).first()
    if not tp:
        raise HTTPException(404, "Не найдена")
    db.delete(tp)
    db.commit()
    return {"ok": True}

@app.post("/api/bags/return")
def return_bag(data: ReturnBagIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Не найдена")
    if bag.status != "in_use":
        raise HTTPException(400, f"Не у исполнителя ({bag.status})")
    bag.status = "awaiting_unpack"
    bag.returned_at = datetime.utcnow()
    log_op(db, "bag_return", user.id, bag_id=bag.id, order_id=bag.order_id)
    db.commit()
    return {"ok": True, "message": f"Сумка {bag.id} ждёт разбор", "status": "awaiting_unpack"}



@app.post("/api/bags")
def create_bag(data: BagCreateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Формат: sumka + 5 цифр")
    if db.query(Bag).filter(Bag.id == bag_id).first():
        raise HTTPException(400, "Сумка уже есть")
    db.add(Bag(id=bag_id, status="free"))
    log_op(db, "bag_create", user.id, bag_id=bag_id)
    db.commit()
    return {"ok": True, "id": bag_id}

@app.delete("/api/bags/{bag_id}")
def delete_bag(bag_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    bag_id = normalize(bag_id).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Не найдена")
    if bag.status != "free":
        raise HTTPException(400, f"Можно удалить только свободную сумку (сейчас: {bag.status})")
    left = db.query(Equipment).filter(Equipment.bag_id == bag.id).count()
    if left:
        raise HTTPException(400, "В сумке ещё есть оборудование")
    db.delete(bag)
    log_op(db, "bag_delete", user.id, bag_id=bag_id)
    db.commit()
    return {"ok": True}

@app.post("/api/admin/password")
def admin_change_password(data: PasswordChangeIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if not data.new_password or len(data.new_password) < 4:
        raise HTTPException(400, "Пароль минимум 4 символа")
    if data.old_password and not verify_password(data.old_password, user.password_hash):
        raise HTTPException(400, "Старый пароль неверен")
    log_user_change(db, user.id, user.id, "password", "***", "***")
    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True, "message": "Пароль изменён"}

@app.post("/api/admin/profile")
def admin_update_self(data: AdminSelfIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if data.full_name:
        log_user_change(db, user.id, user.id, "full_name", user.full_name, data.full_name)
        user.full_name = data.full_name
    if data.password:
        if len(data.password) < 4:
            raise HTTPException(400, "Пароль минимум 4 символа")
        log_user_change(db, user.id, user.id, "password", "***", "***")
        user.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True, "full_name": user.full_name}

@app.post("/api/bags/{bag_id}/force-free")
def force_free_bag(bag_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    """Сброс зависшей сумки: оборудование возвращается на склад (первая ячейка), заказ снова ждёт сборки."""
    bag_id = normalize(bag_id).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")

    items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    # ячейка по умолчанию для возврата
    default_cell = db.query(Cell).order_by(Cell.code).first()
    default_code = default_cell.code if default_cell else "DY0010661/2"

    returned = []
    for eq in items:
        eq.bag_id = None
        eq.status = "in_cell"
        eq.cell_code = default_code
        returned.append(eq.id)
        log_op(db, "bag_force_return", user.id, bag_id=bag.id, equipment_id=eq.id, cell_code=default_code)

    order_id = bag.order_id
    if order_id:
        order = db.query(Order).filter(Order.id == order_id).first()
        if order and order.status in ("assembling", "assembling_late", "ready", "issued"):
            order.status = "awaiting_assembly"
            order.bag_id = None
            log_op(db, "assembly_cancelled", user.id, order_id=order.id, bag_id=bag.id)

    bag.status = "free"
    bag.order_id = None
    bag.executor_id = None
    bag.transfer_point = None
    bag.assembled_by = None
    bag.assembly_started_at = None
    bag.assembly_finished_at = None
    bag.issued_at = None
    log_op(db, "bag_force_free", user.id, bag_id=bag.id, comment=f"returned:{len(returned)}")
    db.commit()
    msg = f"Сумка {bag.id} свободна"
    if returned:
        msg += f". Оборудование ({len(returned)} шт) → {default_code}"
    if order_id:
        msg += f". Заказ {order_id} снова ожидает сборки"
    return {"ok": True, "message": msg, "returned": returned, "cell": default_code}

@app.get("/api/tsd/signals")
def tsd_signals(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    orders = db.query(Order).filter(Order.status == "awaiting_assembly", Order.signal_sent == True).order_by(Order.created_at.desc()).limit(20).all()
    return [{"order_id": o.id, "address": o.address, "cutoff_minutes": o.cutoff_minutes,
             "executor_id": o.executor_id, "beep": True} for o in orders]

@app.get("/api/equipment")
def list_equipment(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [{"id": e.id, "name": e.name, "status": e.status, "cell_code": e.cell_code,
             "bag_id": e.bag_id, "ean": e.ean, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2}
            for e in db.query(Equipment).order_by(Equipment.id).all()]


@app.get("/api/lookup")
def lookup(code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Универсальная информация по объекту (как в Ozon WMS): что это и где сейчас."""
    raw = normalize(code)
    c = raw.lower()
    result = {"code": raw, "kind": None, "title": None, "location": None, "status": None, "details": {}}

    # --- bag ---
    if is_bag(c):
        bag = db.query(Bag).filter(Bag.id == c).first()
        if not bag:
            raise HTTPException(404, "Сумка не найдена в системе")
        labels = {
            "free": "Свободна", "assembling": "Собирается", "at_transfer": "На точке передачи",
            "in_use": "У исполнителя", "awaiting_unpack": "Ждёт разбор",
        }
        items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
        order = db.query(Order).filter(Order.id == bag.order_id).first() if bag.order_id else None
        loc_parts = []
        if bag.status == "free":
            loc_parts.append("на складе (свободна)")
        elif bag.status == "assembling":
            loc_parts.append(f"сборка, сборщик {bag.assembled_by or '—'}")
        elif bag.status == "at_transfer":
            loc_parts.append(f"точка передачи: {bag.transfer_point or '—'}")
        elif bag.status == "in_use":
            ex = db.query(User).filter(User.id == bag.executor_id).first() if bag.executor_id else None
            loc_parts.append(f"у исполнителя {bag.executor_id or '—'}" + (f" ({ex.full_name})" if ex else ""))
        elif bag.status == "awaiting_unpack":
            loc_parts.append("принята, ждёт разбор на складе")
        result.update({
            "kind": "bag",
            "title": f"Сумка {bag.id}",
            "status": labels.get(bag.status, bag.status),
            "location": "; ".join(loc_parts) if loc_parts else bag.status,
            "details": {
                "order_id": bag.order_id,
                "address": order.address if order else None,
                "object_info": order.object_info if order else None,
                "executor_id": bag.executor_id,
                "assembled_by": bag.assembled_by,
                "transfer_point": bag.transfer_point,
                "items_count": len(items),
                "items": [{"id": e.id, "name": e.name, "status": e.status} for e in items],
            },
        })
        return result

    # --- equipment unit ---
    if is_equipment(c):
        eq = db.query(Equipment).filter(Equipment.id == c).first()
        if not eq:
            raise HTTPException(404, "Оборудование не найдено")
        status_labels = {
            "in_cell": "В ячейке", "in_bag": "В сумке", "issued": "Выдано исполнителю",
            "damaged": "Повреждено", "missing": "Пропажа", "receiving": "Приёмка",
            "written_off": "Списано",
        }
        loc = None
        if eq.status == "in_cell" and eq.cell_code:
            loc = f"ячейка {eq.cell_code}"
        elif eq.bag_id:
            bag = db.query(Bag).filter(Bag.id == eq.bag_id).first()
            if bag and bag.status == "in_use" and bag.executor_id:
                loc = f"сумка {eq.bag_id} у исполнителя {bag.executor_id}"
            elif bag and bag.status == "at_transfer":
                loc = f"сумка {eq.bag_id} на точке {bag.transfer_point or 'передачи'}"
            elif bag and bag.status == "assembling":
                loc = f"сумка {eq.bag_id} (сборка, {bag.assembled_by or '—'})"
            elif bag and bag.status == "awaiting_unpack":
                loc = f"сумка {eq.bag_id} (ждёт разбор)"
            else:
                loc = f"сумка {eq.bag_id}"
        elif eq.status == "damaged":
            loc = f"зона повреждений ({eq.cell_code or 'PROBLEMNOE_OBORUDOVANIE'})"
        elif eq.status == "missing":
            loc = "пропажа (см. раздел Пропажи)"
        elif eq.status == "written_off":
            loc = "списано с учёта"
        result.update({
            "kind": "equipment",
            "title": eq.name or eq.id,
            "status": status_labels.get(eq.status, eq.status),
            "location": loc or eq.status,
            "details": {
                "id": eq.id,
                "ean": eq.ean,
                "cell_code": eq.cell_code,
                "bag_id": eq.bag_id,
                "last_user_1": eq.last_user_1,
                "last_user_2": eq.last_user_2,
            },
        })
        return result

    # --- cell ---
    if is_cell(raw) or is_cell(c.upper() if c.startswith("dy") else raw):
        code = raw if is_cell(raw) else ("DY" + raw[2:] if raw[:2].lower() == "dy" else raw)
        # try normalized
        parsed = parse_cell(raw)
        cell_code = None
        if parsed:
            # find exact
            for cell in db.query(Cell).all():
                if cell.code.upper() == raw.upper() or cell.code == parsed.get("code"):
                    cell_code = cell.code
                    break
            if not cell_code:
                cell_code = raw.upper().replace("DY", "DY") if raw.upper().startswith("DY") else raw
        else:
            cell_code = raw
        cell = db.query(Cell).filter(Cell.code == cell_code).first()
        if not cell:
            # try case-insensitive
            cell = db.query(Cell).filter(Cell.code.ilike(cell_code)).first()
        if not cell:
            raise HTTPException(404, "Ячейка не найдена")
        items = db.query(Equipment).filter(Equipment.cell_code == cell.code, Equipment.status == "in_cell").all()
        result.update({
            "kind": "cell",
            "title": f"Ячейка {cell.code}",
            "status": f"{len(items)} ед. на месте",
            "location": f"склад {cell.warehouse_no}, регион {cell.region}, полка {cell.shelf}/{cell.slot}",
            "details": {
                "code": cell.code,
                "items": [{"id": e.id, "name": e.name, "ean": e.ean} for e in items],
            },
        })
        return result

    # --- user ---
    if is_user(c):
        u = db.query(User).filter(User.id == c).first()
        if not u:
            raise HTTPException(404, "Сотрудник не найден")
        bags = db.query(Bag).filter(Bag.executor_id == u.id, Bag.status == "in_use").all()
        result.update({
            "kind": "user",
            "title": u.full_name,
            "status": ROLE_LABELS.get(u.role, u.role) + f" · {u.status}",
            "location": f"учётная запись {u.id}",
            "details": {
                "id": u.id,
                "role": u.role,
                "bags_in_use": [{"id": b.id, "order_id": b.order_id} for b in bags],
            },
        })
        return result

    # --- EAN / equipment type ---
    if is_ean(raw) or db.query(EquipmentType).filter(EquipmentType.ean == raw).first():
        trow = db.query(EquipmentType).filter(EquipmentType.ean == raw).first()
        if not trow:
            raise HTTPException(404, "EAN не найден")
        units = db.query(Equipment).filter(Equipment.ean == trow.ean, Equipment.status != "written_off").all()
        by_loc = {}
        for e in units:
            key = e.cell_code or (f"сумка {e.bag_id}" if e.bag_id else e.status)
            by_loc.setdefault(key, []).append(e.id)
        result.update({
            "kind": "ean",
            "title": trow.name,
            "status": f"{len(units)} ед. на учёте",
            "location": "см. размещение по ячейкам/сумкам",
            "details": {
                "ean": trow.ean,
                "category": trow.category,
                "placement": {k: v for k, v in by_loc.items()},
            },
        })
        return result

    # --- transfer point ---
    cu = raw.upper()
    tp = db.query(TransferPoint).filter(TransferPoint.code == cu).first()
    if tp:
        bags = db.query(Bag).filter(Bag.status == "at_transfer", Bag.transfer_point.contains(tp.code)).all()
        result.update({
            "kind": "transfer_point",
            "title": f"{tp.code} — {tp.name}",
            "status": f"сумок на точке: {len(bags)}",
            "location": tp.name,
            "details": {"bags": [b.id for b in bags]},
        })
        return result

    # --- order ---
    if c.upper().startswith("ORD") or c.startswith("ord"):
        oid = raw.upper() if raw.upper().startswith("ORD") else raw
        order = db.query(Order).filter(Order.id == oid).first()
        if not order:
            order = db.query(Order).filter(Order.id.ilike(oid)).first()
        if order:
            bag = db.query(Bag).filter(Bag.id == order.bag_id).first() if order.bag_id else None
            result.update({
                "kind": "order",
                "title": order.address,
                "status": ORDER_LABELS.get(order.status, order.status),
                "location": (f"сумка {order.bag_id}" if order.bag_id else "сумка не назначена")
                    + (f", исполнитель {order.executor_id}" if order.executor_id else ""),
                "details": {
                    "id": order.id,
                    "client_name": order.client_name,
                    "object_info": order.object_info,
                    "bag_id": order.bag_id,
                    "bag_status": bag.status if bag else None,
                    "executor_id": order.executor_id,
                    "is_late": bool(order.is_late),
                },
            })
            return result

    raise HTTPException(404, "Код не распознан. Сканируйте dd… / sumka… / DY… / us… / EAN / TP… / ORD…")

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Домовой", "version": "2.1"}

@app.get("/")
def index():
    path = os.path.join(FRONTEND, "index.html")
    if os.path.isfile(path):
        return FileResponse(path)
    # flat deploy: same folder as main
    alt = os.path.join(_here, "index.html")
    if os.path.isfile(alt):
        return FileResponse(alt)
    return HTMLResponse("<h1>Домовой</h1><p>Frontend not found</p>")

@app.get("/app.js")
def app_js():
    for p in [os.path.join(FRONTEND, "app.js"), os.path.join(_here, "app.js")]:
        if os.path.isfile(p):
            return FileResponse(p)
    raise HTTPException(404)

@app.get("/styles.css")
def app_css():
    for p in [os.path.join(FRONTEND, "styles.css"), os.path.join(_here, "styles.css")]:
        if os.path.isfile(p):
            return FileResponse(p)
    raise HTTPException(404)
