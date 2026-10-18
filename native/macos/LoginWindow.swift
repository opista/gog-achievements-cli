import AppKit
import WebKit
import Foundation

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
        decisionHandler(allowsNavigation(url, isMainFrame: isMain) ? .allow : .cancel)
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
        if let url = navigationAction.request.url, allowsNavigation(url, isMainFrame: true) {
            webView.load(navigationAction.request)
        }
        return nil
    }

    func windowWillClose(_ notification: Notification) { cancel() }
    @objc func cancel() { emit(["type": "error", "code": "AUTH_CANCELLED"], status: 3) }
}

func runLoginWindow(_ config: LoginConfig) {
    let state = config.state
    let timeout = config.timeout
    let loginURL = config.url
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
    // WebKit and AppKit hold delegates weakly. Keep the controller for the run loop.
    withExtendedLifetime(controller) { app.run() }
}
