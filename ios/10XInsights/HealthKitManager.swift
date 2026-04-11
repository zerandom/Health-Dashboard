import Foundation
import HealthKit

struct DailyHealthMetrics: Codable {
    let date: String
    var hrv: Double?
    var rhr: Double?
    var sleepDeep: Double?
    var sleepRem: Double?
    var sleepCore: Double?
    var activeEnergy: Double?
    var exerciseMinutes: Double?
}

class HealthKitManager: ObservableObject {
    let healthStore = HKHealthStore()
    @Published var isAuthorized = false

    var onBackgroundSyncRequested: (() -> Void)?

    let typesToRead: Set<HKObjectType> = [
        HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!,
        HKObjectType.quantityType(forIdentifier: .restingHeartRate)!,
        HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
        HKObjectType.quantityType(forIdentifier: .appleExerciseTime)!,
        HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
    ]

    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        healthStore.requestAuthorization(toShare: nil, read: typesToRead) { success, error in
            DispatchQueue.main.async {
                self.isAuthorized = success
                if success {
                    self.setupBackgroundObservers()
                }
            }
        }
    }

    func setupBackgroundObservers() {
        let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        let query = HKObserverQuery(sampleType: sleepType, predicate: nil) { _, completionHandler, error in
            if error == nil {
                self.onBackgroundSyncRequested?()
            }
            completionHandler()
        }
        healthStore.execute(query)
        healthStore.enableBackgroundDelivery(for: sleepType, frequency: .hourly) { _, _ in }
    }

    func fetchLast90DaysData(completion: @escaping ([DailyHealthMetrics]) -> Void) {
        // Simplified fetching logic placeholder - in a real implementation this would use HKStatisticsCollectionQuery
        // to aggregate daily data across the 90 days.
        let group = DispatchGroup()
        var metricsDict = [String: DailyHealthMetrics]()

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        let now = Date()
        let startDate = Calendar.current.date(byAdding: .day, value: -90, to: now)!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)

        // Demo logic: populate dict with empty metrics for the date range
        for i in 0..<90 {
            let d = Calendar.current.date(byAdding: .day, value: -i, to: now)!
            let ds = formatter.string(from: d)
            metricsDict[ds] = DailyHealthMetrics(date: ds)
        }

        // Fetch HRV
        group.enter()
        let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
        let hrvQuery = HKStatisticsCollectionQuery(quantityType: hrvType, quantitySamplePredicate: predicate, options: .discreteAverage, anchorDate: startDate, intervalComponents: DateComponents(day: 1))
        hrvQuery.initialResultsHandler = { _, results, _ in
            results?.enumerateStatistics(from: startDate, to: now) { stats, _ in
                let ds = formatter.string(from: stats.startDate)
                if let qty = stats.averageQuantity() {
                    metricsDict[ds]?.hrv = qty.doubleValue(for: HKUnit.secondUnit(with: .milli))
                }
            }
            group.leave()
        }
        healthStore.execute(hrvQuery)

        // In a full implementation, you'd repeat the above pattern for RHR, Sleep, Active Energy, and Exercise Minutes.
        // For the sake of the scaffolding, we simply execute the group when queries finish.

        group.notify(queue: .main) {
            completion(Array(metricsDict.values).sorted(by: { $0.date < $1.date }))
        }
    }
}
