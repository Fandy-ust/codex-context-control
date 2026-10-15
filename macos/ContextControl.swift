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
struct ServiceSettings: Decodable {let node:String}

@MainActor final class Controller: ObservableObject {
    @Published var chats:[Chat]=[]
    @Published var selectedID:String?
    @Published var bridgeCount=0
    @Published var notice="正在读取本地状态…"
    @Published private(set) var windowK=400.0
    @Published private(set) var compactK=360.0
    private var ratioNumerator=90
    private var ratioDenominator=100
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
        guard let percent=chat.modelMetadata?.effective_context_window_percent,(1...100).contains(percent),chat.modelMetadata?.max_context_window != nil else{pendingMetadataID=chat.id;return}
        if let policy=chat.policy{
            let usable=policy.window*percent/100
            let actualCompact=min(policy.compact,policy.window*90/100)
            windowK=Double(max(2,min(usable/1000,maximumWindowK)))
            compactK=Double(max(1,min(actualCompact/1000,maximumCompactK)))
            ratioNumerator=Int(compactK);ratioDenominator=Int(windowK)
        }else{ratioNumerator=90;ratioDenominator=100;setWindowK(400)}
    }
    func calculate() throws -> BudgetPreview {
        guard let metadata=selected?.modelMetadata,let percent=metadata.effective_context_window_percent,let maximum=metadata.max_context_window else{throw BudgetInputError(message:"等待当前模型信息后即可设置实际可用窗口")}
        guard !waitingForModel else{throw BudgetInputError(message:"正在读取此聊天的窗口设置")}
        return try BudgetMath.sliderPreview(windowK:Int(windowK),compactK:Int(compactK),effectivePercent:percent,maximumRawWindow:maximum)
    }
    var preview:BudgetPreview? {try? calculate()}
    var previewError:String? {do{_ = try calculate();return nil}catch{return error.localizedDescription}}
    var maximumUsableWindow:Int? {guard let m=selected?.modelMetadata,let p=m.effective_context_window_percent,let w=m.max_context_window else{return nil};return w*p/100}
    var maximumWindowK:Int {max(2,(maximumUsableWindow ?? 400000)/1000)}
    var maximumCompactK:Int {
        guard let m=selected?.modelMetadata,let p=m.effective_context_window_percent,let w=m.max_context_window else{return 1}
        return (try? BudgetMath.maximumSliderCompactK(windowK:Int(windowK),effectivePercent:p,maximumRawWindow:w)) ?? 1
    }
    var canEditBudget:Bool {!waitingForModel && (maximumUsableWindow ?? 0)>=2000}
    var compactPercent:Double {compactK/windowK*100}
    func setWindowK(_ value:Double){
        windowK=max(2,min(Double(maximumWindowK),value.rounded()))
        compactK=Double(BudgetMath.linkedSliderCompactK(windowK:Int(windowK),ratioNumerator:ratioNumerator,ratioDenominator:ratioDenominator,maximumK:maximumCompactK))
    }
    func setCompactK(_ value:Double){
        compactK=max(1,min(Double(maximumCompactK),value.rounded()))
        ratioNumerator=Int(compactK);ratioDenominator=Int(windowK)
    }
    func setRatio(_ value:Int){ratioNumerator=value;ratioDenominator=100;setWindowK(windowK)}
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

private enum PanelStyle {
    static let background=Color(white:0.095)
    static let surface=Color(white:0.16)
    static let border=Color.white.opacity(0.09)
    static let blue=Color(red:0.27,green:0.50,blue:0.99)
    static let headroom=Color(red:0.64,green:0.53,blue:0.88)
}

private struct QuietButtonStyle:ButtonStyle {
    var selected=false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration:Configuration)->some View {
        configuration.label.font(.system(size:12,weight:.medium))
            .padding(.horizontal,12).padding(.vertical,7)
            .foregroundStyle(selected ? PanelStyle.blue:Color.secondary)
            .background(selected ? PanelStyle.blue.opacity(0.13):Color.white.opacity(configuration.isPressed ? 0.10:0.04),in:Capsule())
            .overlay(Capsule().strokeBorder(selected ? PanelStyle.blue.opacity(0.25):Color.clear,lineWidth:1))
            .scaleEffect(configuration.isPressed ? 0.97:1)
            .opacity(enabled ? 1:0.35)
    }
}

