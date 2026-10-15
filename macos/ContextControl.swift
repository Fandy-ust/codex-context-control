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

@MainActor final class Controller: ObservableObject {
    @Published var chats:[Chat]=[]
    @Published var selectedID:String?
    @Published var bridgeCount=0
    @Published var notice="正在读取本地状态…"
    @Published var window="400K"
    @Published var compact="320K"
    @Published var reserve="16K"
    @Published var floor="0"
    @Published var working=false
    private var editingRevision=0
    private var refreshing=false
    var selected:Chat? {chats.first{$0.id==selectedID}}
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
            if notice=="正在读取本地状态…"{notice=bridgeCount>0 ? "已接入 Codex。" : "控制服务已启动。通过专用入口启动 Codex 后即可应用预算。"}
        }catch{notice="读取失败：\(error.localizedDescription)"}
    }
    func fill(){guard let chat=selected else{return};editingRevision=chat.policy?.revision ?? 0;if let p=chat.policy{window=String(p.window);compact=String(p.compact);reserve=String(p.reserve);floor=String(p.retainedFloor)}else{window="400K";compact="320K";reserve="16K";floor="0"}}
    var policy:[String:Any] {["window":window,"compact":compact,"reserve":reserve,"retainedFloor":floor,"scope":"total"]}
    func act(_ action:String) async {
        guard let chat=selected else{return};working=true;defer{working=false}
        do {
            var body:[String:Any]=["id":chat.id]
            if action=="preflight"||action=="policy"{body["policy"]=policy}
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
        let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/open")
        process.arguments=[FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Codex Context Launcher.app").path]
        do{try process.run();notice="若 Codex 已在运行，请先正常退出，再从接入入口启动。"}catch{notice=error.localizedDescription}
    }
}

func formatted(_ n:Int?) -> String {guard let n else{return "待观测"};return n.formatted()+" tokens"}
func phaseName(_ value:String?) -> String {
    switch value {case "confirmed":return "窗口已确认";case "awaiting_runtime_confirmation":return "等待下一轮确认";case "reloading":return "正在应用";case "waiting_for_idle","queued":return "等待轮次结束";case "needs_compaction":return "需要先压缩";case "needs_observation":return "等待用量记录";case "error","mismatch":return "需要处理";case "saved":return "已保存";default:return "尚未接入"}
}

struct ContentView: View {
    @StateObject private var model=Controller()
    @State private var confirmCompact=false
    var body: some View {
        NavigationSplitView {
            VStack(alignment:.leading,spacing:14){
                Text("聊天预算").font(.title2.bold())
                Label("已接入 \(model.bridgeCount) 个运行时",systemImage:model.bridgeCount>0 ? "checkmark.circle.fill":"circle.dashed").font(.caption).foregroundStyle(model.bridgeCount>0 ? .green:.secondary)
                List(model.chats,selection:$model.selectedID){chat in
                    VStack(alignment:.leading,spacing:5){Text(chat.title).lineLimit(1);Text((chat.connected ? phaseName(chat.phase):"尚未接入")+" · "+String(chat.id.prefix(8))).font(.caption).foregroundStyle(.secondary)}.padding(.vertical,4).tag(chat.id)
                }.listStyle(.sidebar)
                Button("启动已接入的 Codex",systemImage:"arrow.up.forward.app"){model.launchCodex()}.buttonStyle(.bordered)
            }.padding().frame(minWidth:235)
        } detail: {
            ScrollView {
                VStack(alignment:.leading,spacing:22){
                    if let chat=model.selected {
                        VStack(alignment:.leading,spacing:6){Text(chat.title).font(.title2.bold()).lineLimit(2).truncationMode(.tail);Text(chat.model ?? "模型将在接入后识别").foregroundStyle(.secondary)}
                        VStack(alignment:.leading,spacing:12){
                            HStack(spacing:28){metric(chat.observedWindowTitle,formatted(chat.observedWindow));metric("最近请求用量",formatted(chat.lastUsage?.totalTokens))}
                            if let target=chat.targetWindow,let policy=chat.policy,let percent=chat.modelMetadata?.effective_context_window_percent {
                                Text("已保存预算：\(formatted(policy.window)) × \(percent)% = 预期可用 \(formatted(target))\(chat.windowConfirmed ? "（已确认）":"（待确认）")").font(.callout).textSelection(.enabled)
                            }
                            if chat.phase=="awaiting_runtime_confirmation" {
                                Label("新预算已提交。上方仍是调整前的读回值，下一个正常请求完成后更新。",systemImage:"clock").font(.callout).foregroundStyle(.orange)
                            }
                        }
                        Text("窗口表示容量上限。最近请求用量是当前占用的近似值，不是聊天累计用量。压缩后的最低保留量不能预先保证。").font(.caption).foregroundStyle(.secondary)
                        Divider()
                        HStack {Text("本聊天的独立预算").font(.headline);Button("重新载入",systemImage:"arrow.clockwise"){model.fill()}.labelStyle(.iconOnly).help("重新读取此聊天已保存的设置");Spacer();ForEach([200,400,800],id:\.self){k in Button("\(k)K"){model.window="\(k)K";model.compact="\(k*8/10)K"}}}
                        Grid(alignment:.leading,horizontalSpacing:20,verticalSpacing:14){
                            field("窗口预算",text:$model.window,hint:"支持 400K 或 400000")
                            field("自动压缩阈值",text:$model.compact,hint:"按完整上下文计数；触发压缩的用量阈值")
                            field("下一轮预留",text:$model.reserve,hint:"为新输入和工具结果留空间")
                            field("必须保留量",text:$model.floor,hint:"可选的手动下限；0 表示未指定")
                        }
                        if let metadata=chat.modelMetadata {Text("目录上限：\(formatted(metadata.max_context_window)) · 可用比例：\(metadata.effective_context_window_percent ?? 0)%").font(.caption).foregroundStyle(.secondary)}
                        HStack {
                            Button("预检"){Task{await model.act("preflight")}}
                            Button(chat.connected ? "应用到此聊天":"保存，接入后应用"){Task{await model.act("policy")}}.buttonStyle(.borderedProminent)
                            Button("原生压缩…"){confirmCompact=true}.disabled(!chat.connected)
                            Spacer()
                            Button("停止自动应用"){Task{await model.act("clear")}}.foregroundStyle(.secondary)
                        }.disabled(model.working)
                        GroupBox {
                            VStack(alignment:.leading,spacing:8){Label(phaseName(chat.phase),systemImage:chat.phase=="confirmed" ? "checkmark.circle":"clock").font(.headline);Text(chat.message ?? "接入后，设置会在轮次之间应用。").foregroundStyle(.secondary);if let target=chat.targetWindow{Text("目标可用窗口：\(formatted(target))").font(.caption)}}.frame(maxWidth:.infinity,alignment:.leading).padding(4)
                        }
                    }else{
                        ContentUnavailableView("等待聊天接入",systemImage:"bubble.left.and.bubble.right",description:Text("先正常退出当前 Codex，再通过 Codex Context Launcher 启动。这里会列出可调整的聊天。"))
                    }
                    Divider();Text(model.notice).font(.callout).textSelection(.enabled).foregroundStyle(.secondary)
                }.padding(30).frame(maxWidth:850,alignment:.leading)
            }.frame(minWidth:650)
        }
        .frame(minWidth:960,minHeight:670)
        .onChange(of:model.selectedID){_,_ in model.fill()}
        .task {while !Task.isCancelled{await model.refresh();try? await Task.sleep(for:.seconds(2))}}
        .confirmationDialog("请求 Codex 原生压缩？",isPresented:$confirmCompact,titleVisibility:.visible){Button("请求压缩"){Task{await model.act("compact")}};Button("取消",role:.cancel){}}message:{Text("压缩可能使用现有模型额度。压缩结果长度无法保证，完成后需要重新测量。")}
    }
    func metric(_ title:String,_ value:String)->some View {VStack(alignment:.leading,spacing:7){Text(title).font(.caption).foregroundStyle(.secondary);Text(value).font(.title2.monospacedDigit().weight(.semibold))}.frame(maxWidth:.infinity,alignment:.leading)}
    func field(_ label:String,text:Binding<String>,hint:String)->some View {GridRow{Text(label);VStack(alignment:.leading,spacing:4){TextField(label,text:text).textFieldStyle(.roundedBorder).frame(maxWidth:250);Text(hint).font(.caption).foregroundStyle(.secondary)}}}
}

@main struct ContextControlApp: App {
    var body: some Scene {WindowGroup {ContentView()}.windowStyle(.titleBar).defaultSize(width:1040,height:720)}
}
