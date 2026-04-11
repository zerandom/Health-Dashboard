import Foundation

class APIService: ObservableObject {
    let endpoint = URL(string: "http://localhost:3000/api/sync")!
    
    var onSyncCompletion: ((Bool) -> Void)?

    func postBulksync(payload: [DailyHealthMetrics]) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

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
