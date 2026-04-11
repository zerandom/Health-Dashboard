import SwiftUI

struct ContentView: View {
    @StateObject private var hkManager = HealthKitManager()
    @StateObject private var apiService = APIService()
    @State private var syncStatus: String = "Not Synced"

    var body: some View {
        VStack(spacing: 30) {
            Image(systemName: "applewatch")
                .font(.system(size: 60))
                .foregroundColor(.blue)

            Text("10X Insights Sync")
                .font(.largeTitle)
                .fontWeight(.bold)

            if !hkManager.isAuthorized {
                Button(action: {
                    hkManager.requestAuthorization()
                }) {
                    Text("Connect Apple Health")
                        .font(.headline)
                        .foregroundColor(.white)
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 40)
            } else {
                VStack(spacing: 15) {
                    Text("Apple Health Connected")
                        .foregroundColor(.green)
                        .font(.headline)

                    Button(action: {
                        syncData()
                    }) {
                        Text("Force Initial Sync (90 Days)")
                            .font(.headline)
                            .foregroundColor(.white)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.blue)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal, 40)

                    Text("Status: \(syncStatus)")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }
            }

            Spacer()

            Link("Dashboard Account Settings", destination: URL(string: "http://localhost:3000")!)
                .font(.footnote)
                .foregroundColor(.gray)
        }
        .padding(.vertical, 50)
        .onAppear {
            apiService.onSyncCompletion = { success in
                DispatchQueue.main.async {
                    syncStatus = success ? "Last Synced: Just now" : "Sync Failed"
                }
            }
            hkManager.onBackgroundSyncRequested = {
                syncData()
            }
        }
    }

    private func syncData() {
        syncStatus = "Syncing..."
        hkManager.fetchLast90DaysData { healthData in
            guard !healthData.isEmpty else {
                DispatchQueue.main.async { syncStatus = "No data found" }
                return
            }
            // Send payload to backend
            apiService.postBulksync(payload: healthData)
        }
    }
}
