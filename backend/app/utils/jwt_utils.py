import os
import time
import jwt

SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")
EXPIRY = 7 * 24 * 3600  # 7 days


def encode(payload: dict) -> str:
    data = {**payload, "exp": int(time.time()) + EXPIRY, "iat": int(time.time())}
    return jwt.encode(data, SECRET, algorithm="HS256")


def decode(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_user_from_request(request) -> dict | None:
    token = request.cookies.get("lyricus_token")
    if not token:
        return None
    return decode(token)

