import SwiftUI
import WidgetKit

let currentProbeRoute: ProbeRoute = .exception

@main
struct ProbeExceptionBundle: WidgetBundle {
    var body: some Widget {
        ProbeWidget()
    }
}
