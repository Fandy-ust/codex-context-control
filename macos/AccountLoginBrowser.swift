import AppKit
import WebKit

// Keep the top-level sign-in boundary separate from embedded verification frames.
enum AccountLoginNavigation {
    enum Kind {case main,frame,popup}
    static let loginHosts=["auth.openai.com","auth0.openai.com","chatgpt.com","accounts.google.com","login.microsoftonline.com","login.live.com","appleid.apple.com"]
    static let verificationHosts=["sentinel.openai.com","challenges.cloudflare.com","www.google.com","www.gstatic.com","www.recaptcha.net","recaptcha.net","fpt.live.com","iframe.arkoselabs.com","sc.imp.live.com"]
    private static func matches(_ host:String,_ hosts:[String])->Bool {hosts.contains{host==$0 || host.hasSuffix("."+$0)}}
    static func allowed(_ url:URL,authorization:URL,kind:Kind = .main,source:URL? = nil)->Bool {
        if ["about:blank","about:srcdoc"].contains(url.absoluteString){
            let origin=source ?? authorization
            return kind != .main && origin.scheme=="https" && origin.user==nil && origin.password==nil && matches(origin.host ?? "",loginHosts+verificationHosts)
        }
        guard url.user==nil,url.password==nil else{return false}
        if let raw=URLComponents(url:authorization,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="redirect_uri"})?.value,let callback=URL(string:raw),callback.scheme=="http",callback.user==nil,callback.password==nil,["localhost","127.0.0.1"].contains(callback.host ?? ""),url.scheme=="http",url.host==callback.host,url.port==callback.port{return true}
        return url.scheme=="https" && matches(url.host ?? "",kind == .frame ? loginHosts+verificationHosts:loginHosts)
    }
}

