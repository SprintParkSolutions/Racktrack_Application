import UIKit
import WebKit
import Capacitor

/**
 * Another page of the RackTrack site, shown inside the application.
 *
 * Tapping Approvals used to hand the address to SFSafariViewController, which
 * prints the host across the top and Safari's own toolbar across the bottom.
 * It worked, but it read as leaving RackTrack for a website. This presents the
 * same pages in a web view of ours instead: full screen, the application's
 * white, the page's own name and one Close button. No address anywhere.
 *
 * The session travels exactly as before. The one-time hand-over key is what
 * gets opened here, and the cookies it sets land in this app's own persistent
 * store, so every later request inside Approvals carries them.
 *
 * Registered by hand in RackTrackViewController - see the note there on why it
 * has to be registerPluginInstance.
 */
@objc(InAppSite)
public class InAppSite: CAPPlugin, CAPBridgedPlugin {
    // Capacitor 6 finds nothing callable without these three. A plugin that
    // omits them registers, answers no method, and every call rejects - which
    // looks exactly like the plugin being absent.
    public let identifier = "InAppSite"
    public let jsName = "InAppSite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    @objc func open(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              let scheme = url.scheme, scheme == "http" || scheme == "https" else {
            call.reject("A http or https url is required")
            return
        }
        let title = call.getString("title") ?? ""
        // The paths that mean "I am finished here". Approvals sends people back
        // with a link to the site root and signs them out to /login; both must
        // close this view rather than load the website inside it.
        let closeOn = call.getArray("closeOn", String.self) ?? ["/", "/login"]
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("No view controller to present from")
                return
            }
            let vc = InAppSiteController(url: url, siteTitle: title, closeOn: closeOn)
            vc.modalPresentationStyle = .fullScreen
            host.present(vc, animated: true)
            call.resolve()
        }
    }
}

class InAppSiteController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let start: URL
    private let siteTitle: String
    private let closeOn: [String]
    private var webView: WKWebView!
    private var progress: UIProgressView!
    private var observation: NSKeyValueObservation?

    init(url: URL, siteTitle: String, closeOn: [String]) {
        self.start = url
        self.siteTitle = siteTitle
        self.closeOn = closeOn
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    deinit { observation?.invalidate() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white

        let bar = UIView()
        bar.backgroundColor = .white
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let hairline = UIView()
        hairline.backgroundColor = UIColor(white: 0.90, alpha: 1)
        hairline.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(hairline)

        let title = UILabel()
        title.text = siteTitle
        title.font = .systemFont(ofSize: 16, weight: .semibold)
        title.textColor = UIColor(white: 0.09, alpha: 1)
        title.textAlignment = .center
        title.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(title)

        let close = UIButton(type: .system)
        close.setTitle("Close", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 16, weight: .regular)
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(close)

        progress = UIProgressView(progressViewStyle: .bar)
        progress.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(progress)

        let config = WKWebViewConfiguration()
        // The default store is the persistent one, so the cookies the hand-over
        // key sets stay put for the rest of the visit.
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 50),

            close.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 14),
            close.centerYAnchor.constraint(equalTo: bar.centerYAnchor),

            title.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            title.leadingAnchor.constraint(greaterThanOrEqualTo: close.trailingAnchor, constant: 8),

            hairline.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
            hairline.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),

            progress.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
            progress.bottomAnchor.constraint(equalTo: bar.bottomAnchor),

            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        observation = webView.observe(\.estimatedProgress, options: .new) { [weak self] w, _ in
            guard let self = self else { return }
            self.progress.setProgress(Float(w.estimatedProgress), animated: true)
            self.progress.isHidden = w.estimatedProgress >= 1
        }

        webView.load(URLRequest(url: start))
    }

    @objc private func closeTapped() { dismiss(animated: true) }

    /* A link out of Approvals is either the way back to RackTrack, which closes
       this view, or a genuinely different site, which belongs in Safari. */
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        if url.host != start.host {
            if url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
            return
        }
        if navigationAction.navigationType == .linkActivated && closeOn.contains(url.path) {
            decisionHandler(.cancel)
            dismiss(animated: true)
            return
        }
        decisionHandler(.allow)
    }

    /* target="_blank" has nowhere to go in a single web view, so it loads here. */
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if url.host == start.host { webView.load(URLRequest(url: url)) }
            else if url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
        }
        return nil
    }
}
