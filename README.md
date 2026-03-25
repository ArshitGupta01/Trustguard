# TrustGuard Setup & Production Readiness

This project includes:
- Browser extension (`extension/`) for Amazon/Flipkart/PlayStore/etc.
- Backend API (`backend/`) with heuristic scoring + Qwen second opinion.
- Docker stack (MongoDB + Ollama + backend).

## 1. Run with Docker (recommended production-like)

### 1.1 Prerequisites
- Install Docker Engine
- Install NVIDIA Container Toolkit for GPU support (if using GPU for Ollama)
- Enable Docker Compose v2

### 1.2 Launch all services

From project root:

```bash
docker compose up --build -d
```

Services:
- `trustguard-mongo` (MongoDB, port 27017)
- `trustguard-ollama` (Ollama API server, port 11434)
- `trustguard-backend` (TrustGuard API, port 8000)

### 1.3 Verify service status

Check backend:

```bash
curl http://localhost:8000/healthz
```

Check Ollama container status:

```bash
docker compose ps ollama
```

Check MongoDB logs:

```bash
docker compose logs -f mongodb
```

## 2. Backend environment variables

Set in `docker-compose.yml` by default. If running manually:

- `ENABLE_ML=1`
- `MODEL_TRAIN_THRESHOLD=30`
- `MONGO_URI=mongodb://localhost:27017/trustguard`
- `OLLAMA_URL=http://localhost:11434`
- `OLLAMA_MODEL=qwen2.5:latest`
- `LOG_LEVEL=INFO`

## 3. Backend manual run (non-Docker)

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # windows
source venv/bin/activate   # mac/linux
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

API endpoints:
- `GET /healthz`
- `POST /analyze` (payload: see `backend/app.py` `ReviewInput`)
- `GET /history/{product_id}`


## 4. Extension setup

1. Open Chrome and navigate to `chrome://extensions/`
2. Toggle `Developer mode` on
3. Click `Load unpacked` and choose `extension` folder
4. Open a product page (e.g. Amazon)
5. Click TrustGuard icon and run analysis

### UX behavior change (current)
- Popup now shows:
  - `Analyzing... Qwen summary pending (Ns)` timer until completion
  - `✓ Analysis complete!` after backend response
  - Qwen summary shown below status in popup area
- No auto flux message: `Found X reviews` is removed
- `Qwen external summary available` is removed from red warnings in modal

## 5. Key files

- `backend/app.py` : analysis + Qwen result injection (`qwen_summary` in API response)
- `extension/content.js` : injection, response to popup includes `qwen_summary`
- `extension/popup.js` : timer workflow & summary display
- `extension/popup.html` : extra summary div
- `extension/styles.css` : styling for modal + summary
- `backend/Dockerfile`, `docker-compose.yml` : deployment containers

## 6. Ollama container GPU acceleration

`docker-compose.yml` includes `NVIDIA_VISIBLE_DEVICES=all` and `NVIDIA_DRIVER_CAPABILITIES=compute,utility`.
- On systems without Nvidia GPU, remove these or use Ollama non-GPU image.
- In Docker Compose v2+ with `deploy.resources` you may need swarm mode (or use host-level `--gpus all` in command).

## 7. MongoDB running via Docker

Mongo is managed in compose (persistent data volume `mongo_data`), accessible at `mongodb://mongodb:27017` inside compose network and `mongodb://localhost:27017` from host.

## 8. Troubleshooting

- Ensure `.env` or environment settings match in compose and backend
- Check container logs:
  - `docker compose logs -f backend`
  - `docker compose logs -f ollama`
  - `docker compose logs -f mongodb`
- If Ollama fails due to GPU, check `nvidia-smi` and reinstall NVIDIA Container Toolkit.

## 9. Submission readiness check

- [x] `docker compose up` works
- [x] `GET /healthz` returns `{"status":"ok"}`
- [x] Qwen summary appears underneath analysis status
- [x] No `Found X reviews` text in popup
- [x] No `Qwen external summary available` in warning block
- [x] Backend logs and container status are stable

