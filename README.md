# TrustGuard: Hybrid-AI Fake Review Detector 🛡️

TrustGuard is an advanced browser ecosystem designed to identify fake and suspicious reviews on major e-commerce platforms (Amazon, etc.) using a **Hybrid Trust Score Algorithm** and **Large Language Models**.

---

## 🚀 Key Features

*   **Hybrid Trust Score**: Combines heuristic analysis (reviewer metadata, verified status, raring distribution) with machine learning predictions.
*   **Qwen AI Second Opinion**: Leverages the `Qwen 2.5` model via Ollama to provide a human-like cross-check of the heuristic score.
*   **Configurable Storage**: Optimized for efficiency with configurable data relocation to any drive or path to preserve system space.
*   **Real-time Analysis Timer**: Live feedback during deep AI scanning (30-40s).

---

## 🛠️ Step 1: Environment Setup

TrustGuard uses Docker to manage the AI engine and database. By default, it stores data in a `./data` folder within the project, but this can be relocated to any drive (e.g., a secondary D: drive) to save space.

### 1.1 Prerequisites
- **Docker Desktop** installed.
- **NVIDIA GPU** recommended (with NVIDIA Container Toolkit).

### 1.2 Configuration (.env)
Copy the example configuration and adjust the `STORAGE_PATH` if you wish to store heavy assets (Models & DBs) on a different drive.
```bash
cp .env.example .env
```
Edit `.env`:
```bash
# Example for Windows D drive relocation:
STORAGE_PATH=D:\TrustGuardData
```

### 1.3 Launch All Services
From the project root:
```bash
docker compose up --build -d
```

---

## 🔍 Step 2: Service Verification

Verify that the backend and AI engine are communicating correctly:

1.  **Backend Health**: `curl http://localhost:8008/healthz` 
    *   Expected: `{"status": "healthy", "version": "2.0.0"}`
2.  **Ollama Model**: `docker exec trustguard-ollama ollama list`
    *   Confirm `qwen2.5:latest` is present.

---

## 🧩 Step 3: Browser Extension Installation

1.  Open **Chrome** and go to `chrome://extensions/`.
2.  Enable **Developer mode** (top-right).
3.  Click **Load unpacked** and select the **`extension/` folder** from this repository.
4.  Navigate to an **Amazon** or **Flipkart** product page.
5.  Look for the **TrustGuard Badge** injected below the product title. It will show a loading timer while analyzing.

---

## 📋 Technical Architecture

-   **Backend**: FastAPI, Motor (Async MongoDB), Pydantic.
-   **AI Integration**: Ollama (OpenAI-compatible API) running `qwen2.5`.
-   **Database**: MongoDB 7.0.
-   **Security**: All API traffic is routed through the Extension Service Worker to bypass CORS and ensure stability.

---

## 📜 Key File Mapping
-   `backend/app.py`: Core logic for Hybrid Trust Score and AI prompt engineering.
-   `extension/content.js`: Real-time DOM scraping and UI injection logic.
-   `extension/styles.css`: Premium dark-mode styling for badges and analysis boxes.
-   `docker-compose.yml`: Manifest for the containerized architecture.
-   `.env`: Local environment configuration (ignored by git).

---

*Evaluated for: Performance, AI Accuracy, and UI/UX Excellence.*

