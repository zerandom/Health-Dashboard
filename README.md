# Apple Watch 10X Insights Dashboard

A premium health dashboard for power users to visualize and correlate deep metrics from Apple Watch (HRV, Sleep Stages, Training Load, and more).

## 📊 Core Features
- **Health Correlations:** Compare how behaviors (alcohol, stress, screen time) impact your recovery.
- **Sleep Deep Dive:** Analysis of sleep stages (Deep, REM, Core) and sleep debt tracking.
- **Training Stress Balance (TSB):** Athlete-focused recovery and overtraining analysis.
- **Circadian Rhythm Estimation:** Predictive energy peaks based on historical data.

## 🔄 Data Synchronization

### Option 1: Native iOS App (Recommended)
The easiest way to keep your data up to date. This native app runs in the background and syncs directly to the dashboard.
- [Setup Instructions](ios/ios_setup.md)

### Option 2: Apple Health XML Export
A manual way to import your entire history (years of data).
- Located in the **Data Import** tab of the dashboard.
- Requires exporting `export.xml` from the iPhone Health app.

## 🛠 Project Structure
- `/public`: Frontend dashboard logic (HTML/CSS/JS).
- `/server.py`: Python backend server and HealthKit parser.
- `/ios`: Native Swift application for background syncing.
- `/data`: Storage for parsed and live-sync JSON data.

## 🚀 Getting Started
1. Run the backend: `python3 server.py`.
2. Open `http://localhost:3000` in your browser.