private struct ApplyButtonStyle:ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration:Configuration)->some View {
        configuration.label.font(.system(size:12,weight:.medium)).padding(.horizontal,16).padding(.vertical,9)
            .foregroundStyle(.white).background(PanelStyle.blue.opacity(enabled ? (configuration.isPressed ? 0.8:1):0.35),in:Capsule())
    }
}

private enum BudgetThumb {case compact,window}

/// Both handles share the model-capacity scale. The selected handle stays fixed
/// during a gesture even when moving the window also moves the linked threshold.
private struct BudgetRangeSlider:View {
    @Binding var window:Double
    @Binding var compact:Double
    @Binding var selection:BudgetThumb
    let maximumWindow:Int
    let maximumCompact:Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var enabled
    @FocusState private var focused:Bool
    @State private var active=NSApplication.shared.isActive
    @State private var dragging:BudgetThumb?
    private let diameter:CGFloat=18
    var body:some View {
        GeometryReader {geometry in
            let travel=max(1,geometry.size.width-diameter)
            let windowX=diameter/2+travel*max(0,min(1,window/Double(max(1,maximumWindow))))
            let compactX=diameter/2+travel*max(0,min(1,compact/Double(max(1,maximumWindow))))
            ZStack(alignment:.leading){
                ZStack(alignment:.leading){
                    Rectangle().fill(.white.opacity(0.10))
                    Rectangle().fill(PanelStyle.blue).frame(width:compactX)
                    Rectangle().fill(PanelStyle.headroom.opacity(0.8)).frame(width:max(0,windowX-compactX)).offset(x:compactX)
                    HStack {ForEach(0..<5){_ in Circle().fill(.white.opacity(0.18)).frame(width:3,height:3).frame(maxWidth:.infinity)}}.padding(.horizontal,diameter/2)
                    TimelineView(.animation(minimumInterval:1.0/24,paused:reduceMotion || !active || !enabled)){timeline in
                        Canvas {context,size in
                            guard !reduceMotion else{return}
                            let time=timeline.date.timeIntervalSinceReferenceDate
                            for index in 0..<4 {
                                let phase=(time/7+Double(index)*0.247).truncatingRemainder(dividingBy:1)
                                let x=phase*max(1,compactX-8)+4
                                let y=size.height/2+sin(phase*Double.pi*2+Double(index))*3
                                context.fill(Path(ellipseIn:CGRect(x:x,y:y,width:2,height:2)),with:.color(.white.opacity(sin(phase*Double.pi)*0.45)))
                            }
                        }
                    }.frame(width:compactX).allowsHitTesting(false)
                }.frame(height:18).clipShape(Capsule())
                thumb(.compact,color:PanelStyle.blue).offset(x:compactX-diameter/2)
                thumb(.window,color:.white).offset(x:windowX-diameter/2)
            }
            .frame(height:28).frame(maxHeight:.infinity).contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance:0).onChanged {event in
                guard enabled else{return}
                if dragging==nil {
                    // In tight ranges, choosing the numeric heading first also
                    // lets the user select a handle whose hit areas overlap.
                    let left=abs(event.startLocation.x-compactX),right=abs(event.startLocation.x-windowX)
                    dragging=abs(left-right)<3 ? selection:(left<right ? .compact:.window)
                    selection=dragging!;focused=true
                }
                let tokens=(max(0,min(1,(event.location.x-diameter/2)/travel))*Double(maximumWindow)).rounded()
                if dragging == .compact{compact=max(1,min(Double(maximumCompact),tokens))}
                else{window=max(2,min(Double(maximumWindow),tokens))}
            }.onEnded {_ in dragging=nil})
            .animation(reduceMotion || dragging != nil ? nil:.easeOut(duration:0.18),value:window)
            .animation(reduceMotion || dragging != nil ? nil:.easeOut(duration:0.18),value:compact)
        }
        .frame(height:38).opacity(enabled ? 1:0.4)
        .focusable(enabled).focused($focused)
        .overlay(RoundedRectangle(cornerRadius:20).strokeBorder(focused ? PanelStyle.blue.opacity(0.35):.clear,lineWidth:1).padding(-4))
        .onKeyPress(.leftArrow){guard enabled else{return .ignored};adjust(-1);return .handled}
        .onKeyPress(.rightArrow){guard enabled else{return .ignored};adjust(1);return .handled}
        .onChange(of:selection){_,_ in if enabled{focused=true}}
        .accessibilityRepresentation {
            HStack {
                Slider(value:$compact,in:1...Double(max(2,maximumCompact)),step:1).accessibilityLabel("压缩触发点").accessibilityValue("\(Int(compact))K").disabled(!enabled || maximumCompact<=1)
                Slider(value:$window,in:2...Double(max(3,maximumWindow)),step:1).accessibilityLabel("上下文窗口上限").accessibilityValue("\(Int(window))K").disabled(!enabled || maximumWindow<=2)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for:NSApplication.didBecomeActiveNotification)){_ in active=true}
        .onReceive(NotificationCenter.default.publisher(for:NSApplication.didResignActiveNotification)){_ in active=false}
        .onAppear{active=NSApplication.shared.isActive}.onDisappear{active=false}
    }
    private func thumb(_ target:BudgetThumb,color:Color)->some View {
        Circle().fill(color).overlay(Circle().strokeBorder(target == .compact ? .white.opacity(0.85):.black.opacity(0.12),lineWidth:1.5))
            .frame(width:diameter,height:diameter).shadow(color:.black.opacity(0.25),radius:3,y:1)
            .scaleEffect(dragging==target ? 1.15:1)
    }
    private func adjust(_ delta:Double){
        if selection == .compact{compact=max(1,min(Double(maximumCompact),compact+delta))}
        else{window=max(2,min(Double(maximumWindow),window+delta))}
    }
}

