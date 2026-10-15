import SwiftUI
import AppKit

struct Budget: Decodable { let window:Int;let compact:Int;let reserve:Int;let retainedFloor:Int;let revision:Int;let enabled:Bool? }
struct Usage: Decodable { let totalTokens:Int }
struct Metadata: Decodable { let max_context_window:Int?;let effective_context_window_percent:Int? }
struct Chat: Identifiable, Decodable {
    let id:String;let name:String?;let model:String?;let cwd:String?;let status:String?
    let connected:Bool;let ambiguous:Bool;let phase:String?;let message:String?
    let observedWindow:Int?;let expectedWindow:Int?;let lastUsage:Usage?;let freshUsage:Bool?;let revision:Int?
    let policy:Budget?;let modelMetadata:Metadata?
    var title:String { if let name,!name.isEmpty{return name};if let cwd{return URL(fileURLWithPath:cwd).lastPathComponent};return String(id.prefix(12)) }
    var targetWindow:Int? {
        guard let policy,policy.enabled != false,let percent=modelMetadata?.effective_context_window_percent,(1...100).contains(percent) else{return nil}
        return policy.window*percent/100
    }
    var windowConfirmed:Bool {connected && freshUsage==true && phase=="confirmed" && revision==policy?.revision && observedWindow != nil && observedWindow==expectedWindow && observedWindow==targetWindow}
    var observedWindowTitle:String {
        if windowConfirmed{return "已确认可用窗口"}
        if !connected || freshUsage != true{return "上次读回窗口（待更新）"}
        return phase=="mismatch" ? "运行时读回窗口（与目标不符）":"最近读回窗口"
    }
}
struct RuntimeState: Decodable {let version:String;let bridgeCount:Int;let threads:[Chat]}
struct Connection: Decodable {let port:Int;let token:String}
struct DesktopSettings: Decodable {let desktopExecutable:String}

