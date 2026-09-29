import SwiftUI
import WidgetKit
import AppIntents

struct ProbeAgainIntent: AppIntent {
    static let title: LocalizedStringResource = "Probe again"

    func perform() async throws -> some IntentResult {
        Probe.recordClick(currentProbeRoute)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct ProbeEntry: TimelineEntry {
    let date: Date
    let report: ProbeReport
}

struct ProbeProvider: TimelineProvider {
    func placeholder(in context: Context) -> ProbeEntry {
        ProbeEntry(date: Date(), report: Probe.placeholder(currentProbeRoute))
    }

    func getSnapshot(in context: Context, completion: @escaping (ProbeEntry) -> Void) {
        completion(ProbeEntry(date: Date(), report: Probe.run(currentProbeRoute)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ProbeEntry>) -> Void) {
        let entry = ProbeEntry(date: Date(), report: Probe.run(currentProbeRoute))
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60))))
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }

    static let ground = Color(hex: 0x151B23)
    static let ink = Color(hex: 0xDDE4EB)
    static let muted = Color(hex: 0x7C8B9C)
    static let good = Color(hex: 0x7FBF8A)
    static let bad = Color(hex: 0xE0736B)
}

struct ProbeView: View {
    let entry: ProbeEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(entry.report.route.title)
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Button(intent: ProbeAgainIntent()) {
                    Text("Probe again").font(.system(size: 11))
                }
            }
            Text(entry.report.directory)
                .font(.system(size: 10))
                .foregroundStyle(Color.muted)
                .lineLimit(2)
                .truncationMode(.head)
            ForEach(entry.report.lines) { line in
                HStack(alignment: .top, spacing: 6) {
                    Circle()
                        .fill(line.ok ? Color.good : Color.bad)
                        .frame(width: 7, height: 7)
                        .padding(.top, 4)
                    Text(line.text)
                        .font(.system(size: 11))
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            Text("Probed \(entry.date, style: .time)")
                .font(.system(size: 10).monospacedDigit())
                .foregroundStyle(Color.muted)
        }
        .foregroundStyle(Color.ink)
        .containerBackground(for: .widget) { Color.ground }
    }
}

struct ProbeWidget: Widget {
    var body: some WidgetConfiguration {
        let name: String = "Probe: " + currentProbeRoute.shortName
        let blurb: String = currentProbeRoute.title
        return StaticConfiguration(kind: currentProbeRoute.kind, provider: ProbeProvider()) { entry in
            ProbeView(entry: entry)
        }
        .configurationDisplayName(name)
        .description(blurb)
        .supportedFamilies([.systemLarge])
    }
}
