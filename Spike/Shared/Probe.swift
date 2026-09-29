import Foundation
import Security
import os

enum ProbeRoute {
    case exception, appGroup, noSandbox

    var shortName: String {
        switch self {
        case .exception: return "Exception"
        case .appGroup: return "App Group"
        case .noSandbox: return "No Sandbox"
        }
    }

    var title: String {
        switch self {
        case .exception: return "Sandbox + ~/.timetrack exception"
        case .appGroup: return "Sandbox + App Group"
        case .noSandbox: return "No sandbox"
        }
    }

    var kind: String { "TimecardProbe.\(shortName.replacingOccurrences(of: " ", with: ""))" }
}

struct ProbeLine: Identifiable {
    let id = UUID()
    var ok: Bool
    var text: String
}

struct ProbeReport {
    var route: ProbeRoute
    var directory: String
    var lines: [ProbeLine]
}

enum Probe {
    static let log = Logger(subsystem: "com.kristenmedo.timecardspike", category: "probe")

    static var isSandboxed: Bool {
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }

    /// The user's real home folder. Inside the sandbox, FileManager's home
    /// points at the container, so ask the password database instead.
    static func realHome() -> URL {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            return URL(fileURLWithPath: String(cString: dir), isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
    }

    /// Reads the group id from this binary's own signature, which also proves
    /// the entitlement survived signing.
    static var appGroupID: String? {
        guard let task = SecTaskCreateFromSelf(nil) else { return nil }
        let value = SecTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil)
        return (value as? [String])?.first
    }

    static func directory(for route: ProbeRoute) -> URL? {
        switch route {
        case .exception, .noSandbox:
            return realHome().appendingPathComponent(".timetrack", isDirectory: true)
        case .appGroup:
            guard let id = appGroupID else { return nil }
            return FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: id)?
                .appendingPathComponent("timetrack", isDirectory: true)
        }
    }

    static func placeholder(_ route: ProbeRoute) -> ProbeReport {
        ProbeReport(route: route, directory: "…", lines: [])
    }

    static func run(_ route: ProbeRoute) -> ProbeReport {
        var lines: [ProbeLine] = []
        let sandboxed = isSandboxed
        lines.append(ProbeLine(ok: route == .noSandbox ? !sandboxed : sandboxed,
                               text: sandboxed ? "Running sandboxed" : "Running unsandboxed"))

        if route == .appGroup {
            if let id = appGroupID {
                lines.append(ProbeLine(ok: true, text: "Group entitlement: \(id)"))
            } else {
                lines.append(ProbeLine(ok: false, text: "No application-groups entitlement in signature"))
            }
        }

        guard let dir = directory(for: route) else {
            lines.append(ProbeLine(ok: false, text: "No folder to test"))
            return finish(ProbeReport(route: route, directory: "–", lines: lines))
        }

        let fm = FileManager.default
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            lines.append(ProbeLine(ok: true, text: "Folder exists"))
        } catch {
            lines.append(ProbeLine(ok: false, text: "Create folder: \(describe(error))"))
        }

        let stamp = timestamp(Date())

        let probeFile = dir.appendingPathComponent(".widget-probe")
        do {
            try Data(stamp.utf8).write(to: probeFile)
            let back = try String(contentsOf: probeFile, encoding: .utf8)
            lines.append(ProbeLine(ok: back == stamp, text: back == stamp ? "Write and read back" : "Read back mismatch"))
        } catch {
            lines.append(ProbeLine(ok: false, text: "Write: \(describe(error))"))
        }

        // Same pattern the real widget will use for running.json (os.replace).
        let tmp = dir.appendingPathComponent(".widget-probe-atomic.tmp")
        let dst = dir.appendingPathComponent(".widget-probe-atomic")
        do {
            try Data(stamp.utf8).write(to: tmp)
            if rename(tmp.path, dst.path) == 0 {
                lines.append(ProbeLine(ok: true, text: "Atomic replace (temp file, then rename)"))
            } else {
                lines.append(ProbeLine(ok: false, text: "rename: \(String(cString: strerror(errno)))"))
            }
        } catch {
            lines.append(ProbeLine(ok: false, text: "Atomic temp write: \(describe(error))"))
        }

        lines.append(readCheck(dir.appendingPathComponent("config.json"), route: route))
        lines.append(readCheck(dir.appendingPathComponent("entries.jsonl"), route: route))

        let clicks = lineCount(dir.appendingPathComponent(".widget-probe-intent.log"))
        lines.append(ProbeLine(ok: clicks > 0,
                               text: clicks > 0 ? "Button writes: \(clicks)" : "Button writes: none yet"))

        return finish(ProbeReport(route: route, directory: dir.path, lines: lines))
    }

    /// Called from the widget's button, through an AppIntent.
    static func recordClick(_ route: ProbeRoute) {
        guard let dir = directory(for: route) else { return }
        let url = dir.appendingPathComponent(".widget-probe-intent.log")
        do {
            try append(timestamp(Date()) + "\n", to: url)
        } catch {
            log.error("\(route.shortName, privacy: .public) click write failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Helpers

    private static func finish(_ report: ProbeReport) -> ProbeReport {
        for line in report.lines {
            log.notice("\(report.route.shortName, privacy: .public) \(line.ok ? "OK  " : "FAIL", privacy: .public) \(line.text, privacy: .public)")
        }
        return report
    }

    private static func readCheck(_ url: URL, route: ProbeRoute) -> ProbeLine {
        let name = url.lastPathComponent
        do {
            let data = try Data(contentsOf: url)
            let count = data.split(separator: UInt8(ascii: "\n")).count
            return ProbeLine(ok: true, text: "Read \(name): \(data.count) bytes, \(count) lines")
        } catch {
            let ns = error as NSError
            if ns.domain == NSCocoaErrorDomain && ns.code == NSFileReadNoSuchFileError {
                // A fresh group container is expected to be empty.
                return ProbeLine(ok: route == .appGroup, text: "\(name) not in this folder")
            }
            return ProbeLine(ok: false, text: "Read \(name): \(describe(error))")
        }
    }

    private static func lineCount(_ url: URL) -> Int {
        guard let data = try? Data(contentsOf: url) else { return 0 }
        return data.split(separator: UInt8(ascii: "\n")).count
    }

    private static func append(_ text: String, to url: URL) throws {
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data(text.utf8))
        } else {
            try Data(text.utf8).write(to: url)
        }
    }

    private static func describe(_ error: Error) -> String {
        let ns = error as NSError
        if let under = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            return "\(ns.domain) \(ns.code) / \(under.domain) \(under.code)"
        }
        return "\(ns.domain) \(ns.code)"
    }

    private static func timestamp(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f.string(from: date)
    }
}
