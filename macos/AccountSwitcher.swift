import SwiftUI
import AppKit
import WebKit

@MainActor func switchSavedLogin(_ model:Controller,id:String) async throws -> Data? {
    struct Preflight:Decodable{let blockers:[String]}
    let check=try JSONDecoder().decode(Preflight.self,from:await model.api(ControlAPI.accountSwitch,body:["action":"preflight"]))
    var force=false
    if !check.blockers.isEmpty{
        let alert=NSAlert();alert.alertStyle = .warning;alert.messageText=L("仍有会话或队列正在运行")
        alert.informativeText=check.blockers.map{L($0)}.joined(separator:"；")+"\n"+L("强制停止将暂停所有队列并关闭 Codex 和 CLI 会话，中断运行中的任务，然后切换账号。")
        alert.addButton(withTitle:L("强制停止并切换"));alert.addButton(withTitle:L("取消"))
        alert.buttons.first?.keyEquivalent="";alert.buttons.last?.keyEquivalent="\r";alert.buttons.last?.keyEquivalentModifierMask=[]
        guard alert.runModal() == .alertFirstButtonReturn else{return nil};force=true
    }
    return try await model.api(ControlAPI.accountSwitch,body:["action":"switch","id":id,"confirmed":true,"force":force])
}

private struct SavedLogin:Decodable,Identifiable {let id:String;let email:String;let workspace:String;let name:String;let plan:String?;let quota:QuotaAccount?}
private struct LoginJob:Decodable {let status:String;let error:String?}
private struct AccountSwitchState:Decodable {let profiles:[SavedLogin];let activeId:String?;let busy:Bool;let restartRequired:Bool;let job:LoginJob?;let authUrl:String?}

struct AccountSwitcherView:View {
    @ObservedObject var model:Controller
    @State private var state:AccountSwitchState?
    @State private var name=""
    @State private var names:[String:String]=[:]
    @State private var busy=false
    @State private var feedback:String?
    @State private var pending:SavedLogin?
    @State private var removing=false
    private var disabled:Bool{busy || state?.busy==true}
    var body:some View {
        VStack(alignment:.leading,spacing:14){
            Text(L("账号切换")).font(.headline)
            Text(L("每个账号首次通过官方网页授权，登录状态仅在本机加密保存。切换前请暂停队列并退出 Codex、CLI 和 IDE 会话；切换后可重新打开 Codex。")).font(.caption).foregroundStyle(.secondary)
            TextField(L("账号简称（可选）"),text:$name)
            HStack{
                Button(L("浏览器授权添加")){Task{await login(embedded:false)}}.buttonStyle(.borderedProminent).disabled(disabled)
                Button(L("应用内授权（实验）")){Task{await login(embedded:true)}}.disabled(disabled)
                Button(L("保存当前登录")){Task{await run(["action":"capture"])}}.disabled(disabled)
                if state?.busy==true{Button(L("取消授权")){Task{await run(["action":"cancel"])}}}
            }
            Text(L("切换将启用 Codex 文件登录模式，并保留现有配置与聊天历史。应用内登录不兼容时，请改用系统浏览器。")).font(.caption).foregroundStyle(.secondary)
            if let feedback{Text(L(feedback)).font(.caption).foregroundStyle(.orange)}
            if let job=state?.job{Text(L(job.error ?? jobMessage(job.status))).font(.caption).foregroundStyle(.secondary)}
            if state?.restartRequired==true{Text(L("账号已切换，请重新打开 Codex")).font(.caption)}
            ForEach(state?.profiles ?? []){profile in
                VStack(alignment:.leading,spacing:8){
                    HStack(alignment:.center,spacing:16){
                        VStack(alignment:.leading,spacing:8){
                            HStack{Text(profile.name.isEmpty ? profile.email:profile.name).fontWeight(.semibold);Spacer();if profile.id==state?.activeId{Text(L("上次选择")).font(.caption).foregroundStyle(.secondary)}}
                            Text(profile.email+" · "+(profile.plan ?? "ChatGPT")).font(.caption).foregroundStyle(.secondary)
                            Text(L("工作区")+": "+profile.workspace).font(.caption2).foregroundStyle(.secondary)
                        }.frame(maxWidth:.infinity,alignment:.leading)
                        Group{if let quota=profile.quota{QuotaSidebarAccountRow(model:model,account:quota,open:{}).saturation(quota.current ? 1:0.3).foregroundStyle(quota.current ? Color.primary:Color.secondary).allowsHitTesting(false)}else{Text(L("额度暂不可用")).font(.caption).foregroundStyle(.secondary)}}.frame(width:300)
                    }
                    HStack{
                        TextField(profile.email,text:Binding(get:{names[profile.id] ?? profile.name},set:{names[profile.id]=String($0.prefix(40))}))
                        Button(L("保存名称")){Task{await run(["action":"rename","id":profile.id,"name":names[profile.id] ?? profile.name])}}
                        Button(L("切换并打开 Codex")){pending=profile;removing=false}
                        Button(L("移除保存的登录"),role:.destructive){pending=profile;removing=true}
                    }.disabled(disabled)
                }.padding(12).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:10))
            }
            if state?.profiles.isEmpty != false{Text(L("尚未保存可切换的登录账号")).font(.caption).foregroundStyle(.secondary)}
        }.textFieldStyle(.roundedBorder)
        .alert(L(removing ? "移除保存的登录":"切换账号"),isPresented:Binding(get:{pending != nil},set:{if !$0{pending=nil}})){
            Button(L("取消"),role:.cancel){pending=nil}
            Button(L(removing ? "移除":"切换")){if let profile=pending{let action=removing ? "remove":"switch";Task{await run(["action":action,"id":profile.id,"confirmed":true])}};pending=nil}
        } message:{Text(L(removing ? "不会退出当前账号，也不会删除该账号的统计数据。":"切换前将检查运行状态；如仍有任务，将提示是否强制停止。"))}
        .task{while !Task.isCancelled{if !busy{await refresh()};do{try await Task.sleep(nanoseconds:2_000_000_000)}catch{return}}}
    }
    private func jobMessage(_ status:String)->String{switch status{case "starting":return "正在准备官方授权…";case "waiting":return "请在浏览器中完成授权";case "completed":return "账号已安全保存";case "switched":return "账号已切换";default:return "账号授权未完成，请重试"}}
    private func request(_ body:[String:Any]) async throws -> AccountSwitchState{try JSONDecoder().decode(AccountSwitchState.self,from:await model.api(ControlAPI.accountSwitch,body:body))}
    private func refresh() async {do{state=try await request(["action":"status"])}catch{feedback=error.localizedDescription}}
    private func run(_ body:[String:Any]) async {busy=true;defer{busy=false};do{if body["action"] as? String == "switch"{if let data=try await switchSavedLogin(model,id:body["id"] as? String ?? ""){state=try JSONDecoder().decode(AccountSwitchState.self,from:data)}}else{state=try await request(body)};feedback=nil}catch{feedback=error.localizedDescription}}
    private func login(embedded:Bool) async {
        busy=true;defer{busy=false}
        do{let next=try await request(["action":"login","name":name]);state=next
            guard let raw=next.authUrl,let url=URL(string:raw),url.scheme=="https",["auth.openai.com","chatgpt.com"].contains(url.host ?? "") else{throw URLError(.badURL)}
            if embedded{AccountLoginBrowser.show(url)}else if !NSWorkspace.shared.open(url){_ = try? await request(["action":"cancel"]);throw URLError(.cannotConnectToHost)}
            name="";feedback=nil
        }catch{feedback=error.localizedDescription}
    }
}