@MainActor final class Controller: ObservableObject {
    @Published var chats:[Chat]=[]
    @Published var selectedID:String?
    @Published var bridgeCount=0
    @Published var notice="正在读取本地状态…"
    @Published var window="400K"
    @Published var compactPercent=90.0
    @Published var reserve="16K"
    @Published var floor="0"
    @Published var working=false
    private var editingRevision=0
    private var refreshing=false
    private var pendingMetadataID:String?
    var selected:Chat? {chats.first{$0.id==selectedID}}
    var waitingForModel:Bool {pendingMetadataID != nil && pendingMetadataID==selectedID}
    var home:URL {
        if let custom=ProcessInfo.processInfo.environment["CONTEXT_CONTROL_HOME"] {return URL(fileURLWithPath:custom)}
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CodexContextControl")
    }
    func api(_ route:String,body:[String:Any]?=nil) async throws -> Data {
        let connection=try JSONDecoder().decode(Connection.self,from:Data(contentsOf:home.appendingPathComponent("connection.json")))
        var request=URLRequest(url:URL(string:"http://127.0.0.1:\(connection.port)\(route)")!)
        request.setValue("Bearer \(connection.token)",forHTTPHeaderField:"Authorization")
        request.timeoutInterval=30
        if let body {request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:body)}
        let (data,response)=try await URLSession.shared.data(for:request)
        guard (response as? HTTPURLResponse)?.statusCode==200 else {
            let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
            throw NSError(domain:"ContextControl",code:1,userInfo:[NSLocalizedDescriptionKey:object?["error"] as? String ?? "本地服务暂时不可用"])
        }
        return data
    }
    func refresh() async {
        if refreshing{return};refreshing=true;defer{refreshing=false}
        do {let state=try JSONDecoder().decode(RuntimeState.self,from:await api("/state"));chats=state.threads;bridgeCount=state.bridgeCount
            if selectedID==nil{selectedID=chats.first?.id;fill()}
            else if waitingForModel,let metadata=selected?.modelMetadata,metadata.effective_context_window_percent != nil,metadata.max_context_window != nil{fill()}
            if notice=="正在读取本地状态…"||notice.hasPrefix("读取失败："){notice=bridgeCount>0 ? "已接入 Codex。" : "照常打开 Codex 并进入聊天，预算控制会自动接入。首次安装后请正常重开一次客户端。"}
        }catch{notice="读取失败：\(error.localizedDescription)"}
    }
    func fill(){
        guard let chat=selected else{return};editingRevision=chat.policy?.revision ?? 0;pendingMetadataID=nil
        reserve=String(chat.policy?.reserve ?? 16000);floor=String(chat.policy?.retainedFloor ?? 0)
        if let policy=chat.policy,let percent=chat.modelMetadata?.effective_context_window_percent,(1...100).contains(percent),chat.modelMetadata?.max_context_window != nil{
            let usable=policy.window*percent/100
            window=String(usable)
            let actualCompact=min(policy.compact,policy.window*90/100)
            compactPercent=min((Double(actualCompact)/Double(max(1,usable))*10000).rounded()/100,maximumRatio)
        }else if chat.policy != nil{window="";compactPercent=90;pendingMetadataID=chat.id}
        else{window="400K";compactPercent=90}
    }
    func calculate(_ ratio:Double?=nil) throws -> BudgetPreview {
        guard let metadata=selected?.modelMetadata,let percent=metadata.effective_context_window_percent,let maximum=metadata.max_context_window else{throw BudgetInputError(message:"等待当前模型信息后即可设置实际可用窗口")}
        return try BudgetMath.preview(usableWindow:BudgetMath.tokens(window),compactPercent:ratio ?? compactPercent,effectivePercent:percent,maximumRawWindow:maximum)
    }
    var preview:BudgetPreview? {try? calculate()}
    var previewError:String? {do{_ = try calculate();return nil}catch{return error.localizedDescription}}
    var maximumRatio:Double {(try? calculate(1).maxCompactPercent) ?? 90}
    var maximumUsableWindow:Int? {guard let m=selected?.modelMetadata,let p=m.effective_context_window_percent,let w=m.max_context_window else{return nil};return w*p/100}
    var policy:[String:Any] {get throws {let budget=try calculate();return ["window":budget.rawWindow,"compact":budget.compact,"reserve":reserve,"retainedFloor":floor,"scope":"total"]}}
    func act(_ action:String) async {
        guard let chat=selected else{return};working=true;defer{working=false}
        do {
            var body:[String:Any]=["id":chat.id]
            if action=="preflight"||action=="policy"{body["policy"]=try policy}
            if action=="policy"{body["apply"]=true;body["expectedRevision"]=editingRevision}
            let data=try await api("/\(action)",body:body)
            let object=try JSONSerialization.jsonObject(with:data) as? [String:Any]
            if action=="preflight"{notice=(object?["message"] as? String ?? "预检完成")+((object?["notes"] as? [String])?.map{"\n"+$0}.joined() ?? "")}
            else if action=="policy"{editingRevision=(object?["policy"] as? [String:Any])?["revision"] as? Int ?? editingRevision;notice="预算已保存。请查看下方应用状态；实际值将在正常下一轮请求后确认。"}
            else{notice=object?["message"] as? String ?? "操作已提交。"}
            await refresh()
        }catch{notice=error.localizedDescription}
    }
    func launchCodex(){
        do {
            let settings=try JSONDecoder().decode(DesktopSettings.self,from:Data(contentsOf:home.appendingPathComponent("settings.json")))
            let app=URL(fileURLWithPath:settings.desktopExecutable).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/open");process.arguments=["-a",app.path]
            try process.run();notice="已请求打开 Codex；预算控制会随运行时自动接入。"
        }catch{notice=error.localizedDescription}
    }
}

func formatted(_ n:Int?) -> String {guard let n else{return "待观测"};return n.formatted()+" tokens"}
func phaseName(_ value:String?) -> String {
    switch value {case "confirmed":return "窗口已确认";case "awaiting_runtime_confirmation":return "等待下一轮确认";case "reloading":return "正在应用";case "waiting_for_idle","queued":return "等待轮次结束";case "needs_compaction":return "需要先压缩";case "needs_observation":return "等待用量记录";case "error","mismatch":return "需要处理";case "saved":return "已保存";default:return "尚未接入"}
}

