import AppKit
import WebKit
import Foundation

let registeredRedirect = "https://embed.gog.com/on_login_success?origin=client"
let gogHosts: Set<String> = ["auth.gog.com", "login.gog.com", "embed.gog.com", "www.gog.com"]

struct Callback {
    let code: String?
    let state: String?
    let error: String?
}

func readCallback(_ url: URL, expectedState: String) -> Callback? {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
          parts.scheme == "https", ["embed.gog.com", "www.gog.com"].contains(parts.host ?? ""),
          parts.port == nil, parts.user == nil, parts.password == nil,
          parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "on_login_success" else { return nil }
    let items = parts.queryItems ?? []
    let states = items.filter { $0.name == "state" }
    guard states.count <= 1, states.first.map({ $0.value == expectedState }) ?? true else {
        return Callback(code: nil, state: nil, error: "INVALID_LOGIN_STATE")
    }
    if items.contains(where: { $0.name == "error" }) {
        return Callback(code: nil, state: nil, error: "AUTH_CANCELLED")
    }
    let codes = items.filter { $0.name == "code" }
    guard codes.count == 1, let code = codes.first?.value,
          code.range(of: "^[A-Za-z0-9._~+=/-]{1,4096}$", options: .regularExpression) != nil else {
        return Callback(code: nil, state: nil, error: "INVALID_LOGIN_CODE")
    }
    return Callback(code: code, state: states.first?.value, error: nil)
}

func emit(_ event: [String: Any], status: Int32) -> Never {
    // This stdout is a private pipe read by Node. Never log URLs, cookies,
    // credentials or this response to the console or to a file.
    if let data = try? JSONSerialization.data(withJSONObject: event) {
        FileHandle.standardOutput.write(data)
    }
    exit(status)
}

if CommandLine.arguments.dropFirst() == ["--self-test"] {
    let state = "test-state"
    let valid = URL(string: registeredRedirect + "&code=test-code&state=" + state)!
    let checks = [
        readCallback(valid, expectedState: state)?.code == "test-code",
        readCallback(URL(string: registeredRedirect + "&code=test-code")!, expectedState: state)?.code == "test-code",
        readCallback(URL(string: registeredRedirect + "&code=test-code&state=wrong")!, expectedState: state)?.error == "INVALID_LOGIN_STATE",
        readCallback(URL(string: registeredRedirect + "&code=test-code&state=test-state&state=test-state")!, expectedState: state)?.error == "INVALID_LOGIN_STATE",
        readCallback(URL(string: registeredRedirect + "&code=one&code=two")!, expectedState: state)?.error == "INVALID_LOGIN_CODE",
        readCallback(URL(string: "https://attacker.example/on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: "http://embed.gog.com/on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: registeredRedirect + "&error=access_denied")!, expectedState: state)?.error == "AUTH_CANCELLED"
    ]
    emit(["self_test_passed": checks.allSatisfy { $0 }, "checks": checks.count], status: checks.allSatisfy { $0 } ? 0 : 1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 16_000,
      let config = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let loginString = config["login_url"] as? String,
      let loginURL = URL(string: loginString),
      let state = config["state"] as? String, !state.isEmpty,
      let timeout = config["timeout_ms"] as? Double, timeout > 0, timeout <= 600_000,
      let loginParts = URLComponents(url: loginURL, resolvingAgainstBaseURL: false),
      loginParts.scheme == "https", loginParts.host == "auth.gog.com", loginParts.path == "/auth",
      loginParts.queryItems?.first(where: { $0.name == "redirect_uri" })?.value == registeredRedirect,
      loginParts.queryItems?.first(where: { $0.name == "state" })?.value == state else {
    emit(["type": "error", "code": "INVALID_LOGIN_CONFIG"], status: 7)
}

final class LoginController: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let expectedState: String
    var window: NSWindow!
    var webView: WKWebView!

    init(state: String) { expectedState = state }

    func capture(_ url: URL) -> Bool {
        guard let callback = readCallback(url, expectedState: expectedState) else { return false }
        if let error = callback.error { emit(["type": "error", "code": error], status: 3) }
        emit(["type": "code", "code": callback.code!, "state": callback.state as Any? ?? NSNull()], status: 0)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let isMain = navigationAction.targetFrame?.isMainFrame ?? true
        if isMain && readCallback(url, expectedState: expectedState) != nil {
            decisionHandler(.cancel)
            _ = capture(url)
            return
        }
        let allowed = url.scheme == "https" && (!isMain || gogHosts.contains(url.host ?? "")) || url.absoluteString == "about:blank"
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        if let url = webView.url { _ = capture(url) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let url = navigationResponse.response.url,
           readCallback(url, expectedState: expectedState) != nil {
            decisionHandler(.cancel)
            _ = capture(url)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled {
            emit(["type": "error", "code": "LOGIN_PAGE_FAILED"], status: 4)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https", gogHosts.contains(url.host ?? "") {
            webView.load(navigationAction.request)
        }
        return nil
    }

    func windowWillClose(_ notification: Notification) { cancel() }
    @objc func cancel() { emit(["type": "error", "code": "AUTH_CANCELLED"], status: 3) }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let controller = LoginController(state: state)
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 560, height: 720), configuration: configuration)
controller.webView = webView
webView.navigationDelegate = controller
webView.uiDelegate = controller
let window = NSWindow(contentRect: webView.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
controller.window = window
window.title = "Sign in to GOG"
window.delegate = controller
window.contentView = webView
window.isReleasedWhenClosed = false
window.center()

let menu = NSMenu()
let appItem = NSMenuItem()
let appMenu = NSMenu()
let quit = NSMenuItem(title: "Cancel Sign-In", action: #selector(LoginController.cancel), keyEquivalent: "q")
quit.target = controller
appMenu.addItem(quit)
appItem.submenu = appMenu
menu.addItem(appItem)
let editItem = NSMenuItem()
let edit = NSMenu(title: "Edit")
for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
    edit.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
}
editItem.submenu = edit
menu.addItem(editItem)
app.mainMenu = menu

Timer.scheduledTimer(withTimeInterval: timeout / 1000, repeats: false) { _ in
    emit(["type": "error", "code": "AUTH_TIMEOUT"], status: 3)
}
webView.load(URLRequest(url: loginURL))
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