private final class AccountLoginBrowser:NSWindowController,WKNavigationDelegate,WKUIDelegate {
    private static var active:AccountLoginBrowser?
    private let authorization:URL
    private let web:WKWebView
    init(_ url:URL){
        authorization=url
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent();web=WKWebView(frame:.zero,configuration:config)
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:560,height:760),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
        super.init(window:window);window.title=L("请在浏览器中完成授权");window.center()
        let fallback=NSButton(title:L("使用系统浏览器"),target:self,action:#selector(openSystem))
        let stack=NSStackView(views:[fallback,web]);stack.orientation = .vertical;stack.alignment = .leading;stack.spacing=8;window.contentView=stack
        web.translatesAutoresizingMaskIntoConstraints=false;web.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive=true
        web.navigationDelegate=self;web.uiDelegate=self;web.load(URLRequest(url:url))
    }
    required init?(coder:NSCoder){fatalError("init(coder:) has not been implemented")}
    static func show(_ url:URL){active?.close();active=AccountLoginBrowser(url);active?.showWindow(nil);active?.window?.makeKeyAndOrderFront(nil)}
    @objc private func openSystem(){NSWorkspace.shared.open(authorization);close()}
    private func allowed(_ url:URL)->Bool {
        if url.scheme=="https",let host=url.host{return ["auth.openai.com","chatgpt.com","accounts.google.com","login.microsoftonline.com","login.live.com","appleid.apple.com"].contains{host==$0 || host.hasSuffix("."+$0)}}
        guard url.scheme=="http",let raw=URLComponents(url:authorization,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="redirect_uri"})?.value,let callback=URL(string:raw),["localhost","127.0.0.1"].contains(callback.host ?? "") else{return false}
        return url.host==callback.host && url.port==callback.port
    }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping (WKNavigationActionPolicy)->Void){decisionHandler(navigationAction.request.url.map(allowed)==true ? .allow:.cancel)}
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{if let url=navigationAction.request.url,allowed(url){webView.load(navigationAction.request)};return nil}
}