struct ContentView: View {
    @ObservedObject var model:Controller
    @State private var confirmCompact=false
    @State private var selectedThumb:BudgetThumb = .window
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        NavigationSplitView {
            VStack(alignment:.leading,spacing:14){
                Text("上下文").font(.system(size:19,weight:.semibold)).frame(maxWidth:.infinity,alignment:.leading)
                Label(model.bridgeCount>0 ? "已连接 Codex":"等待连接",systemImage:model.bridgeCount>0 ? "circle.fill":"circle.dashed").font(.system(size:11)).foregroundStyle(.secondary).frame(maxWidth:.infinity,alignment:.leading)
                ScrollView {
                    LazyVStack(spacing:4){ForEach(model.chats){chat in
                        Button {model.selectedID=chat.id} label:{
                            VStack(alignment:.leading,spacing:5){Text(chat.title).font(.system(size:13,weight:.medium)).lineLimit(1);Text(chat.connected ? phaseName(chat.phase):"尚未接入").font(.system(size:11)).foregroundStyle(.secondary)}
                                .frame(maxWidth:.infinity,alignment:.leading).padding(12)
                                .background(model.selectedID==chat.id ? Color.white.opacity(0.08):.clear,in:RoundedRectangle(cornerRadius:12))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityAddTraits(model.selectedID==chat.id ? .isSelected:[])
                    }}
                }.frame(maxHeight:.infinity)
                Button("打开 Codex",systemImage:"arrow.up.forward.app"){model.launchCodex()}.buttonStyle(.bordered)
            }.padding().frame(minWidth:235).background(PanelStyle.background)
        } detail: {
            ScrollView {
                VStack(alignment:.leading,spacing:24){
                    if let chat=model.selected {
                        VStack(alignment:.leading,spacing:7){Text(chat.title).font(.system(size:20,weight:.medium)).lineLimit(2).truncationMode(.tail);Text(chat.model ?? "模型将在接入后识别").font(.callout).foregroundStyle(.secondary)}
                        VStack(alignment:.leading,spacing:12){
                            HStack(spacing:28){metric(chat.observedWindowTitle,formatted(chat.observedWindow));metric("最近请求用量",formatted(chat.lastUsage?.totalTokens))}
                            if let target=chat.targetWindow,let policy=chat.policy {
                                Text("已保存：可用窗口 \(formatted(target)) · 压缩阈值 \(formatted(min(policy.compact,policy.window*90/100)))\(chat.windowConfirmed ? "（窗口已确认）":"（窗口待确认）")").font(.callout).textSelection(.enabled)
                            }
                            if chat.phase=="awaiting_runtime_confirmation" {
                                Label("新预算已提交。上方仍是调整前的读回值，下一个正常请求完成后更新。",systemImage:"clock").font(.callout).foregroundStyle(.orange)
                            }
                        }
                        Divider()
                        budgetEditor().disabled(!model.canEditBudget)
                        HStack {
                            Button("预检"){Task{await model.act("preflight")}}.buttonStyle(QuietButtonStyle()).disabled(model.preview==nil)
                            Button(chat.connected ? "应用到此聊天":"保存，接入后应用"){Task{await model.act("policy")}}.buttonStyle(ApplyButtonStyle()).disabled(model.preview==nil)
                            Button("原生压缩…"){confirmCompact=true}.buttonStyle(QuietButtonStyle()).disabled(!chat.connected)
                            Spacer()
                            Button("停止自动应用"){Task{await model.act("clear")}}.buttonStyle(QuietButtonStyle())
                        }.disabled(model.working)
                        VStack(alignment:.leading,spacing:7){Label(phaseName(chat.phase),systemImage:chat.phase=="confirmed" ? "checkmark.circle":"clock").font(.callout.weight(.medium));Text(chat.message ?? "接入后，设置会在轮次之间应用。").font(.caption).foregroundStyle(.secondary)}.frame(maxWidth:.infinity,alignment:.leading).padding(16).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:16))
                    }else{
                        ContentUnavailableView("等待聊天接入",systemImage:"bubble.left.and.bubble.right",description:Text("照常打开 Codex 并进入聊天，控制连接会随运行时自动启动。首次安装后请正常重开一次客户端。"))
                    }
                    Divider();Text(model.notice).font(.callout).textSelection(.enabled).foregroundStyle(.secondary)
                }.padding(32).frame(maxWidth:850,alignment:.leading).frame(maxWidth:.infinity)
            }.frame(minWidth:650).background(PanelStyle.background)
        }
        .frame(minWidth:960,minHeight:670)
        .preferredColorScheme(.dark).tint(PanelStyle.blue)
        .onChange(of:model.selectedID){_,_ in model.fill()}
        .confirmationDialog("请求 Codex 原生压缩？",isPresented:$confirmCompact,titleVisibility:.visible){Button("请求压缩"){Task{await model.act("compact")}};Button("取消",role:.cancel){}}message:{Text("压缩可能使用现有模型额度。压缩结果长度无法保证，完成后需要重新测量。")}
    }
    func budgetEditor()->some View {
        VStack(alignment:.leading,spacing:18){
            rangeEditor()
            Text("将蓝色压缩点往左拉，紫色余量随之增加。每步 1K，应用后生效。")
                .font(.system(size:11)).foregroundStyle(.secondary)
            if let error=model.previewError{Label(error,systemImage:"exclamationmark.circle").font(.callout).foregroundStyle(.orange)}
            DisclosureGroup("高级设置"){
                VStack(alignment:.leading,spacing:12){
                    Grid(alignment:.leading,horizontalSpacing:20,verticalSpacing:14){
                        field("下一轮预留",text:$model.reserve,hint:"为新输入和工具结果留空间")
                        field("必须保留量",text:$model.floor,hint:"可选的手动下限；0 表示未指定")
                    }
                    Text("窗口是容量上限。最近请求用量是当前占用的近似值；压缩后保留多少无法预先保证。联动阈值向下取整到 1K。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let budget=model.preview,let percent=model.selected?.modelMetadata?.effective_context_window_percent{
                        Text("底层配置已自动换算为 \(formatted(budget.rawWindow))，按 \(percent)% 读回 \(formatted(budget.usableWindow))。压缩按完整上下文计数。").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.top,12)
            }.font(.callout).foregroundStyle(.secondary)
        }
    }
    private func rangeEditor()->some View {
        VStack(spacing:16){
            HStack(alignment:.center){
                rangeValue("压缩触发",value:model.compactK,color:PanelStyle.blue,thumb:.compact)
                Spacer()
                VStack(spacing:5){Text("\(Int(max(0,model.windowK-model.compactK)))K").font(.system(size:22,weight:.medium,design:.rounded)).monospacedDigit().foregroundStyle(PanelStyle.headroom);Text("窗口余量").font(.system(size:11)).foregroundStyle(.secondary)}
                Spacer()
                rangeValue("上下文窗口",value:model.windowK,color:.white,thumb:.window)
                Button {model.fill()} label:{Image(systemName:"arrow.counterclockwise").font(.system(size:14)).frame(width:22,height:26)}
                    .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("重新载入已保存预算").help("重新载入已保存预算")
            }
            BudgetRangeSlider(window:Binding(get:{model.windowK},set:{model.setWindowK($0)}),compact:Binding(get:{model.compactK},set:{model.setCompactK($0)}),selection:$selectedThumb,maximumWindow:model.maximumWindowK,maximumCompact:model.maximumCompactK)
            HStack {Text("0K");Spacer();Text("模型上限 \(model.maximumWindowK)K")}.font(.system(size:10)).foregroundStyle(.tertiary).monospacedDigit()
            Divider().overlay(.white.opacity(0.02))
            HStack(spacing:7){
                microAdjust("压缩",value:Binding(get:{model.compactK},set:{model.setCompactK($0)}),minimum:1,maximum:model.maximumCompactK,color:PanelStyle.blue)
                Text("\(percentage(model.compactPercent))%").font(.system(size:11)).foregroundStyle(.secondary).monospacedDigit().frame(width:44)
                Spacer(minLength:4)
                ForEach([80,85,90],id:\.self){ratio in Button("\(ratio)%"){model.setRatio(ratio)}.buttonStyle(QuietButtonStyle(selected:abs(model.compactPercent-Double(ratio))<0.2))}
                Button("最大"){model.setCompactK(Double(model.maximumCompactK))}.buttonStyle(QuietButtonStyle(selected:Int(model.compactK)==model.maximumCompactK))
            }
            HStack(spacing:7){
                microAdjust("窗口",value:Binding(get:{model.windowK},set:{model.setWindowK($0)}),minimum:2,maximum:model.maximumWindowK,color:.white)
                Spacer(minLength:4)
                ForEach([200,400,800],id:\.self){k in Button("\(k)K"){model.setWindowK(Double(k))}.buttonStyle(QuietButtonStyle(selected:Int(model.windowK)==k)).disabled(k>model.maximumWindowK)}
                Button("最大"){model.setWindowK(Double(model.maximumWindowK))}.buttonStyle(QuietButtonStyle(selected:Int(model.windowK)==model.maximumWindowK))
            }
        }
        .padding(24)
        .background(PanelStyle.surface,in:RoundedRectangle(cornerRadius:26,style:.continuous))
        .overlay(RoundedRectangle(cornerRadius:26,style:.continuous).strokeBorder(PanelStyle.border,lineWidth:1))
    }
    private func rangeValue(_ title:String,value:Double,color:Color,thumb:BudgetThumb)->some View {
        Button {selectedThumb=thumb} label:{
            VStack(spacing:5){
                Text("\(Int(value))K").font(.system(size:28,weight:.medium,design:.rounded)).monospacedDigit().foregroundStyle(color)
                    .contentTransition(.numericText()).animation(reduceMotion ? nil:.easeOut(duration:0.18),value:value)
                HStack(spacing:5){Circle().fill(color).frame(width:5,height:5);Text(title).font(.system(size:12)).foregroundStyle(.secondary)}
            }.padding(.vertical,4).padding(.horizontal,8).background(selectedThumb==thumb ? .white.opacity(0.035):.clear,in:RoundedRectangle(cornerRadius:10))
        }.buttonStyle(.plain).accessibilityLabel("选择\(title)滑块，\(Int(value))K").help("选中后，可用轨道上的左右方向键逐 K 调整")
    }
    private func microAdjust(_ title:String,value:Binding<Double>,minimum:Int,maximum:Int,color:Color)->some View {
        HStack(spacing:6){
            Text(title).font(.system(size:11)).foregroundStyle(color).frame(width:28,alignment:.leading)
            Button {value.wrappedValue-=1} label:{Image(systemName:"minus").font(.system(size:10,weight:.medium)).frame(width:22,height:22).background(.white.opacity(0.05),in:Circle())}
                .buttonStyle(.plain).accessibilityLabel("\(title)减少 1K").disabled(value.wrappedValue<=Double(minimum))
            Button {value.wrappedValue+=1} label:{Image(systemName:"plus").font(.system(size:10,weight:.medium)).frame(width:22,height:22).background(.white.opacity(0.05),in:Circle())}
                .buttonStyle(.plain).accessibilityLabel("\(title)增加 1K").disabled(value.wrappedValue>=Double(maximum))
        }.foregroundStyle(.secondary)
    }
    func percentage(_ value:Double)->String {value.formatted(.number.precision(.fractionLength(0...1)))}
    func metric(_ title:String,_ value:String)->some View {VStack(alignment:.leading,spacing:7){Text(title).font(.caption).foregroundStyle(.secondary);Text(value).font(.title2.monospacedDigit().weight(.semibold))}.frame(maxWidth:.infinity,alignment:.leading)}
    func field(_ label:String,text:Binding<String>,hint:String)->some View {GridRow{Text(label);VStack(alignment:.leading,spacing:4){TextField(label,text:text).textFieldStyle(.roundedBorder).frame(maxWidth:250);Text(hint).font(.caption).foregroundStyle(.secondary)}}}
}

