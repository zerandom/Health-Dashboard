# iOS Native App Setup (10X Insights)

This app automates health data synchronization, replacing the need for manual XML exports or complex Shortcuts.

## 📋 Requirements
- **macOS** with **Xcode** installed.
- **iPhone** connected to your Mac.
- An **Apple ID** (used for free personal code signing).

## 🚀 Setup Steps

1. **Open the Project**:
   - Open `ios/10XInsights` in Xcode.

2. **Configure Signing**:
   - Select the `10XInsights` project in the left sidebar.
   - Go to **Signing & Capabilities**.
   - Select your Team (or add your Apple ID) and change the **Bundle Identifier** to something unique (e.g., `com.yourname.10XInsights`).

3. **Deploy to iPhone**:
   - Select your iPhone as the build target in the top bar.
   - Click the **Run (Play)** button.
   - *Note: If this is your first time, you may need to go to **Settings > General > VPN & Device Management** on your iPhone to "Trust" your developer certificate.*

4. **Connect HealthKit**:
   - Open the app on your phone.
   - Tap **"Connect Apple Health"** and allow all permissions.
   - Tap **"Force Initial Sync"** to upload your last 90 days of data to the dashboard.

## 🔄 How it Works
- **Background Sync**: The app uses `HKObserverQuery` to detect when you wake up (Sleep Analysis updates) and automatically syncs new data to your local server in the background.
- **Endpoint**: By default, it hits `http://localhost:3000/api/sync`. Ensure your phone and Mac are on the same Wi-Fi network.
