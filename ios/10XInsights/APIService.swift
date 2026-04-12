import Foundation

class APIService: ObservableObject {
    // ── Configuration ──────────────────────────────────────────────────────────
    // Update VERCEL_URL after deploying. For local testing, use http://localhost:3000
    static let vercelURL = "https://ekatra.vercel.app"
    let endpoint = URL(string: "\(APIService.vercelURL)/api/sync")!

    // The user's Google email — used as the auth token to scope data server-side.
    // Set this after the user logs in via the web app.
    var userEmail: String = ""

    var onSyncCompletion: ((Bool) -> Void)?

    func postBulksync(payload: [DailyHealthMetrics]) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Auth: send email as Bearer token so the server can identify the user
        request.setValue("Bearer \(userEmail)", forHTTPHeaderField: "Authorization")

        do {
            let data = try JSONEncoder().encode(payload)
            request.httpBody = data

            let task = URLSession.shared.dataTask(with: request) { data, response, error in
                let success = (error == nil && (response as? HTTPURLResponse)?.statusCode == 200)
                self.onSyncCompletion?(success)
            }
            task.resume()
        } catch {
            self.onSyncCompletion?(false)
        }
    }
}
