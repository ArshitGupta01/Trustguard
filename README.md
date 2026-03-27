# TrustGuard — Fake Review Detector for Amazon & Flipkart

A Chrome extension + local backend that scores product reviews for trustworthiness using heuristic analysis and a local LLM (Qwen 2.5). It scrapes reviews directly from the page, runs them through four different analyzers, gets a second opinion from an AI model running on your machine, and shows you a trust badge right on the product page.

No cloud, no subscriptions, no data leaving your computer.

---

## Why this exists

A huge chunk of online reviews are fake - paid placements, bot-generated text, coordinated campaigns. You've probably seen it: a product with 4.5 stars where every review says "best product ever!" with zero specifics.

The problem is that spotting this manually takes forever, and most existing tools either:
- Use basic keyword matching that's easy to game
- Send your browsing data to external servers
- Cost money

TrustGuard takes a different approach. It runs entirely on your machine, uses multiple independent analysis methods that are hard to fool simultaneously, and layers a local LLM on top for a second opinion.

---

## What it actually does

When you visit a product page on Amazon or Flipkart, TrustGuard:

1. **Scrapes all visible reviews** from the page (text, ratings, dates, verified status, helpful votes)
2. **Sends them to a local FastAPI backend** (runs with or without Docker)
3. **Runs four independent analyses:**
   - **Text quality** — vocabulary richness, sentence variation, specificity (does the review mention actual measurements/features/comparisons?), generic phrase density, and suspicious pattern detection (urgency language, link bait, excessive caps/emojis)
   - **Cross-review patterns** — duplicate/near-duplicate detection using Jaccard similarity, rating distribution analysis, reviewer diversity, sentiment-vs-rating consistency checks
   - **Temporal analysis** — detects review bursts (many reviews in a short window), checks if timing patterns look organic
   - **Metadata signals** — verified purchase ratios, helpful vote engagement, review length variety
