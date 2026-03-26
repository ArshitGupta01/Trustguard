import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URI = os.getenv("MONGODB_URI", "")
MONGO_DB = os.getenv("MONGODB_DB", "trustguard")

client: Optional[AsyncIOMotorClient] = None
db = None

if MONGO_URI:
    # Add serverSelectionTimeoutMS to fail fast (5s) instead of default 30s/90s hangs
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client[MONGO_DB]


async def insert_analysis(record: Dict[str, Any]) -> Optional[str]:
    if db is None:
        return None
    record["created_at"] = datetime.utcnow()
    result = await db.analysis_history.insert_one(record)
    return str(result.inserted_id)


async def get_analysis_by_product(product_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    if db is None:
        return []
    cursor = db.analysis_history.find({"product_id": product_id}).sort("created_at", -1).limit(limit)
    return [doc async for doc in cursor]


async def insert_label(label_doc: Dict[str, Any]) -> Optional[str]:
    if db is None:
        return None
    label_doc["created_at"] = datetime.utcnow()
    result = await db.labels.insert_one(label_doc)
    return str(result.inserted_id)


async def get_labels(limit: int = 100) -> List[Dict[str, Any]]:
    if db is None:
        return []
    cursor = db.labels.find().sort("created_at", -1).limit(limit)
    return [doc async for doc in cursor]


async def insert_audit(audit_doc: Dict[str, Any]) -> Optional[str]:
    if db is None:
        return None
    audit_doc["created_at"] = datetime.utcnow()
    result = await db.audit_logs.insert_one(audit_doc)
    return str(result.inserted_id)
