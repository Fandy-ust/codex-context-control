import SwiftUI
import AppKit

struct CloudSyncAccount:Decodable,Identifiable {var id:String;var label:String?;var customName:String?;var current:Bool?;var showQuota:Bool?}
struct CloudSyncDevice:Decodable,Identifiable {var id:String;var name:String?;var lastSync:Double?}
struct CloudSyncState:Decodable {
    var enabled:Bool;var provider:String;var repository:String;var gistId:String
    var intervalMinutes:Int;var startup:Bool;var deviceId:String
    var hasToken:Bool?;var hasKey:Bool?;var running:Bool
    var deviceName:String?;var statisticsMode:String?;var includeUnassigned:Bool?
    var accounts:[CloudSyncAccount]?;var deviceList:[CloudSyncDevice]?
    var excludedAccounts:[String]?;var excludedSyncAccounts:[String]?;var excludedDevices:[String]?
    var error:String?;var lastSuccess:Double?;var devices:Int?
}

struct CloudSyncView:View {
    @ObservedObject var model:Controller
    @State private var state:CloudSyncState?
    @State private var accountNames:[String:String]=[:]
    @State private var deletingAccount:CloudSyncAccount?
    @State private var deviceName=""
    @State private var statisticsMode="current"
    @State private var includeUnassigned=false
    @State private var excludedAccounts:Set<String>=[]
    @State private var excludedSyncAccounts:Set<String>=[]
    @State private var excludedDevices:Set<String>=[]
    @State private var enabled=false
    @State private var provider="repository"
    @State private var repository=""
    @State private var gist=""
    @State private var token=""
    @State private var key=""
    @State private var interval=15
    @State private var custom="15"
    @State private var startup=true
    @State private var claim=false
    @State private var busy=false
    @State private var feedback:String?
    @State private var keyVisible=false
    private let presets=[0,5,15,30,60]

