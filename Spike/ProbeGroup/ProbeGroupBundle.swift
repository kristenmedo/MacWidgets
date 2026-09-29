import SwiftUI
import WidgetKit

let currentProbeRoute: ProbeRoute = .appGroup

@main
struct ProbeGroupBundle: WidgetBundle {
    var body: some Widget {
        ProbeWidget()
    }
}
