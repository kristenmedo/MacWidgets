import SwiftUI
import WidgetKit

let currentProbeRoute: ProbeRoute = .noSandbox

@main
struct ProbeNoSandboxBundle: WidgetBundle {
    var body: some Widget {
        ProbeWidget()
    }
}
