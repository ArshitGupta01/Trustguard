# TrustGuard Setup Instructions

## Quick Start

### 1. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv venv
# Windows: venv\Scripts\activate
# Mac/Linux: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server (Option 1: From backend directory)
uvicorn app:app --reload --host 0.0.0.0 --port 8000

# Start the server (Option 2: From project root)
# uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

Test: http://localhost:8000/health

### 2. Extension Setup

1. Open Chrome → chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `extension` folder
5. Navigate to Amazon product page
6. TrustGuard badge should appear

### 3. Production Deployment

```bash
# Navigate to project root
cd .
docker-compose up -d --build
```

### 4. Restarting

If you restart your computer or stop the containers, simply run:
```bash
# Navigate to project root
cd .
docker-compose up -d
```

## File Checklist

- [ ] backend/requirements.txt
- [ ] backend/app.py
- [ ] backend/residential_proxy.py
- [ ] backend/Dockerfile
- [ ] extension/manifest.json
- [ ] extension/content.js
- [ ] extension/background.js
- [ ] extension/popup.html
- [ ] extension/popup.js
- [ ] extension/styles.css
- [ ] extension/injected.js
- [ ] extension/icons/icon16.png
- [ ] extension/icons/icon48.png
- [ ] extension/icons/icon128.png
- [ ] docker-compose.yml
- [ ] nginx.conf