    var body:some View {
        VStack(alignment:.leading,spacing:16){
            Text(L("多设备云同步")).font(.headline)
            Text(L("将数值统计加密后同步到你自己的 GitHub，支持 Windows 与 macOS 多设备合并。聊天正文、标题及密钥不会上传。")).font(.caption).foregroundStyle(.secondary)
            Toggle(L("启用云同步"),isOn:$enabled).toggleStyle(.switch)
            accountDeviceSettings
            Picker(L("同步方式"),selection:$provider){Text(L("GitHub 私有仓库（推荐）")).tag("repository");Text("GitHub Secret Gist").tag("gist")}.pickerStyle(.menu)
            if provider=="repository"{TextField(L("私有仓库 owner/repository"),text:$repository)}
            else{
                TextField("Gist ID",text:$gist)
                Button(L("创建 Secret Gist")){Task{await createGist()}}.disabled(busy)
                Text(L("其他设备填写同一个 Gist ID。Secret Gist 可被知道链接的人读取，因此统计始终加密。")).font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment:.leading,spacing:6){
                HStack{Text("GitHub Token");if state?.hasToken==true{Text(L("已保存")).font(.caption).foregroundStyle(.secondary)}}
                SecureField("GitHub Token",text:$token,prompt:Text(state?.hasToken==true ? "••••••••••••••••":"GitHub Token"))
                Button(L("复制 Token")){Task{await copyCredential("token")}}.disabled(busy)
            }
            VStack(alignment:.leading,spacing:6){
                HStack{Text(L("同步密钥（所有设备使用同一个）"));if state?.hasKey==true{Text(L("已保存")).font(.caption).foregroundStyle(.secondary)}}
                if keyVisible{TextField(L("同步密钥"),text:$key).privacySensitive()}
                else{SecureField(L("同步密钥"),text:$key,prompt:Text(state?.hasKey==true ? "••••••••••••••••":L("无最小长度限制")))}
            }
            HStack{
                Button(L("生成随机密钥")){key=UUID().uuidString.replacingOccurrences(of:"-",with:"")+UUID().uuidString.replacingOccurrences(of:"-",with:"");keyVisible=true}
                Button(L("复制密钥")){Task{await copyCredential("key")}}.disabled(busy)
            }
            Text(L("保存后仍可复制 Token 和密钥；输入框留空会复制已保存的值。")).font(.caption).foregroundStyle(.secondary)
            Picker(L("同步间隔"),selection:$interval){
                Text(L("仅手动")).tag(0);Text(L("每 5 分钟")).tag(5);Text(L("每 15 分钟")).tag(15);Text(L("每 30 分钟")).tag(30);Text(L("每小时")).tag(60);Text(L("自定义")).tag(-1)
            }.pickerStyle(.menu)
            if interval == -1{TextField(L("自定义分钟数（5–1440）"),text:$custom)}
            Toggle(L("启动后同步（仅手动模式除外）"),isOn:$startup)
            Toggle(L("确认本机未归属的历史 Token 都属于当前账号，并纳入同步（一次性）"),isOn:$claim)
            Text(L("不确定历史账号时请勿勾选。新请求自动归属当前账号；Token 和密钥使用 macOS 钥匙串保存。")).font(.caption).foregroundStyle(.secondary)
            HStack{
                Button(L("保存同步设置")){Task{await save()}}.buttonStyle(.borderedProminent).disabled(busy || state?.running==true)
                Button(L(state?.running==true ? "正在同步…":state?.enabled==true ? "保存并同步":"启用并同步")){Task{await save(sync:true)}}.disabled(busy || state==nil || state?.running==true)
                Button(L("刷新状态")){Task{await refresh()}}.disabled(busy)
                Link(L("配置文档"),destination:URL(string:"https://github.com/Fandy-ust/codex-context-control/blob/main/docs/CLOUD_SYNC.md")!)
            }
            if let feedback{Text(L(feedback)).font(.caption).foregroundStyle(.secondary)}
            if let s=state{
                if let error=s.error{Text(L(error)).font(.caption).foregroundStyle(.orange)}
                else if s.running{Text(L("正在同步，关闭设置不影响后台同步。")).font(.caption).foregroundStyle(.secondary)}
                else if let at=s.lastSuccess{Text(L("最近同步")+": "+Date(timeIntervalSince1970:at/1000).formatted(date:.numeric,time:.standard)+" · "+String(s.devices ?? 1)+" "+L("台设备")).font(.caption).foregroundStyle(.secondary)}
                else{Text(L("尚未同步")).font(.caption).foregroundStyle(.secondary)}
                Text("Device ID: "+s.deviceId).font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
            }
            Text(L("各设备保留独立设备 ID，请勿复制整份应用数据目录。关闭同步恢复本机统计，不删除云端历史。")).font(.caption).foregroundStyle(.secondary)
        }.textFieldStyle(.roundedBorder).padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
        .alert(L("删除账号及统计"),isPresented:Binding(get:{deletingAccount != nil},set:{if !$0{deletingAccount=nil}})){
            Button(L("取消"),role:.cancel){deletingAccount=nil}
            Button(L("删除账号及统计"),role:.destructive){if let account=deletingAccount{Task{await run(["action":"delete-account","id":account.id])}};deletingAccount=nil}
        } message:{Text(L("清除该账号的本机缓存及全部本机统计，无法撤销。不会退出 Codex，其他设备和云端原始数据保留；当前账号再次检测后会记录新数据。"))}
        .task{await refresh();while !Task.isCancelled{do{try await Task.sleep(nanoseconds:2_000_000_000)}catch{return};if !busy{await refresh()}}}
    }
    private func included(_ id:String,in values:Binding<Set<String>>) -> Binding<Bool> {
        Binding(get:{!values.wrappedValue.contains(id)},set:{checked in
            if checked{values.wrappedValue.remove(id)}else{values.wrappedValue.insert(id)}
        })
    }
    private var accountDeviceSettings:some View {
        VStack(alignment:.leading,spacing:12){
            Text(L("账号与设备")).font(.headline)
            TextField(L("本机名称"),text:$deviceName)
            Picker(L("统计范围"),selection:$statisticsMode){Text(L("当前账号")).tag("current");Text(L("全部账号")).tag("all");Text(L("所选账号")).tag("selected")}.pickerStyle(.menu)
            Text(L("账号自动识别，套餐或模型变化不会新建账号。勾选仅在本机生效；取消统计不删除历史。")).font(.caption).foregroundStyle(.secondary)
            ForEach(state?.accounts ?? []){account in
                VStack(alignment:.leading,spacing:6){
                    Text((account.customName?.isEmpty==false ? account.customName!:account.label ?? String(account.id.prefix(8)))+(account.current==true ? " · "+L("当前登录"):"" )).font(.subheadline.bold())
                    Text(account.id).font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                    HStack{
                        TextField(account.label ?? L("账号简称"),text:Binding(get:{accountNames[account.id] ?? account.customName ?? ""},set:{accountNames[account.id]=String($0.prefix(40))}))
                        Button(L("保存名称")){Task{await run(["action":"rename-account","id":account.id,"name":accountNames[account.id] ?? account.customName ?? ""]);accountNames.removeValue(forKey:account.id)}}.disabled(busy || state?.running==true)
                        Button(L("删除账号及统计"),role:.destructive){deletingAccount=account}.disabled(busy || state?.running==true)
                    }
                    Toggle(L("在侧栏显示额度"),isOn:Binding(get:{account.showQuota != false},set:{visible in Task{await run(["action":"set-account-visibility","id":account.id,"visible":visible])}})).disabled(busy || state?.running==true)
                    Toggle(L("纳入统计（所选账号模式）"),isOn:included(account.id,in:$excludedAccounts))
                    Toggle(L("参与同步"),isOn:included(account.id,in:$excludedSyncAccounts))
                }.padding(10).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:8))
            }
            if state?.accounts?.isEmpty != false{Text(L("刷新额度以识别当前账号；同步后会发现其他设备上的账号。")).font(.caption).foregroundStyle(.secondary)}
            Text(L("设备：勾选后纳入统计")).font(.caption)
            ForEach(state?.deviceList?.isEmpty==false ? state!.deviceList! : [CloudSyncDevice(id:state?.deviceId ?? "",name:deviceName)]){device in
                VStack(alignment:.leading,spacing:3){
                    Toggle((device.name ?? String(device.id.prefix(8)))+(device.id==state?.deviceId ? " · "+L("本机"):""),isOn:included(device.id,in:$excludedDevices))
                    if let at=device.lastSync{Text(Date(timeIntervalSince1970:at/1000).formatted(date:.numeric,time:.standard)).font(.caption2).foregroundStyle(.secondary)}
                }
            }
            Toggle(L("显示未归属历史（不上传）"),isOn:$includeUnassigned)
        }
    }
    private func request(_ body:[String:Any]) async throws -> CloudSyncState {
        try JSONDecoder().decode(CloudSyncState.self,from:await model.api(ControlAPI.cloudSync,body:body))
    }
    private func refresh() async {
        do{let s=try await request(["action":"status"])
            if state==nil{enabled=s.enabled;provider=s.provider;repository=s.repository;gist=s.gistId;interval=presets.contains(s.intervalMinutes) ? s.intervalMinutes:-1;custom=String(s.intervalMinutes);startup=s.startup;deviceName=s.deviceName ?? "";statisticsMode=s.statisticsMode ?? "current";includeUnassigned=s.includeUnassigned ?? false;excludedAccounts=Set(s.excludedAccounts ?? []);excludedSyncAccounts=Set(s.excludedSyncAccounts ?? []);excludedDevices=Set(s.excludedDevices ?? [])}
            state=s
        }catch{feedback=error.localizedDescription}
    }
    private func run(_ body:[String:Any]) async {
        busy=true;defer{busy=false}
        do{state=try await request(body);feedback=nil}catch{feedback=error.localizedDescription}
    }
    private func save(sync:Bool=false) async {
        guard let minutes=interval == -1 ? Int(custom):interval else{feedback=L("请输入有效分钟数");return}
        await run(["action":sync ? "save-and-sync":"configure","enabled":sync ? true:enabled,"provider":provider,"repository":repository.trimmingCharacters(in:.whitespacesAndNewlines),"gistId":gist.trimmingCharacters(in:.whitespacesAndNewlines),"token":token.trimmingCharacters(in:.whitespacesAndNewlines),"key":key,"intervalMinutes":minutes,"startup":startup,"claimLegacy":claim,"deviceName":deviceName,"statisticsMode":statisticsMode,"includeUnassigned":includeUnassigned,"excludedAccounts":Array(excludedAccounts),"excludedSyncAccounts":Array(excludedSyncAccounts),"excludedDevices":Array(excludedDevices)])
        if feedback==nil{enabled=state?.enabled ?? enabled;token="";key="";keyVisible=false;claim=false;feedback=L(sync ? "已保存并开始同步":"同步设置已保存")}
    }
    private func copyCredential(_ field:String) async {
        busy=true;defer{busy=false}
        do{
            var value=field=="token" ? token:key
            if value.isEmpty{
                let data=try await model.api(ControlAPI.cloudSync,body:["action":"credential","field":field])
                value=try JSONDecoder().decode(CloudSyncCredential.self,from:data).value
            }
            NSPasteboard.general.clearContents();NSPasteboard.general.setString(value,forType:.string)
            feedback=L(field=="token" ? "Token 已复制":"同步密钥已复制")
        }catch{feedback=error.localizedDescription}
    }
    private func createGist() async {
        busy=true;defer{busy=false}
        do{let s=try await request(["action":"create-gist","token":token.trimmingCharacters(in:.whitespacesAndNewlines)]);gist=s.gistId;feedback=L("Gist 已创建，请保存同步设置")}catch{feedback=error.localizedDescription}
    }
}
private struct CloudSyncCredential:Decodable{let value:String}