struct ContentView: View {
    @ObservedObject var model:Controller
    @State private var confirmCompact=false
    var body: some View {
        NavigationSplitView {
            VStack(alignment:.leading,spacing:14){
                Text("聊天预算").font(.title2.bold())
                Label("已接入 \(model.bridgeCount) 个运行时",systemImage:model.bridgeCount>0 ? "checkmark.circle.fill":"circle.dashed").font(.caption).foregroundStyle(model.bridgeCount>0 ? .green:.secondary)
                List(model.chats,selection:$model.selectedID){chat in
                    VStack(alignment:.leading,spacing:5){Text(chat.title).lineLimit(1);Text((chat.connected ? phaseName(chat.phase):"尚未接入")+" · "+String(chat.id.prefix(8))).font(.caption).foregroundStyle(.secondary)}.padding(.vertical,4).tag(chat.id)
                }.listStyle(.sidebar)
                Button("打开 Codex",systemImage:"arrow.up.forward.app"){model.launchCodex()}.buttonStyle(.bordered)
            }.padding().frame(minWidth:235)
        } detail: {
            ScrollView {
                VStack(alignment:.leading,spacing:22){
                    if let chat=model.selected {
                        VStack(alignment:.leading,spacing:6){Text(chat.title).font(.title2.bold()).lineLimit(2).truncationMode(.tail);Text(chat.model ?? "模型将在接入后识别").foregroundStyle(.secondary)}
                        VStack(alignment:.leading,spacing:12){
                            HStack(spacing:28){metric(chat.observedWindowTitle,formatted(chat.observedWindow));metric("最近请求用量",formatted(chat.lastUsage?.totalTokens))}
                            if let target=chat.targetWindow,let policy=chat.policy {
                                Text("已保存：可用窗口 \(formatted(target)) · 压缩阈值 \(formatted(min(policy.compact,policy.window*90/100)))\(chat.windowConfirmed ? "（窗口已确认）":"（窗口待确认）")").font(.callout).textSelection(.enabled)
                            }
                            if chat.phase=="awaiting_runtime_confirmation" {
                                Label("新预算已提交。上方仍是调整前的读回值，下一个正常请求完成后更新。",systemImage:"clock").font(.callout).foregroundStyle(.orange)
                            }
                        }
                        Text("窗口表示容量上限。最近请求用量是当前占用的近似值，不是聊天累计用量。压缩后的最低保留量不能预先保证。").font(.caption).foregroundStyle(.secondary)
                        Divider()
                        HStack {Text("本聊天的独立预算").font(.headline);Button("重新载入",systemImage:"arrow.clockwise"){model.fill()}.labelStyle(.iconOnly).help("重新读取此聊天已保存的设置");Spacer();ForEach([200,400,800],id:\.self){k in Button("\(k)K"){model.window="\(k)K"}.disabled(k*1000>(model.maximumUsableWindow ?? Int.max))};if let maximum=model.maximumUsableWindow{Button("最大"){model.window=String(maximum)}}}
                        budgetEditor().disabled(model.waitingForModel)
                        HStack {
                            Button("预检"){Task{await model.act("preflight")}}.disabled(model.preview==nil)
                            Button(chat.connected ? "应用到此聊天":"保存，接入后应用"){Task{await model.act("policy")}}.buttonStyle(.borderedProminent).disabled(model.preview==nil)
                            Button("原生压缩…"){confirmCompact=true}.disabled(!chat.connected)
                            Spacer()
                            Button("停止自动应用"){Task{await model.act("clear")}}.foregroundStyle(.secondary)
                        }.disabled(model.working)
                        GroupBox {
                            VStack(alignment:.leading,spacing:8){Label(phaseName(chat.phase),systemImage:chat.phase=="confirmed" ? "checkmark.circle":"clock").font(.headline);Text(chat.message ?? "接入后，设置会在轮次之间应用。").foregroundStyle(.secondary);if let target=chat.targetWindow{Text("目标可用窗口：\(formatted(target))").font(.caption)}}.frame(maxWidth:.infinity,alignment:.leading).padding(4)
                        }
                    }else{
                        ContentUnavailableView("等待聊天接入",systemImage:"bubble.left.and.bubble.right",description:Text("照常打开 Codex 并进入聊天，控制连接会随运行时自动启动。首次安装后请正常重开一次客户端。"))
                    }
                    Divider();Text(model.notice).font(.callout).textSelection(.enabled).foregroundStyle(.secondary)
                }.padding(30).frame(maxWidth:850,alignment:.leading)
            }.frame(minWidth:650)
        }
        .frame(minWidth:960,minHeight:670)
        .onChange(of:model.selectedID){_,_ in model.fill()}
        .confirmationDialog("请求 Codex 原生压缩？",isPresented:$confirmCompact,titleVisibility:.visible){Button("请求压缩"){Task{await model.act("compact")}};Button("取消",role:.cancel){}}message:{Text("压缩可能使用现有模型额度。压缩结果长度无法保证，完成后需要重新测量。")}
    }
    func budgetEditor()->some View {
        VStack(alignment:.leading,spacing:16){
            Grid(alignment:.leading,horizontalSpacing:20,verticalSpacing:14){
                field("实际可用窗口",text:$model.window,hint:"你输入的数值就是目标可用窗口，例如 700K")
            }
            HStack {Text("自动压缩比例");Spacer();ForEach([80.0,85.0,90.0],id:\.self){value in Button("\(Int(value))%"){model.compactPercent=value}};Button("最大 \(percentage(model.maximumRatio))%"){model.compactPercent=model.maximumRatio}}
            HStack(spacing:12){
                Slider(value:$model.compactPercent,in:0.01...100,step:0.01).accessibilityLabel("自动压缩比例")
                TextField("压缩比例",value:$model.compactPercent,format:.number.precision(.fractionLength(0...2))).textFieldStyle(.roundedBorder).frame(width:75)
                Text("%")
            }
            if let budget=model.preview {
                Text("自动压缩阈值：\(formatted(budget.compact))").font(.headline).monospacedDigit()
                Text("达到实际可用窗口的 \(percentage(budget.compactPercent))% 时触发压缩；调整窗口后阈值会同比例变化。").font(.caption).foregroundStyle(.secondary)
            }
            if let error=model.previewError{Label(error,systemImage:"exclamationmark.circle").foregroundStyle(.orange)}
            if let maximum=model.maximumUsableWindow{Text("当前模型最多可用：\(formatted(maximum))").font(.caption).foregroundStyle(.secondary)}
            DisclosureGroup("高级设置"){
                VStack(alignment:.leading,spacing:12){
                    Grid(alignment:.leading,horizontalSpacing:20,verticalSpacing:14){
                        field("下一轮预留",text:$model.reserve,hint:"为新输入和工具结果留空间")
                        field("必须保留量",text:$model.floor,hint:"可选的手动下限；0 表示未指定")
                    }
                    if let budget=model.preview,let percent=model.selected?.modelMetadata?.effective_context_window_percent{
                        Text("底层配置已自动换算为 \(formatted(budget.rawWindow))，按 \(percent)% 读回 \(formatted(budget.usableWindow))。压缩按完整上下文计数。").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.top,10)
            }
        }
    }
    func percentage(_ value:Double)->String {value.formatted(.number.precision(.fractionLength(0...2)))}
    func metric(_ title:String,_ value:String)->some View {VStack(alignment:.leading,spacing:7){Text(title).font(.caption).foregroundStyle(.secondary);Text(value).font(.title2.monospacedDigit().weight(.semibold))}.frame(maxWidth:.infinity,alignment:.leading)}
    func field(_ label:String,text:Binding<String>,hint:String)->some View {GridRow{Text(label);VStack(alignment:.leading,spacing:4){TextField(label,text:text).textFieldStyle(.roundedBorder).frame(maxWidth:250);Text(hint).font(.caption).foregroundStyle(.secondary)}}}
}

@main @MainActor final class ContextControlApp:NSObject,NSApplicationDelegate,NSWindowDelegate {
    private let model=Controller()
    private var statusItem:NSStatusItem?
    private var settingsWindow:NSWindow?
    private var refreshTask:Task<Void,Never>?
    private let connectionItem=NSMenuItem(title:"正在连接 Codex…",action:nil,keyEquivalent:"")
    private let usageItem=NSMenuItem(title:"窗口待观测",action:nil,keyEquivalent:"")
    private let background=CommandLine.arguments.contains("--background")
    private var lastStatus:Data?

