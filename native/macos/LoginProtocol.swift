import Foundation
import CoreFoundation

let registeredRedirect = "https://embed.gog.com/on_login_success?origin=client"
let gogHosts: Set<String> = ["auth.gog.com", "login.gog.com", "embed.gog.com", "www.gog.com"]

func allowsNavigation(_ url: URL, isMainFrame: Bool) -> Bool {
    if url.absoluteString == "about:blank" { return true }
    // Turnstile uses embedded documents; only GOG may own the main login page.
    if !isMainFrame && url.absoluteString == "about:srcdoc" { return true }
    return url.scheme == "https" && (!isMainFrame || (url.user == nil && url.password == nil && gogHosts.contains(url.host ?? "")))
}

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
          let number = config["timeout_ms"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          case let timeout = number.doubleValue, timeout.isFinite, timeout.rounded() == timeout, timeout > 0, timeout <= 600_000,
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
