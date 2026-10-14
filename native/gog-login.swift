import AppKit
import WebKit
import Foundation
import Security

func vault(_ config: [String: Any]) -> [String: Any] {
    guard let action = config["action"] as? String,
          let service = config["service"] as? String, let account = config["account"] as? String,
          !service.isEmpty, !account.isEmpty else { return ["type": "error", "code": "VAULT_UNAVAILABLE"] }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: account,
        kSecUseAuthenticationUI as String: config["interactive"] as? Bool == true ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail]
    var status: OSStatus = errSecParam
    if action == "get" {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        status = SecItemCopyMatching(search as CFDictionary, &result)
        if status == errSecItemNotFound { return ["type": "vault", "secret": NSNull()] }
        if status == errSecSuccess, let data = result as? Data, let secret = String(data: data, encoding: .utf8) {
            return ["type": "vault", "secret": secret]
        }
    } else if action == "set", let secret = config["secret"] as? String,
              let data = secret.data(using: .utf8), !data.isEmpty, data.count <= 96_000 {
        status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            status = SecItemAdd(item as CFDictionary, nil)
        }
    } else if action == "remove" {
        status = SecItemDelete(query as CFDictionary)
        if status == errSecItemNotFound { status = errSecSuccess }
    }
    return status == errSecSuccess ? ["type": "vault"] : ["type": "error", "code": "VAULT_UNAVAILABLE"]
}

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
          ["/on_login_success", "/on_login_success/"].contains(parts.path) else { return nil }
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
          code.range(of: #"\A[A-Za-z0-9._~+=/-]{1,4096}\z"#, options: .regularExpression) != nil else {
        return Callback(code: nil, state: nil, error: "INVALID_LOGIN_CODE")
    }
    return Callback(code: code, state: states.first?.value, error: nil)
}

struct LoginConfig {
    let url: URL
    let state: String
    let timeout: Double
}

func parseConfig(_ config: [String: Any]) -> LoginConfig? {
    guard let loginString = config["login_url"] as? String, let url = URL(string: loginString),
          let state = config["state"] as? String, !state.isEmpty, state.utf8.count <= 1024,
          let timeout = config["timeout_ms"] as? Double, timeout.isFinite, timeout > 0, timeout <= 600_000,
          let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
          parts.scheme == "https", parts.host == "auth.gog.com", parts.path == "/auth",
          parts.port == nil, parts.user == nil, parts.password == nil else { return nil }
    let fields = parts.queryItems ?? []
    let redirects = fields.filter { $0.name == "redirect_uri" }
    let states = fields.filter { $0.name == "state" }
    guard redirects.count == 1, redirects[0].value == registeredRedirect,
          states.count == 1, states[0].value == state else { return nil }
    return LoginConfig(url: url, state: state, timeout: timeout)
}

