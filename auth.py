from datetime import datetime, timedelta
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import bcrypt
import jwt

try:
    from database import get_db
    from models import User
except ImportError:
    from .database import get_db
    from .models import User

SECRET = "domovoy-prod-secret-2026"
security = HTTPBearer()

ROLE_LABELS = {
    "admin": "Админ",
    "crm_lead": "Старший участка CRM",
    "prod_lead": "Старший участка производства",
    "supervisor": "Старший участка производства",  # legacy → prod_lead
    "warehouse": "Склад",
    "order_manager": "CRM-менеджер",
    "executor": "Исполнитель",
    "cleaner": "Исполнитель",
    "handyman": "Исполнитель",
}

# роли для складских операций (сборка, выдача, …)
WAREHOUSE_OPS_ROLES = ("admin", "prod_lead", "supervisor", "warehouse")
# назначение исполнителя
ASSIGN_ROLES = ("admin", "prod_lead", "supervisor")
# подтверждение завершения
COMPLETE_ROLES = ("admin", "prod_lead", "supervisor")
# отмена заказа
CANCEL_ROLES = ("admin", "crm_lead")
# смена: кто кого отмечает — в endpoints


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())

def make_token(user_id: str, role: str) -> str:
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": datetime.utcnow() + timedelta(hours=48)},
        SECRET, algorithm="HS256",
    )

def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(cred.credentials, SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Неверный или истёкший токен")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or user.status == "fired":
        raise HTTPException(403, "Доступ запрещён")
    return user

def require_roles(*roles):
    def _inner(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(403, f"Нужна роль: {', '.join(roles)}")
        return user
    return _inner
