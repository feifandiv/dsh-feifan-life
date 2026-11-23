import AppKit
import WebKit

// A plugin-owned OS panel. DSH itself is never patched or granted extra APIs.
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}
final class Panel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
final class BallView: NSView {
    var count = "0"
    var activate: (() -> Void)?
    var fill = NSColor.windowBackgroundColor
    var ink = NSColor.labelColor
    var accent = NSColor.controlAccentColor
    var border = NSColor.separatorColor
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel("展开今日聚焦")
    }
    required init?(coder: NSCoder) { super.init(coder: coder) }
    override var acceptsFirstResponder: Bool { true }
    override func accessibilityPerformPress() -> Bool { activate?(); return true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.keyCode == 49 { activate?() }
        else { super.keyDown(with: event) }
    }
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 13, yRadius: 13)
        fill.setFill(); path.fill(); border.setStroke(); path.lineWidth = 1; path.stroke()
        let image = NSImage(systemSymbolName: "scope", accessibilityDescription: "今日聚焦")
        let symbol = NSRect(x: (bounds.width-16)/2, y: 6, width: 16, height: 16)
        image?.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [accent]))?.draw(in: symbol)
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium), .foregroundColor: ink]
        let size = (count as NSString).size(withAttributes: attrs)
        (count as NSString).draw(at: NSPoint(x: (bounds.width-size.width)/2, y: 25), withAttributes: attrs)
    }
    override func mouseDown(with event: NSEvent) {
        guard let window = window else { return }
        let start = NSEvent.mouseLocation, origin = window.frame.origin
        var moved = false
        while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            let point = NSEvent.mouseLocation
            let dx = point.x-start.x, dy = point.y-start.y
            if hypot(dx, dy) > 6 { moved = true }
            if moved { window.setFrameOrigin(NSPoint(x: origin.x+dx, y: origin.y+dy)) }
            if next.type == .leftMouseUp { if !moved { activate?() }; break }
        }
    }
}
final class FocusController: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var panel: Panel!
    var web: WKWebView!
    var pending: [String: Any]?
    var loaded = false
    var compact = false
    var ball: BallView?
    var expandedHeight: CGFloat = 196
    var dragMonitor: Any?
    var input = Data()
    func applicationDidFinishLaunching(_ notification: Notification) {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        panel = Panel(contentRect: NSRect(x: screen.maxX - 296, y: screen.maxY - 216, width: 280, height: 196), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "今日聚焦 · 非凡人生"
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.minSize = NSSize(width: 44, height: 44)
        panel.setFrameAutosaveName("FeifanLifeFocusReminder")
        panel.delegate = self
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "focus")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        panel.contentView = web
        web.wantsLayer = true
        web.layer?.cornerRadius = 12
        web.layer?.masksToBounds = true
        // Drag from the actual mouse-down event, before WebKit's async bridge.
        // Leave the three header controls to WebKit and all task rows clickable.
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            guard let self = self, event.window === self.panel, !self.compact else { return event }
            let point = event.locationInWindow, size = self.panel.contentView!.bounds.size
            if point.y >= size.height-40 && point.x < size.width-90 {
                self.panel.performDrag(with: event)
                return nil
            }
            return event
        }
        guard CommandLine.arguments.count > 1 else { NSApp.terminate(nil); return }
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        panel.orderFrontRegardless()
        emit(["type": "ready"])
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                guard let self = self else { return }
                if data.isEmpty { NSApp.terminate(nil); return }
                self.input.append(data)
                while let end = self.input.firstIndex(of: 10) {
                    let line = self.input.prefix(upTo: end)
                    self.input.removeSubrange(...end)
                    if let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any] { self.receive(value) }
                }
            }
        }
    }
    func receive(_ value: [String: Any]) {
        switch value["type"] as? String {
        case "snapshot": pending = value["snapshot"] as? [String: Any]; update()
        case "show": if compact { setCompact(false) }; panel.orderFrontRegardless()
        case "close": NSApp.terminate(nil)
        default: break
        }
    }
    func update() {
        guard loaded, let pending = pending else { return }
        panel.appearance = NSAppearance(named: pending["mode"] as? String == "dark" ? .darkAqua : .aqua)
        if let colors = pending["palette"] as? [String: String], let ball = ball {
            ball.fill = cssColor(colors["bg"]) ?? .windowBackgroundColor
            ball.ink = cssColor(colors["text"]) ?? .labelColor
            ball.accent = cssColor(colors["accent"]) ?? .controlAccentColor
            ball.border = cssColor(colors["border"]) ?? .separatorColor
        }
        if let groups = pending["groups"] as? [[String: Any]] {
            let count = groups.reduce(0) { total, group in total + ((group["parentPinned"] as? Bool == true) ? 1 : 0) + ((group["children"] as? [Any])?.count ?? 0) }
            ball?.count = String(count); ball?.needsDisplay = true
        }
        web.callAsyncJavaScript("window.applySnapshot(snapshot)", arguments: ["snapshot": pending], in: nil, in: .page, completionHandler: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded = true; update() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        emit(["type": "error", "message": "系统悬浮窗渲染进程已退出，请重新打开。"])
        NSApp.terminate(nil)
    }
    func cssColor(_ value: String?) -> NSColor? {
        guard let value = value, value.hasPrefix("rgb") else { return nil }
        let numbers = value.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).compactMap(Double.init)
        guard numbers.count >= 3 else { return nil }
        return NSColor(srgbRed: numbers[0]/255, green: numbers[1]/255, blue: numbers[2]/255, alpha: numbers.count > 3 ? numbers[3] : 1)
    }
    func expandedFrame(from old: NSRect) -> NSRect {
        let screen = panel.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
        let width = min(280, screen.width-16), height = min(expandedHeight, screen.height-16)
        return NSRect(x: max(screen.minX+8, min(old.maxX-width, screen.maxX-width-8)),
                      y: max(screen.minY+8, min(old.maxY-height, screen.maxY-height-8)), width: width, height: height)
    }
    func fitContent(_ height: Double) {
        guard height.isFinite else { return }
        expandedHeight = CGFloat(max(80, min(height, 360)))
        if !compact { panel.setFrame(expandedFrame(from: panel.frame), display: true) }
    }
    func setCompact(_ value: Bool) {
        guard compact != value else { return }
        let old = panel.frame
        if value {
            let view = BallView(frame: NSRect(x: 0, y: 0, width: 44, height: 44))
            view.activate = { [weak self] in self?.setCompact(false) }
            ball = view
            panel.contentView = view
            panel.setFrame(NSRect(x: old.maxX - 44, y: old.maxY - 44, width: 44, height: 44), display: true)
            panel.makeFirstResponder(view)
        } else {
            panel.contentView = web
            ball = nil
            panel.setFrame(expandedFrame(from: old), display: true)
        }
        compact = value
        update()
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let value = message.body as? [String: Any], let type = value["type"] as? String else { return }
        switch type {
        case "compact": setCompact(value["value"] as? Bool ?? false)
        case "size": if let height = value["height"] as? Double { fitContent(height) }
        case "close": NSApp.terminate(nil)
        case "return", "task": emit(value)
        default: break
        }
    }
    func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        if let monitor = dragMonitor { NSEvent.removeMonitor(monitor) }
        FileHandle.standardInput.readabilityHandler = nil
        emit(["type": "closed"])
    }
}
let app = NSApplication.shared
let controller = FocusController()
app.setActivationPolicy(.accessory)
app.delegate = controller
app.run()
