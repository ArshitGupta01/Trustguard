#!/usr/bin/env python3
"""
Test script for TrustGuard API with MongoDB and Ollama integration
"""

import asyncio
import json
from app import app
from fastapi.testclient import TestClient

def test_health():
    """Test health endpoint"""
    client = TestClient(app)
    response = client.get('/health')
    print("Health check:", response.json())
    return response.status_code == 200

def test_mongodb_connection():
    """Test MongoDB connection"""
    from db import db
    if db is not None:
        print(" MongoDB connected to database:", db.name)
        try:
            collections = db.list_collection_names()
            print(" Existing collections:", collections)
            return True
        except Exception as e:
            print(" MongoDB connection error:", e)
            return False
    else:
        print(" MongoDB not connected (check if MongoDB is running)")
        return False

def test_ollama_connection():
    """Test Ollama connection"""
    from ollama_client import query_qwen
    try:
        result = query_qwen("Hello, test message", max_tokens=50)
        if result and "OLLAMA error" not in result:
            print(" Ollama Qwen connected, response:", result[:100] + "...")
            return True
        else:
            print("❌ Ollama connection failed:", result)
            return False
    except Exception as e:
        print("❌ Ollama connection error:", e)
        return False

def test_analysis_endpoint():
    """Test analysis endpoint with sample data"""
    client = TestClient(app)

    sample_data = {
        "product_id": "test_product_123",
        "reviews": [
            {
                "text": "This product is amazing! Highly recommend it to everyone.",
                "rating": 5,
                "reviewer_id": "user1",
                "timestamp": "2024-01-01T10:00:00Z"
            },
            {
                "text": "Great quality and fast shipping. Will buy again.",
                "rating": 4,
                "reviewer_id": "user2",
                "timestamp": "2024-01-02T11:00:00Z"
            }
        ],
        "metadata": {
            "category": "electronics"
        }
    }

    response = client.post('/analyze', json=sample_data)
    print("Analysis response status:", response.status_code)

    if response.status_code == 200:
        result = response.json()
        print("  Analysis successful:")
        print(f"  Trust Score: {result['trust_score']}")
        print(f"  Adjusted Rating: {result['adjusted_rating']}")
        print(f"  Flags: {result['flags']}")
        return True
    else:
        print("❌ Analysis failed:", response.text)
        return False

def test_label_endpoint():
    """Test label endpoint"""
    client = TestClient(app)

    label_data = {
        "product_id": "test_product_123",
        "text": "This product is amazing! Highly recommend it.",
        "label": "trustworthy"
    }

    response = client.post('/label', json=label_data)
    print("Label response status:", response.status_code)

    if response.status_code == 200:
        result = response.json()
        print(" Label stored:", result)
        return True
    else:
        print("❌ Label failed:", response.text)
        return False

def main():
    """Run all tests"""
    print("🚀 Testing TrustGuard API Setup")
    print("=" * 50)

    # Test basic health
    print("\n1. Testing health endpoint...")
    health_ok = test_health()

    # Test MongoDB
    print("\n2. Testing MongoDB connection...")
    mongo_ok = test_mongodb_connection()

    # Test Ollama
    print("\n3. Testing Ollama connection...")
    ollama_ok = test_ollama_connection()

    # Test analysis
    print("\n4. Testing analysis endpoint...")
    analysis_ok = test_analysis_endpoint()

    # Test labeling
    print("\n5. Testing label endpoint...")
    label_ok = test_label_endpoint()

    print("\n" + "=" * 50)
    print("📊 Test Results:")
    print(f"  Health: {'✅' if health_ok else '❌'}")
    print(f"  MongoDB: {'✅' if mongo_ok else '❌'}")
    print(f"  Ollama: {'✅' if ollama_ok else '❌'}")
    print(f"  Analysis: {'✅' if analysis_ok else '❌'}")
    print(f"  Labeling: {'✅' if label_ok else '❌'}")

    if mongo_ok and ollama_ok:
        print("\n All integrations working! Ready for production.")
    else:
        print("\n  Some integrations need setup:")
        if not mongo_ok:
            print("   - Install/start MongoDB: https://docs.mongodb.com/manual/installation/")
        if not ollama_ok:
            print("   - Ensure Ollama is running: docker start <container_id>")

if __name__ == "__main__":
    main()
