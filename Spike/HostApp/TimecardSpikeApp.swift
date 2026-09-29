import SwiftUI

@main
struct TimecardSpikeApp: App {
    var body: some Scene {
        WindowGroup("Timecard Spike") {
            HostView()
        }
    }
}

struct HostView: View {
    private var embedded: [String] {
        guard let dir = Bundle.main.builtInPlugInsURL,
              let items = try? FileManager.default.contentsOfDirectory(atPath: dir.path)
        else { return [] }
        return items.sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Timecard storage spike").font(.title2.weight(.semibold))
            Text("Launching this app once registers the probe widgets. Right-click the desktop, choose Edit Widgets…, search for “Probe”, and add each one.")
            Text("Real data folder: \(NSHomeDirectory())/.timetrack")
            Text("Group container: \(NSHomeDirectory())/Library/Group Containers/<TEAMID>.timecard/timetrack")
            Text("Embedded widget extensions: \(embedded.isEmpty ? "none found" : embedded.joined(separator: ", "))")
            Text("App location: \(Bundle.main.bundlePath)")
                .foregroundStyle(.secondary)
        }
        .textSelection(.enabled)
        .padding(24)
        .frame(minWidth: 520, alignment: .leading)
    }
}