4. **Combines scores with category-aware weights** — because a book review and an electronics review look very different. A book review weighs text quality at 40%, while electronics weighs temporal patterns higher (25%)
5. **Applies Bayesian smoothing** for products with few reviews (so 3 five-star reviews don't automatically mean "trusted")
6. **(With Docker)** **Gets a second opinion from Qwen 2.5** running locally via Ollama — the LLM reads a sample of reviews and independently flags suspicious patterns
7. **Displays a trust badge** on the product page with the score, adjusted rating, confidence level, warning flags, and (if available) AI summary

The badge uses an SVG ring visualization and expands into a full modal with per-metric breakdowns when clicked.

---
## Demo Images
![WhatsApp Image 2026-03-26 at 1 00 09 PM](https://github.com/user-attachments/assets/9b15953e-d809-42df-9c4a-0611c9f019f9)
![WhatsApp Image 2026-03-26 at 1 00 08 PM](https://github.com/user-attachments/assets/92f89390-3dc3-41e1-bbdb-7a93d1a2d58f)



## Getting started

Clone the repo first — both setup options start from here:

```bash
git clone https://github.com/ArshitGupta01/TrustGuard.git
cd TrustGuard
```

You have two ways to run TrustGuard. Pick the one that fits your setup.

### Option A: Without Docker (lightweight — heuristic + ML only)

If you don't have Docker or don't want to deal with containers, you can run the backend directly with Python. You'll get the full heuristic analysis engine (all four analyzers) and the self-learning ML classifier. The only thing you won't have is the Qwen 2.5 AI second opinion — everything else works.

**What you need:**
- Python 3.10+
- Chrome browser

**Setup:**

```bash
cd backend
pip install -r requirements.txt
```

**Run the backend:**

```bash
# On Windows
python -m uvicorn app:app --host 0.0.0.0 --port 8008

# On macOS/Linux
uvicorn app:app --host 0.0.0.0 --port 8008
```

That's it. The backend starts on port 8008. Without MongoDB, analysis history won't be persisted (it just won't save — no crash). Without Ollama, the `qwen_summary` field will be `null` in the response, and the heuristic score does all the heavy lifting.

**What works without Docker:**

| Feature | Status |
|---|---|
| Text quality analysis (vocabulary, burstiness, specificity, originality) | ✅ Works |
| Cross-review pattern detection (duplicates, rating distribution, diversity) | ✅ Works |
| Temporal burst detection | ✅ Works |
| Metadata analysis (verified purchases, helpful votes) | ✅ Works |
| Category-aware scoring weights | ✅ Works |
| Bayesian smoothing | ✅ Works |
| Self-learning ML classifier (TF-IDF + Logistic Regression) | ✅ Works (in-memory, resets on restart) |
| Chrome extension badge + modal | ✅ Works |
| Qwen 2.5 AI second opinion | ❌ Needs Ollama |
| Analysis history persistence | ❌ Needs MongoDB |

> The heuristic engine in `app.py` is the core of TrustGuard — it doesn't depend on Docker, MongoDB, or Ollama. Those are enhancements, not requirements.

---

### Option B: With Docker (full experience — AI + ML + persistence)

Docker gives you the complete setup: the backend, MongoDB for analysis history, and Ollama running the Qwen 2.5 model for AI-powered review assessment. This is the recommended setup if you want the full experience.

**What you need:**
- **Docker Desktop** — [download](https://www.docker.com/products/docker-desktop/)
- **NVIDIA GPU** (recommended) with [Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) — it'll work on CPU but AI analysis will be slower
- **Chrome browser**
- About **4 GB of disk space** for the model + database

**Setup:**

```bash
cp .env.example .env
```

The `.env` file controls where heavy assets (AI model + database) are stored:

```env
# Default: stores everything in ./data inside the project
STORAGE_PATH=./data

# If your C: drive is tight on space, point it somewhere else:
# STORAGE_PATH=D:\TrustGuardData
```

**Start everything:**

```bash
docker compose up --build -d
```

This brings up three containers:

| Container | Port | What it does |
|---|---|---|
| `trustguard-backend` | 8008 | FastAPI server (4 Gunicorn workers) |
| `trustguard-mongo` | 27017 | MongoDB 7.0 for analysis history |
| `trustguard-ollama` | 11434 | Ollama running Qwen 2.5 |

**Check that it's working:**

```bash
# Backend health
curl http://localhost:8008/healthz
# Should return: {"status": "healthy", "version": "2.0.0"}

# AI model loaded
docker exec trustguard-ollama ollama list
# Should show qwen2.5:latest
```

**What you get with Docker on top of everything in Option A:**

| Feature | Added by Docker |
|---|---|
| Qwen 2.5 AI second opinion | ✅ LLM independently cross-checks the heuristic score |
| Analysis history | ✅ Past results saved in MongoDB, retrievable via `/history` |
| ML label persistence | ✅ User-submitted labels survive restarts |
| Audit logging | ✅ Every AI analysis logged for review |
| Multi-worker performance | ✅ 4 Gunicorn workers instead of single-threaded uvicorn |

---

### Install the extension (same for both options)

1. Go to `chrome://extensions/` in Chrome
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. You should see the TrustGuard icon in your toolbar

Open any Amazon or Flipkart product page and the badge will appear automatically.

---

## How scores work

The trust score is 0–100, calculated as a weighted sum of the four analysis dimensions. Here's what the weights look like by category:

| | Text | Cross-Review | Temporal | Metadata |
|---|---|---|---|---|
| Default | 30% | 30% | 20% | 20% |
| Electronics | 25% | 30% | 25% | 20% |
| Books | 40% | 25% | 15% | 20% |
| Fashion | 30% | 30% | 15% | 25% |
| Software | 35% | 25% | 25% | 15% |

The raw score goes through Bayesian smoothing (pulls toward a neutral 55 when review count is under 10), then gets clamped to 0–100.

The **adjusted rating** blends the raw average rating with the trust score — if trust is high, the adjusted rating stays close to the real average; if trust is low, it gets pulled toward 3.0 (neutral).

**Color coding on the badge:**
- 🟢 70–100: reviews look genuine
- 🟡 40–69: some concerns, read carefully
- 🔴 0–39: significant red flags

---

## Self-learning ML layer

There's an optional machine learning classifier (TF-IDF + Logistic Regression) that sits on top of the heuristic system. Here's how it works:

1. Users can label reviews as `fake`, `spam`, `fraud`, or `trustworthy` via the `/label` endpoint
2. Labels get stored in MongoDB
3. Once you have 30+ labeled reviews (configurable via `MODEL_TRAIN_THRESHOLD`), the ML model auto-activates
4. It trains on the labeled data and starts providing fake-probability scores alongside the heuristic analysis
5. These scores show up as additional flags in the results

This means the system gets better over time as you use it.

---

## Project layout

```
TrustGuard/
├── backend/
│   ├── app.py              # Main server: all 4 analyzers + API endpoints
│   ├── db.py               # Async MongoDB layer (Motor)
│   ├── ml_model.py         # TF-IDF + LogisticRegression classifier
│   ├── ollama_client.py    # Async wrapper for Qwen 2.5 via Ollama
│   ├── Dockerfile          # Python 3.12 slim, Gunicorn + Uvicorn
│   └── requirements.txt    # 11 dependencies
│
├── extension/
│   ├── manifest.json       # Manifest V3 config
│   ├── content.js          # DOM scraper + badge/modal injection
│   ├── additional_detector.js   # Supplementary per-review detection
│   ├── background.js       # Service worker: API proxy, 30-min cache, stats
│   ├── popup.html          # Toolbar popup
│   ├── styles.css          # Dark-mode badge and modal styles
│   ├── additional_detector.css
│   └── icons/              # 16, 48, 128px icons
│
├── docker-compose.yml      # 3-service orchestration (backend, mongo, ollama)
├── .env.example            # Config template
└── README.md
```

---

## API endpoints

All endpoints run on `http://localhost:8008`.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/analyze` | Main analysis — takes reviews, returns trust score + AI summary |
| `GET` | `/history/{product_id}` | Past analyses for a product |
| `POST` | `/label` | Submit a labeled review for ML training |
| `GET` | `/labels` | List all submitted labels |
| `POST` | `/analyze_reviews_batch` | Batch analysis for individual reviews |
| `POST` | `/audit` | Create an audit log entry |
| `GET` | `/audits` | List audit logs |
| `GET` | `/healthz` | Health check |

### Example: Analyze reviews

```bash
curl -X POST http://localhost:8008/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "B0EXAMPLE1",
    "reviews": [
      {"text": "Bought this 3 months ago, battery lasts about 6 hours with heavy use. Screen is decent for the price.", "rating": 4, "verified": true},
      {"text": "BEST PRODUCT EVER!!! Must buy!!! 5 stars!!!", "rating": 5, "verified": false}
    ],
    "metadata": {"category": "electronics"}
  }'
```

Response includes `trust_score`, `adjusted_rating`, per-dimension `breakdown`, `flags`, `confidence`, and `qwen_summary`.

---

## Troubleshooting

**Backend won't start? (without Docker)**
- Make sure you're in the `backend/` directory
- Check Python version: `python --version` (needs 3.10+)
- Check port 8008 isn't in use
- Try: `pip install -r requirements.txt` again

**Backend won't start? (with Docker)**
```bash
docker compose logs backend
```
Check if port 8008 is already in use.

**Model not downloading?**
```bash
docker exec trustguard-ollama ollama pull qwen2.5:latest
```
Make sure you have enough disk space (~2-3 GB).

**Extension not showing the badge?**
- Make sure you're on an actual product page (not search results)
- Open DevTools (F12) → Console, look for `TrustGuard:` log messages
- Check that the backend is healthy: `curl http://localhost:8008/healthz`

**GPU not being used?**
- Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- Test GPU access: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`

**Running out of disk space?**
Change `STORAGE_PATH` in `.env` to a bigger drive, then restart:
```bash
docker compose down
docker compose up -d
```

---

## Architecture overview

```
Chrome Extension                       Docker
┌────────────────────┐                ┌──────────────────────────────┐
│                    │                │                              │
│  content.js        │  scrapes DOM   │  FastAPI (app.py)            │
│  ├─ review scraper ├───────────────►│  ├─ TextAnalyzer             │
│  ├─ badge injector │                │  ├─ CrossReviewAnalyzer      │
│  └─ modal UI       │                │  ├─ TemporalAnalyzer         │
│                    │                │  ├─ MetadataAnalyzer         │
│  background.js     │  POST /analyze │  ├─ TrustScoreCalculator     │
│  ├─ API proxy      ├───────────────►│  └─ ML classifier (optional) │
│  ├─ 30-min cache   │                │         │           │        │
│  └─ stats tracker  │◄───────────────┤         ▼           ▼        │
│                    │  trust score   │    MongoDB 7.0   Ollama      │
│  popup.html        │  + AI summary  │    (history)    (Qwen 2.5)   │
└────────────────────┘                └──────────────────────────────┘
```

All API traffic goes through the service worker (`background.js`) to avoid CORS issues. The content script never makes direct network requests.

---

## Contributing

If you want to contribute:

1. Fork the repo
2. Create a branch (`git checkout -b your-feature`)
3. Make your changes
4. Push and open a PR

Some ideas for contributions:
- Support for more platforms (Meesho, Myntra, etc.)
- Better AI prompts for the Qwen analysis
- Unit tests for the analyzer classes
- Improving the review scraper selectors as sites update their DOM
- Performance optimizations for large review sets

---

## License

MIT