@main @MainActor final class ContextControlApp:NSObject,NSApplicationDelegate,NSWindowDelegate {
    private let model=Controller()
    private var statusItem:NSStatusItem?
    private var settingsWindow:NSWindow?
    private var refreshTask:Task<Void,Never>?
    private var serviceStarter:Process?
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
        startLocalService()
        installMainMenu()
        let item=NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
        item.button?.title=" 上下文"
        item.button?.image=NSImage(systemSymbolName:"slider.horizontal.3",accessibilityDescription:"Codex 上下文设置")
        item.button?.image?.isTemplate=true
        item.button?.imagePosition = .imageLeading
        item.button?.toolTip="Codex 上下文设置"
        item.button?.setAccessibilityLabel("Codex 上下文设置")
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
    private func startLocalService(){
        // The app itself stays the native CFBundleExecutable. Starting Node
        // from a shell entrypoint prevents reliable Launch Services attribution.
        guard let data=try? Data(contentsOf:model.home.appendingPathComponent("settings.json")),
              let settings=try? JSONDecoder().decode(ServiceSettings.self,from:data) else{return}
        let cli=model.home.appendingPathComponent("code/src/cli.mjs")
        guard FileManager.default.fileExists(atPath:cli.path) else{return}
        let process=Process();process.executableURL=URL(fileURLWithPath:settings.node)
        process.arguments=[cli.path,"start"];process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        do{try process.run();serviceStarter=process}catch{model.notice="无法启动本地服务：\(error.localizedDescription)"}
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
            window.appearance=NSAppearance(named:.darkAqua)
            window.backgroundColor=NSColor(white:0.095,alpha:1)
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
        let menuWindow=statusItem?.button?.window
        let frame=menuWindow?.frame ?? .zero
        let onScreen=frame.width>0 && frame.height>0 && NSScreen.screens.contains{$0.frame.intersects(frame)}
        let state:[String:Any]=["pid":ProcessInfo.processInfo.processIdentifier,"menuReady":statusItem?.isVisible==true,"menuWindowVisible":menuWindow?.isVisible==true,"menuOnScreen":onScreen,"menuFrame":["x":frame.origin.x,"y":frame.origin.y,"width":frame.width,"height":frame.height],"bundleIdentifier":Bundle.main.bundleIdentifier ?? "","windowVisible":windowVisible ?? settingsWindow?.isVisible ?? false,"bridgeCount":model.bridgeCount,"startedInBackground":background]
        guard let data=try? JSONSerialization.data(withJSONObject:state,options:.sortedKeys),data != lastStatus else{return}
        do {
            try FileManager.default.createDirectory(at:model.home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let url=model.home.appendingPathComponent("ui-status.json");try data.write(to:url,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);lastStatus=data
        }catch{}
    }
    func applicationWillTerminate(_ notification:Notification){refreshTask?.cancel();try? FileManager.default.removeItem(at:model.home.appendingPathComponent("ui-status.json"))}
}