@MainActor final class AccountLoginBrowser:NSWindowController,WKNavigationDelegate,WKUIDelegate,NSWindowDelegate {
    private static var active:AccountLoginBrowser?
    private let authorization:URL
    let web:WKWebView
    private let status=NSTextField(wrappingLabelWithString:"")
    private var children:[AccountLoginBrowser]=[]
    private weak var parentBrowser:AccountLoginBrowser?
    init(_ url:URL,configuration:WKWebViewConfiguration? = nil){
        authorization=url
        let config=configuration ?? WKWebViewConfiguration()
        if configuration==nil{config.websiteDataStore = .nonPersistent()}
        config.preferences.javaScriptCanOpenWindowsAutomatically=true
        web=WKWebView(frame:.zero,configuration:config)
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:620,height:800),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
        super.init(window:window);window.title=L("请在浏览器中完成授权");window.minSize=NSSize(width:540,height:600);window.isReleasedWhenClosed=false;window.delegate=self;window.center()
        let back=NSButton(title:L("返回"),target:self,action:#selector(goBack))
        let reload=NSButton(title:L("重新载入"),target:self,action:#selector(reloadPage))
        let copy=NSButton(title:L("复制授权链接"),target:self,action:#selector(copyLink))
        let fallback=NSButton(title:L("使用系统浏览器"),target:self,action:#selector(openSystem))
        let toolbar=NSStackView(views:[back,reload,copy,fallback]);toolbar.spacing=8
        let content=NSView();window.contentView=content
        for view in [toolbar,status,web]{view.translatesAutoresizingMaskIntoConstraints=false;content.addSubview(view)}
        status.font = .systemFont(ofSize:11);status.textColor = .secondaryLabelColor
        status.stringValue=L("如验证或第三方登录不兼容，可复制链接到其他浏览器继续。")
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo:content.topAnchor,constant:10),toolbar.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:12),toolbar.trailingAnchor.constraint(lessThanOrEqualTo:content.trailingAnchor,constant:-12),
            status.topAnchor.constraint(equalTo:toolbar.bottomAnchor,constant:8),status.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:12),status.trailingAnchor.constraint(equalTo:content.trailingAnchor,constant:-12),status.heightAnchor.constraint(equalToConstant:34),
            web.topAnchor.constraint(equalTo:status.bottomAnchor,constant:8),web.leadingAnchor.constraint(equalTo:content.leadingAnchor),web.trailingAnchor.constraint(equalTo:content.trailingAnchor),web.bottomAnchor.constraint(equalTo:content.bottomAnchor)])
        web.navigationDelegate=self;web.uiDelegate=self
    }
    required init?(coder:NSCoder){fatalError("init(coder:) has not been implemented")}
    static func show(_ url:URL){active?.close();let browser=AccountLoginBrowser(url);active=browser;browser.web.load(URLRequest(url:url));browser.present()}
    private func present(){showWindow(nil);window?.makeKeyAndOrderFront(nil);window?.makeFirstResponder(web);NSApplication.shared.activate(ignoringOtherApps:true)}
    @objc private func goBack(){if web.canGoBack{web.goBack()}}
    @objc private func reloadPage(){web.reload()}
    @objc private func copyLink(){NSPasteboard.general.clearContents();if NSPasteboard.general.setString(authorization.absoluteString,forType:.string){status.stringValue=L("授权链接已复制")}}
    @objc private func openSystem(){if NSWorkspace.shared.open(authorization){close()}else{status.stringValue=L("无法打开浏览器，请复制授权链接后手动打开")}}
    private func blocked(_ target:URL?){status.toolTip=target?.host ?? target?.scheme;status.stringValue=L("登录页面跳转或验证被拦截，请复制授权链接到其他浏览器继续。")}
    private func failed(_ error:Error){if (error as NSError).code != NSURLErrorCancelled{status.stringValue=L("登录页面加载失败，请重新载入或复制授权链接到其他浏览器继续。")}}
    func windowWillClose(_ notification:Notification){for child in children{child.close()};children.removeAll();parentBrowser?.children.removeAll{$0 === self}}
    func webViewDidClose(_ webView:WKWebView){close()}
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){failed(error)}
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error){failed(error)}
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView){status.stringValue=L("登录页面加载失败，请重新载入或复制授权链接到其他浏览器继续。")}
    private func sourceURL(_ frame:WKFrameInfo,webView:WKWebView)->URL? {
        // WebKit can supply a nil ObjC request for an initial/blank frame even
        // though the Swift request property is nonoptional. Use its origin.
        let origin=frame.securityOrigin
        guard !origin.protocol.isEmpty,!origin.host.isEmpty else{return webView.url ?? authorization}
        var value=URLComponents();value.scheme=origin.protocol;value.host=origin.host
        if origin.port != 0{value.port=origin.port};return value.url
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping (WKNavigationActionPolicy)->Void){
        let kind:AccountLoginNavigation.Kind=action.targetFrame.map{$0.isMainFrame ? .main:.frame} ?? .popup
        let allowed=action.request.url.map{AccountLoginNavigation.allowed($0,authorization:authorization,kind:kind,source:sourceURL(action.sourceFrame,webView:webView))}==true
        if !allowed{blocked(action.request.url)};decisionHandler(allowed ? .allow:.cancel)
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for action:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? {
        guard action.targetFrame==nil,let url=action.request.url,AccountLoginNavigation.allowed(url,authorization:authorization,kind:.popup,source:sourceURL(action.sourceFrame,webView:webView)),children.count<4 else{blocked(action.request.url);return nil}
        // WebKit must create/load the requested context itself: reloading the
        // URL manually loses window.opener, form POST data and popup callbacks.
        let child=AccountLoginBrowser(authorization,configuration:configuration);child.parentBrowser=self;children.append(child);child.present();return child.web
    }
    func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping ()->Void){
        guard let window else{completionHandler();return};let alert=NSAlert();alert.messageText=message;alert.addButton(withTitle:L("确定"));alert.beginSheetModal(for:window){_ in completionHandler()}
    }
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping (Bool)->Void){
        guard let window else{completionHandler(false);return};let alert=NSAlert();alert.messageText=message;alert.addButton(withTitle:L("确定"));alert.addButton(withTitle:L("取消"));alert.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn)}
    }
    func webView(_ webView:WKWebView,runJavaScriptTextInputPanelWithPrompt prompt:String,defaultText:String?,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping (String?)->Void){
        guard let window else{completionHandler(nil);return};let alert=NSAlert();alert.messageText=prompt;let input=NSTextField(string:defaultText ?? "");input.frame=NSRect(x:0,y:0,width:320,height:24);alert.accessoryView=input;alert.addButton(withTitle:L("确定"));alert.addButton(withTitle:L("取消"));alert.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn ? input.stringValue:nil)}
    }
}
