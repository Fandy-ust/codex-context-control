import SwiftUI
import AppKit
import WebKit

@MainActor func switchSavedLogin(_ model:Controller,id:String) async throws -> Data? {
    return try await model.api(ControlAPI.accountSwitch,body:["action":"switch","id":id,"confirmed":true,"force":true])
}

private struct SavedLogin:Decodable,Identifiable {let id:String;let email:String;let workspace:String;let name:String;let plan:String?;let quota:QuotaAccount?}
private struct LoginJob:Decodable {let status:String;let error:String?}
private struct AccountSwitchState:Decodable {let profiles:[SavedLogin];let activeId:String?;let busy:Bool;let restartRequired:Bool;let job:LoginJob?;let authUrl:String?;let canCopyLoginLink:Bool?}

struct AccountSwitcherView:View {
    @ObservedObject var model:Controller
    @State private var state:AccountSwitchState?
    @State private var name=""
    @State private var names:[String:String]=[:]
    @State private var busy=false
    @State private var feedback:String?
    @State private var pending:SavedLogin?
    private var disabled:Bool{busy || state?.busy==true}
    var body:some View {
        VStack(alignment:.leading,spacing:14){
            Text(L("账号切换")).font(.headline)
            Text(L("点击切换将自动暂停所有队列、关闭 Codex 和 CLI 会话，切换账号后重新打开 Codex。")).font(.caption).foregroundStyle(.secondary)
            TextField(L("账号简称（可选）"),text:$name)
            HStack{
                Button(L("浏览器授权添加")){Task{await login(embedded:false)}}.buttonStyle(.borderedProminent).disabled(disabled)
                Button(L("应用内授权（实验）")){Task{await login(embedded:true)}}.disabled(disabled)
                Button(L("保存当前登录")){Task{await run(["action":"capture"])}}.disabled(disabled)
                if state?.busy==true{Button(L("取消授权")){Task{await run(["action":"cancel"])}}}
            }
            if state?.canCopyLoginLink==true{HStack{Button(L("复制授权链接")){Task{await copyLoginLink()}};Text(L("可粘贴到其他浏览器中完成授权")).font(.caption).foregroundStyle(.secondary)}}
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
                        Button(L("切换并打开 Codex")){Task{await run(["action":"switch","id":profile.id])}}
                        Button(L("移除保存的登录"),role:.destructive){pending=profile}
                    }.disabled(disabled)
                }.padding(12).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:10))
            }
            if state?.profiles.isEmpty != false{Text(L("尚未保存可切换的登录账号")).font(.caption).foregroundStyle(.secondary)}
        }.textFieldStyle(.roundedBorder)
        .alert(L("移除保存的登录"),isPresented:Binding(get:{pending != nil},set:{if !$0{pending=nil}})){
            Button(L("取消"),role:.cancel){pending=nil}
            Button(L("移除")){if let profile=pending{Task{await run(["action":"remove","id":profile.id])}};pending=nil}
        } message:{Text(L("不会退出当前账号，也不会删除该账号的统计数据。"))}
        .task{while !Task.isCancelled{if !busy{await refresh()};do{try await Task.sleep(nanoseconds:2_000_000_000)}catch{return}}}
    }
    private func jobMessage(_ status:String)->String{switch status{case "starting":return "正在准备官方授权…";case "waiting":return "请在浏览器中完成授权";case "completed":return "账号已安全保存";case "switched":return "账号已切换";default:return "账号授权未完成，请重试"}}
    private func request(_ body:[String:Any]) async throws -> AccountSwitchState{try JSONDecoder().decode(AccountSwitchState.self,from:await model.api(ControlAPI.accountSwitch,body:body))}
    private func refresh() async {do{state=try await request(["action":"status"])}catch{feedback=error.localizedDescription}}
    private func run(_ body:[String:Any]) async {busy=true;defer{busy=false};do{if body["action"] as? String == "switch"{if let data=try await switchSavedLogin(model,id:body["id"] as? String ?? ""){state=try JSONDecoder().decode(AccountSwitchState.self,from:data)}}else{state=try await request(body)};feedback=nil}catch{feedback=error.localizedDescription}}
    private func copyLoginLink() async {
        do{let next=try await request(["action":"login-link"])
            guard let raw=next.authUrl,let url=URL(string:raw),url.scheme=="https",["auth.openai.com","chatgpt.com"].contains(url.host ?? ""),url.user==nil,url.password==nil else{throw URLError(.badURL)}
            NSPasteboard.general.clearContents()
            guard NSPasteboard.general.setString(raw,forType:.string) else{throw URLError(.cannotWriteToFile)}
            feedback="授权链接已复制";state=next
        }catch{feedback=error.localizedDescription}
    }
    private func login(embedded:Bool) async {
        busy=true;defer{busy=false}
        do{let next=try await request(["action":"login","name":name]);state=next
            guard let raw=next.authUrl,let url=URL(string:raw),url.scheme=="https",["auth.openai.com","chatgpt.com"].contains(url.host ?? "") else{throw URLError(.badURL)}
            if embedded{AccountLoginBrowser.show(url)}else if !NSWorkspace.shared.open(url){feedback="无法打开浏览器，请复制授权链接后手动打开";name="";return}
            name="";feedback=nil
        }catch{feedback=error.localizedDescription}
    }
}