func readInput(limit: Int, errorCode: String) -> Data {
    var input = Data()
    while true {
        let part = FileHandle.standardInput.readData(ofLength: 4096)
        if part.isEmpty { return input }
        input.append(part)
        if input.count > limit { emit(["type": "error", "code": errorCode], status: 7) }
    }
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
    var parts = URLComponents(string: "https://auth.gog.com/auth")!
    parts.queryItems = [URLQueryItem(name: "redirect_uri", value: registeredRedirect), URLQueryItem(name: "state", value: state)]
    let login = parts.url!.absoluteString
    let base: [String: Any] = ["login_url": login, "state": state, "timeout_ms": 1000.0]
    let validConfigs = [base]
    let invalidConfigs: [[String: Any]] = [
        base.merging(["state": "wrong"]) { _, new in new },
        base.merging(["timeout_ms": 0]) { _, new in new },
        base.merging(["timeout_ms": 600_001]) { _, new in new },
        base.merging(["login_url": login + "&state=test-state"]) { _, new in new },
        base.merging(["login_url": login + "&redirect_uri=other"]) { _, new in new },
        base.merging(["login_url": login.replacingOccurrences(of: "auth.gog.com", with: "attacker.example")]) { _, new in new },
        base.merging(["login_url": login.replacingOccurrences(of: "auth.gog.com", with: "user@auth.gog.com")]) { _, new in new },
        base.merging(["login_url": login.replacingOccurrences(of: "auth.gog.com", with: "auth.gog.com:443")]) { _, new in new }
    ]
    let checks = validConfigs.map { parseConfig($0) != nil } + invalidConfigs.map { parseConfig($0) == nil } + [
        readCallback(valid, expectedState: state)?.code == "test-code",
        readCallback(URL(string: registeredRedirect + "&code=test-code")!, expectedState: state)?.code == "test-code",
        readCallback(URL(string: registeredRedirect + "&code=test-code&state=wrong")!, expectedState: state)?.error == "INVALID_LOGIN_STATE",
        readCallback(URL(string: registeredRedirect + "&code=test-code&state=test-state&state=test-state")!, expectedState: state)?.error == "INVALID_LOGIN_STATE",
        readCallback(URL(string: registeredRedirect + "&code=one&code=two")!, expectedState: state)?.error == "INVALID_LOGIN_CODE",
        readCallback(URL(string: "https://attacker.example/on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: "http://embed.gog.com/on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: registeredRedirect + "&error=access_denied")!, expectedState: state)?.error == "AUTH_CANCELLED",
        readCallback(URL(string: "https://embed.gog.com:443/on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: "https://user@embed.gog.com/on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: registeredRedirect + "&code=line%0Abreak")!, expectedState: state)?.error == "INVALID_LOGIN_CODE",
        readCallback(URL(string: registeredRedirect + "&code=test-code%0A")!, expectedState: state)?.error == "INVALID_LOGIN_CODE",
        readCallback(URL(string: registeredRedirect + "&code=a%2Bb")!, expectedState: state)?.code == "a+b",
        readCallback(URL(string: "https://embed.gog.com//on_login_success?code=test-code")!, expectedState: state) == nil,
        readCallback(URL(string: registeredRedirect)!, expectedState: state)?.error == "INVALID_LOGIN_CODE"
    ]
    emit(["self_test_passed": checks.allSatisfy { $0 }, "checks": checks.count], status: checks.allSatisfy { $0 } ? 0 : 1)
}

if CommandLine.arguments.dropFirst() == ["--vault-self-test"] {
    let service = "gog-achievements-cli.test." + UUID().uuidString
    let secret = String(repeating: "temporary-test", count: 1000)
    let config: [String: Any] = ["service": service, "account": "test"]
    let saved = vault(config.merging(["action": "set", "secret": secret]) { _, new in new })["type"] as? String == "vault"
    let matched = vault(config.merging(["action": "get"]) { _, new in new })["secret"] as? String == secret
    let removed = vault(config.merging(["action": "remove"]) { _, new in new })["type"] as? String == "vault"
    emit(["self_test_passed": saved && matched && removed, "checks": 3], status: saved && matched && removed ? 0 : 1)
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.isEmpty || arguments == ["--vault"] else {
    emit(["type": "error", "code": "INVALID_LOGIN_CONFIG"], status: 7)
}
let isVault = arguments == ["--vault"]
let input = readInput(limit: isVault ? 120_000 : 16_000, errorCode: isVault ? "VAULT_UNAVAILABLE" : "INVALID_LOGIN_CONFIG")
if isVault {
    guard let config = try? JSONSerialization.jsonObject(with: input) as? [String: Any] else {
        emit(["type": "error", "code": "VAULT_UNAVAILABLE"], status: 7)
    }
    let event = vault(config)
    emit(event, status: event["type"] as? String == "vault" ? 0 : 7)
}
guard let data = try? JSONSerialization.jsonObject(with: input) as? [String: Any], let config = parseConfig(data) else {
    emit(["type": "error", "code": "INVALID_LOGIN_CONFIG"], status: 7)
}
let loginURL = config.url
let state = config.state
let timeout = config.timeout

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
