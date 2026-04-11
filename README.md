# Ekatra — Personal Health Intelligence

> Turn your Apple Watch data into a personal health coach. Ekatra surfaces the patterns your wearable collects but never tells you about.

---

## What is Ekatra?

Most health apps show you numbers. Ekatra shows you **what those numbers mean for you, today**.

Built for people who take their health seriously, Ekatra is a self-hosted AI health dashboard that connects directly to Apple HealthKit, parses years of biometric history, and uses Gemini AI to deliver contextual, personalized coaching — not generic tips.

---

## Core Features

### 🧠 AI Health Coach
A Gemini-powered coach card on every tab. Reads your last 14 days of biometric data and generates a fresh, specific insight on demand — not a pre-written quote, but a real analysis of _your_ patterns.

### 😴 Sleep Intelligence
- Deep, REM, and Core sleep stage breakdown across any timeframe (1W → ALL)
- Bedtime and wakeup variance tracking with consistency scoring
- Primary night session heuristic (filters naps from main sleep sessions automatically)
- Historical synthesis: correlates sleep architecture with HRV and recovery trends

### 💪 Dynamic Readiness Coach
HRV-based daily training recommendation. The Workouts tab evaluates your nervous system state and tells you whether to push, recover, or hold steady — with context from your recent training load.

### 📊 Habit Impact Matrix
Log habits (alcohol, cold plunge, sauna, supplements, heavy training, etc.) with a single tap. Ekatra statistically correlates them against your biometrics — showing you the exact HRV dividend or tax each habit has on your body, with next-day lag analysis.

### 🔥 Momentum & Streak Tracking
90-day workout heatmap and habit streak counters that keep you honest about consistency without gamification gimmicks.

### 🕐 Circadian Rhythm Estimate
Predicts your personal energy peaks and valleys based on historical sleep timing and heart rate patterns.

---

## Data Synchronization

### Option 1: Native iOS App *(Recommended)*
A native Swift app that runs on your iPhone and syncs HealthKit data to Ekatra automatically in the background — no manual exports, no Shortcuts needed.
- [Setup Instructions](ios/ios_setup.md)

### Option 2: Apple Health XML Export
Import your full history (years of data) in one shot.
- Go to the **Data Import** tab in the dashboard.
- Export `export.xml` from the iPhone Health app and drop it in.
- The server parses files of any size (1GB+) asynchronously in the background.

---

## Architecture

| Layer | Technology | Role |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Dashboard UI, charts, habit logging |
| Backend | Python (stdlib only) | HTTP server, HealthKit XML parser, AI proxy |
| AI | Google Gemini API | Health coaching, sleep synthesis |
| iOS App | Swift / HealthKit | Background data sync from Apple Watch |
| Data | JSON files (local) | Zero-dependency persistence |

No databases. No cloud. Your health data stays on your machine.

---

## Getting Started

1. **Add your Gemini API key** to `.env` (copy from `.env.example`):
   ```
   GOOGLE_API_KEY=your_key_here
   ```

2. **Start the server:**
   ```bash
   python3 server.py
   ```

3. **Open the dashboard:**
   ```
   http://localhost:3000
   ```

4. **Import data** via the Data Import tab or set up the iOS companion app.

---

## Project Structure

```
/public        → Frontend (HTML, CSS, JS)
/server.py     → Python backend + HealthKit XML parser + Gemini AI proxy
/ios           → Native Swift app for background HealthKit sync
/data          → Local JSON data store (parsed.json, latest.json, tags.json)
```