    static func main(){
        let app=NSApplication.shared
        let delegate=ContextControlApp();app.delegate=delegate
        app.setActivationPolicy(.accessory);app.run()
        withExtendedLifetime(delegate){}
    }
    func applicationDidFinishLaunching(_ notification:Notification){
        installMainMenu()
        let item=NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
        item.button?.title=" 上下文"
        item.button?.image=NSImage(systemSymbolName:"slider.horizontal.3",accessibilityDescription:"Codex 上下文设置")
        item.button?.image?.isTemplate=true
        item.button?.imagePosition = .imageLeading
        item.button?.toolTip="Codex 上下文设置"
        let menu=NSMenu();connectionItem.isEnabled=false;usageItem.isEnabled=false
        menu.addItem(connectionItem);menu.addItem(usageItem);menu.addItem(.separator())
        let open=NSMenuItem(title:"打开上下文设置…",action:#selector(showSettings),keyEquivalent:"");open.target=self;menu.addItem(open)
        let codex=NSMenuItem(title:"打开 Codex",action:#selector(openCodex),keyEquivalent:"");codex.target=self;menu.addItem(codex)
        menu.addItem(.separator())
        let note=NSMenuItem(title:"关闭设置窗口后，预算继续生效",action:nil,keyEquivalent:"");note.isEnabled=false;menu.addItem(note)
        let quit=NSMenuItem(title:"退出菜单栏入口",action:#selector(quitEntry),keyEquivalent:"");quit.target=self;quit.toolTip="预算控制继续运行，下次启动 Codex 时入口会再出现。";menu.addItem(quit)
        item.menu=menu;statusItem=item
        if !background{showSettings()}
        publishStatus()
        refreshTask=Task {while !Task.isCancelled{
            await model.refresh()
            connectionItem.title=model.bridgeCount>0 ? "Codex 已连接":"等待 Codex 接入"
            usageItem.title="最近读回窗口：\(formatted(model.selected?.observedWindow))"
            publishStatus()
            try? await Task.sleep(for:.seconds(2))
        }}
    }
    private func installMainMenu(){
        let bar=NSMenu(),appItem=NSMenuItem(),appMenu=NSMenu()
        appMenu.addItem(withTitle:"退出上下文设置",action:#selector(quitEntry),keyEquivalent:"q").target=self
        appItem.submenu=appMenu;bar.addItem(appItem)
        let editItem=NSMenuItem(title:"编辑",action:nil,keyEquivalent:""),edit=NSMenu(title:"编辑")
        for (title,action,key) in [("撤销","undo:","z"),("重做","redo:","Z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{edit.addItem(withTitle:title,action:Selector(action),keyEquivalent:key)}
        editItem.submenu=edit;bar.addItem(editItem);NSApplication.shared.mainMenu=bar
    }
    @objc private func showSettings(){
        if settingsWindow==nil{
            let window=NSWindow(contentRect:NSRect(x:0,y:0,width:1040,height:760),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
            window.title="Codex Context Control";window.minSize=NSSize(width:960,height:700)
            window.contentView=NSHostingView(rootView:ContentView(model:model))
            window.isReleasedWhenClosed=false;window.delegate=self;window.center();window.setFrameAutosaveName("ContextControlSettings")
            settingsWindow=window
        }
        settingsWindow?.deminiaturize(nil);settingsWindow?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps:true);publishStatus()
    }
    @objc private func openCodex(){model.launchCodex()}
    @objc private func quitEntry(){NSApplication.shared.terminate(nil)}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows:Bool)->Bool{showSettings();return false}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{false}
    func windowWillClose(_ notification:Notification){publishStatus(windowVisible:false)}
    private func publishStatus(windowVisible:Bool?=nil){
        let state:[String:Any]=["pid":ProcessInfo.processInfo.processIdentifier,"menuReady":statusItem?.isVisible==true,"windowVisible":windowVisible ?? settingsWindow?.isVisible ?? false,"bridgeCount":model.bridgeCount,"startedInBackground":background]
        guard let data=try? JSONSerialization.data(withJSONObject:state,options:.sortedKeys),data != lastStatus else{return}
        do {
            try FileManager.default.createDirectory(at:model.home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let url=model.home.appendingPathComponent("ui-status.json");try data.write(to:url,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);lastStatus=data
        }catch{}
    }
    func applicationWillTerminate(_ notification:Notification){refreshTask?.cancel();try? FileManager.default.removeItem(at:model.home.appendingPathComponent("ui-status.json"))}
}
