import os
import requests
import asyncio
from typing import Optional

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:latest")


async def query_qwen(prompt: str, max_tokens: int = 256, temperature: float = 0.3) -> Optional[str]:
    """Asynchronous wrapper for Ollama Qwen query"""
    if not prompt:
        return None

    return await asyncio.to_thread(_query_qwen_sync, prompt, max_tokens, temperature)


def _query_qwen_sync(prompt: str, max_tokens: int, temperature: float) -> Optional[str]:
    """Synchronous implementation of Ollama Qwen query"""
    try:
        payload = {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }
        url = f"{OLLAMA_URL}/api/generate"
        resp = requests.post(url, json=payload, timeout=45)
        resp.raise_for_status()
        data = resp.json()

        return data.get("response")

    except Exception as exc:
        return f"OLLAMA error: {exc}"
