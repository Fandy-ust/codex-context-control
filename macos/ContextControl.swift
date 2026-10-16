import SwiftUI
import AppKit

struct Budget: Decodable,Equatable { let window:Int;let compact:Int;let reserve:Int;let retainedFloor:Int;let revision:Int;let enabled:Bool? }
struct Usage: Decodable,Equatable { let totalTokens:Int }
struct Metadata: Decodable,Equatable { let max_context_window:Int?;let effective_context_window_percent:Int?;let context_ceiling:Int?;let context_compact_ceiling:Int?;let context_catalog_ready:Bool? }
struct Chat: Identifiable, Decodable,Equatable {
    let id:String;let name:String?;let model:String?;let cwd:String?;let status:String?
    let connected:Bool;let ambiguous:Bool;let phase:String?;let message:String?
    let ephemeral:Bool?;let canAcceptDirectInput:Bool?;let threadSource:String?;let lastActivityAt:Int?;let lastStartedAt:Int?;let lastCompletedAt:Int?
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
struct RuntimeFixState:Decodable,Equatable {let enabled:Bool;let available:Bool;let compatible:Bool;let baseVersion:String;let originalVersion:String?;let activeCount:Int;let pending:Bool;let message:String}
struct NewChatDefaultsState:Decodable,Equatable {let usableWindow:Int;let compact:Int;let revision:Int}
struct ContextExtensionState:Decodable,Equatable {let enabled:Bool;let effective:Bool;let pending:Bool;let activeCount:Int;let connectedCount:Int;let compatible:Bool;let available:Bool;let message:String}
struct NewChatDefaultsLimits:Decodable,Equatable {let maximumUsableWindow:Int;let effectivePercent:Int;let extended:Bool}
struct RuntimeState: Decodable {let version:String;let bridgeCount:Int;let threads:[Chat];let runtimeFix:RuntimeFixState?;let contextCeilingPending:Bool?;let newChatDefaults:NewChatDefaultsState?;let newChatDefaultsPending:Bool?;let contextExtension:ContextExtensionState?;let newChatDefaultsLimits:NewChatDefaultsLimits?}
struct Connection: Decodable {let port:Int;let token:String}
struct DesktopSettings: Decodable {let desktopExecutable:String}
struct ServiceSettings: Decodable {let node:String}

@MainActor final class Controller: ObservableObject {
    @Published var chats:[Chat]=[]
    @Published var selectedID:String?
    @Published var bridgeCount=0
    @Published var contextCeilingPending=false
    @Published var contextExtension:ContextExtensionState?
    @Published var changingContextExtension=false
    @Published var newChatDefaultsLimits:NewChatDefaultsLimits?
    @Published var newChatDefaults:NewChatDefaultsState?
    @Published var newChatDefaultsPending=false
    @Published var serviceAvailable=false
    @Published var menuHeightLimit:CGFloat=560
    @Published var runtimeFix:RuntimeFixState?
    @Published var changingRuntimeFix=false
    @Published var notice="正在读取本地状态…"
    @Published private(set) var windowK=400.0
    @Published private(set) var compactK=360.0
    private var ratioNumerator=90
    private var ratioDenominator=100
    @Published var reserve="16K" {didSet{budgetEdited=true}}
    @Published var floor="0" {didSet{budgetEdited=true}}
    @Published var working=false
    private var editingRevision=0
    private var budgetEdited=false
    var menuDragInProgress=false
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
        if refreshing || menuDragInProgress{return};refreshing=true;defer{refreshing=false}
        do {let state=try JSONDecoder().decode(RuntimeState.self,from:await api("/state"))
            guard !menuDragInProgress else{return}
            if chats != state.threads{chats=state.threads}
            if bridgeCount != state.bridgeCount{bridgeCount=state.bridgeCount}
            if runtimeFix != state.runtimeFix{runtimeFix=state.runtimeFix}
            if contextCeilingPending != (state.contextCeilingPending ?? false){contextCeilingPending=state.contextCeilingPending ?? false}
            if contextExtension != state.contextExtension{contextExtension=state.contextExtension}
            if newChatDefaultsLimits != state.newChatDefaultsLimits{newChatDefaultsLimits=state.newChatDefaultsLimits}
            if newChatDefaults != state.newChatDefaults{newChatDefaults=state.newChatDefaults}
            if newChatDefaultsPending != (state.newChatDefaultsPending ?? false){newChatDefaultsPending=state.newChatDefaultsPending ?? false}
            if !serviceAvailable{serviceAvailable=true}
            if selectedID==nil{selectedID=chats.first?.id;fill()}
            else if waitingForModel,let metadata=selected?.modelMetadata,metadata.effective_context_window_percent != nil,metadata.max_context_window != nil{fill()}
            else if !budgetEdited,editingRevision != (selected?.policy?.revision ?? 0){fill()}
            if notice=="正在读取本地状态…"||notice.hasPrefix("读取失败："){notice=bridgeCount>0 ? "已接入 Codex。" : "照常打开 Codex 并进入聊天，预算控制会自动接入。首次安装后请正常重开一次客户端。"}
        }catch{serviceAvailable=false;notice="读取失败：\(error.localizedDescription)"}
    }
    func setContextExtension(_ enabled:Bool) async {
        changingContextExtension=true;defer{changingContextExtension=false}
        do{let data=try await api("/context-extension",body:["enabled":enabled]);contextExtension=try JSONDecoder().decode(ContextExtensionState.self,from:data);await refresh();fill();notice=contextExtension?.message ?? "拓展设置已保存"}catch{notice=error.localizedDescription}
    }
    func fill(){
        defer{budgetEdited=false}
        guard let chat=selected else{return};editingRevision=chat.policy?.revision ?? 0;pendingMetadataID=nil
        reserve=String(chat.policy?.reserve ?? 16000);floor=String(chat.policy?.retainedFloor ?? 0)
        guard let percent=chat.modelMetadata?.effective_context_window_percent,(1...100).contains(percent),chat.modelMetadata?.max_context_window != nil else{pendingMetadataID=chat.id;return}
        if let policy=chat.policy{
            let usable=policy.window*percent/100
            let actualCompact=min(policy.compact,policy.window*90/100)
            windowK=Double(max(2,min(usable/1000,maximumWindowK)))
            compactK=Double(max(1,min(actualCompact/1000,maximumCompactK)))
            ratioNumerator=Int(compactK);ratioDenominator=Int(windowK)
        }else if chat.modelMetadata?.context_ceiling != nil {setWindowK(Double((chat.observedWindow ?? 920000)/1000));setCompactK(Double(maximumCompactK))}
        else{ratioNumerator=90;ratioDenominator=100;setWindowK(400)}
    }
    func calculate() throws -> BudgetPreview {
        guard let metadata=selected?.modelMetadata,let percent=metadata.effective_context_window_percent,let maximum=metadata.max_context_window else{throw BudgetInputError(message:"等待当前模型信息后即可设置实际可用窗口")}
        guard metadata.context_catalog_ready != false else{throw BudgetInputError(message:bridgeCount==0 ? "打开 Codex 并进入聊天后即可调整":selected?.connected == true ? "请完整退出并重开 Codex，使上下文设置生效":"请先在 Codex 打开此聊天")}
        guard !waitingForModel else{throw BudgetInputError(message:"正在读取此聊天的窗口设置")}
        guard Int(compactK)<=maximumCompactK else{throw BudgetInputError(message:"压缩阈值需保留下一轮输入余量")}
        return try BudgetMath.sliderPreview(windowK:Int(windowK),compactK:Int(compactK),effectivePercent:percent,maximumRawWindow:maximum)
    }
    var preview:BudgetPreview? {try? calculate()}
    var previewError:String? {do{_ = try calculate();return nil}catch{return error.localizedDescription}}
    var maximumUsableWindow:Int? {guard let m=selected?.modelMetadata,let p=m.effective_context_window_percent,let w=m.max_context_window else{return nil};return w*p/100}
    var maximumWindowK:Int {max(2,(maximumUsableWindow ?? 400000)/1000)}
    var maximumCompactK:Int {
        guard let m=selected?.modelMetadata,let p=m.effective_context_window_percent,let w=m.max_context_window else{return 1}
        let native=(try? BudgetMath.maximumSliderCompactK(windowK:Int(windowK),effectivePercent:p,maximumRawWindow:w)) ?? 1
        let safe=m.context_ceiling.map{max(1000,$0-max(16000,(try? BudgetMath.tokens(reserve)) ?? 16000))/1000} ?? Int.max
        return min(native,safe)
    }
    var canEditBudget:Bool {!waitingForModel && (maximumUsableWindow ?? 0)>=2000 && selected?.modelMetadata?.context_catalog_ready != false}
    var compactPercent:Double {compactK/windowK*100}
    func setWindowK(_ value:Double){
        budgetEdited=true
        windowK=max(2,min(Double(maximumWindowK),value.rounded()))
        compactK=Double(BudgetMath.linkedSliderCompactK(windowK:Int(windowK),ratioNumerator:ratioNumerator,ratioDenominator:ratioDenominator,maximumK:maximumCompactK))
    }
    func setCompactK(_ value:Double){
        budgetEdited=true
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
            else if action=="policy"{editingRevision=(object?["policy"] as? [String:Any])?["revision"] as? Int ?? editingRevision;budgetEdited=false;notice="预算已保存。请查看下方应用状态；实际值将在正常下一轮请求后确认。"}
            else{notice=object?["message"] as? String ?? "操作已提交。"}
            await refresh()
        }catch{notice=error.localizedDescription}
    }
    func setRuntimeFix(_ enabled:Bool) async {
        if changingRuntimeFix{return};changingRuntimeFix=true;defer{changingRuntimeFix=false}
        do {
            runtimeFix=try JSONDecoder().decode(RuntimeFixState.self,from:await api("/runtime-fix",body:["enabled":enabled]))
            notice=runtimeFix?.message ?? "设置已保存"
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
    switch value {case "extension_pending":return "等待重开 Codex";case "compacting":return "正在保护性压缩";case "confirmed":return "窗口已确认";case "awaiting_runtime_confirmation":return "等待下一轮确认";case "reloading":return "正在应用";case "waiting_for_idle","queued":return "等待轮次结束";case "needs_compaction":return "需要先压缩";case "needs_observation":return "等待用量记录";case "error","mismatch":return "需要处理";case "saved":return "已保存";default:return "尚未接入"}
}

private enum PanelStyle {
    static let background=Color(white:0.095)
    static let surface=Color(white:0.16)
    static let border=Color.white.opacity(0.09)
    static let blue=Color(red:0.27,green:0.50,blue:0.99)
    static let headroom=Color(white:0.55)
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

enum BudgetThumb {case compact,window}

/// Integrate motion locally so changing the budget changes speed without
/// teleporting particles. Additional short streams make the right side denser.
@MainActor private final class BudgetParticleClock {
    private var anchor=Date.timeIntervalSinceReferenceDate
    private var offset=0.0
    private var speed=0.055
    private var paused=false
    func phase(at time:Double)->Double {offset+(paused ? 0:max(0,time-anchor)*speed)}
    func update(intensity:Double,paused:Bool){
        let now=Date.timeIntervalSinceReferenceDate
        offset=phase(at:now);anchor=now
        speed=0.055+0.18*max(0,min(1,intensity));self.paused=paused
    }
}

@MainActor private struct BudgetFlowParticles:View {
    let intensity:Double
    let paused:Bool
    let reducedMotion:Bool
    @State private var clock=BudgetParticleClock()
    var body:some View {
        TimelineView(.animation(minimumInterval:1.0/30,paused:paused || reducedMotion)){timeline in
            let phase=clock.phase(at:timeline.date.timeIntervalSinceReferenceDate)
        Canvas {context,size in
                guard !reducedMotion else{return}
                let level=max(0,min(1,intensity))
                let population=max(2,min(40,size.width/38*(0.55+1.5*level)))
                for index in 0..<40 {
                    let visibility=max(0,min(1,population-Double(index)))
                    guard visibility>0 else{continue}
                    let seed=(Double(index)*0.61803398875).truncatingRemainder(dividingBy:1)
                    let start=[0.0,0.25,0.50,0.70][index%4]
                    let progress=(phase*(0.85+seed*0.3)/(1-start)+seed).truncatingRemainder(dividingBy:1)
                    let accelerated=(exp(progress*1.25)-1)/(exp(1.25)-1)
                    let x=(start+(1-start)*accelerated)*size.width
                    let lane=(Double((index*7)%13)/12-0.5)*size.height*0.58
                    let y=size.height/2+lane+sin(progress*Double.pi*2+seed*6)*1.5
                    let diameter=1.4+seed*1.6
                    let fade=pow(max(0,sin(progress*Double.pi)),0.65)
                    let opacity=visibility*fade*(0.24+0.32*level)
                    context.fill(Path(ellipseIn:CGRect(x:x-diameter/2,y:y-diameter/2,width:diameter,height:diameter)),with:.color(.white.opacity(opacity)))
                }
            }
        }
        .onChange(of:intensity,initial:true){_,value in clock.update(intensity:value,paused:paused || reducedMotion)}
        .onChange(of:paused){_,value in clock.update(intensity:intensity,paused:value || reducedMotion)}
        .onChange(of:reducedMotion){_,value in clock.update(intensity:intensity,paused:paused || value)}
        .allowsHitTesting(false)
    }
}


/// Both handles share the model-capacity scale. The selected handle stays fixed
/// during a gesture even when moving the window also moves the linked threshold.
@MainActor struct BudgetRangeSlider:View {
    @Binding var window:Double
    @Binding var compact:Double
    @Binding var selection:BudgetThumb
    let maximumWindow:Int
    let maximumCompact:Int
    var compactStyle=false
    var windowOnly=false
    var onEditingChanged:(Bool)->Void={_ in}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var enabled
    @FocusState private var focused:Bool
    @State private var active=NSApplication.shared.isActive
    @State private var dragging:BudgetThumb?
    @State private var dragUpdates=MenuDragUpdates()
    private var diameter:CGFloat {compactStyle ? 22:32}
    private var trackHeight:CGFloat {compactStyle ? 16:26}
    var body:some View {
        GeometryReader {geometry in
            let travel=max(1,geometry.size.width-diameter)
            let windowX=diameter/2+travel*max(0,min(1,window/Double(max(1,maximumWindow))))
            let compactX=diameter/2+travel*max(0,min(1,compact/Double(max(1,maximumWindow))))
            let fillX=windowOnly ? windowX:compactX
            ZStack(alignment:.leading){
                ZStack(alignment:.leading){
                    Rectangle().fill(.white.opacity(0.10))
                    if maximumWindow==920 && Int(window)==920 {MaxContextFlow(vivid:true).frame(width:fillX)}else{Rectangle().fill(PanelStyle.blue).frame(width:fillX)}
                    if !windowOnly{Rectangle().fill(PanelStyle.headroom.opacity(0.8)).frame(width:max(0,windowX-compactX)).offset(x:compactX)}
                    HStack {ForEach(0..<5){_ in Circle().fill(.white.opacity(0.18)).frame(width:3,height:3).frame(maxWidth:.infinity)}}.padding(.horizontal,diameter/2)
                    if !(maximumWindow==920 && Int(window)==920) {BudgetFlowParticles(intensity:(windowOnly ? window:compact)/Double(max(1,maximumWindow)),paused:reduceMotion || (!compactStyle && !active) || !enabled,reducedMotion:reduceMotion)
                        .frame(width:fillX).clipped()}
                }.frame(height:trackHeight).clipShape(Capsule())
                    .overlay(Capsule().strokeBorder(LinearGradient(colors:[.white.opacity(0.17),.white.opacity(0.035)],startPoint:.top,endPoint:.bottom),lineWidth:1).frame(height:trackHeight))
                if !windowOnly{thumb(.compact).offset(x:compactX-diameter/2).zIndex(selection == .compact ? 2:1)}
                thumb(.window).offset(x:windowX-diameter/2).zIndex(selection == .window ? 2:1)
            }
            .frame(height:compactStyle ? 24:34).frame(maxHeight:.infinity).contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance:0).onChanged {event in
                guard enabled else{return}
                if dragging==nil {
                    dragUpdates.reset();onEditingChanged(true)
                    // In tight ranges, choosing the numeric heading first also
                    // lets the user select a handle whose hit areas overlap.
                    let left=abs(event.startLocation.x-compactX),right=abs(event.startLocation.x-windowX)
                    if windowOnly{dragging = .window}
                    else if compactStyle && abs(compactX-windowX)<diameter {
                        dragging=event.startLocation.x<(compactX+windowX)/2 ? .compact:.window
                    }else{dragging=abs(left-right)<3 ? selection:(left<right ? .compact:.window)}
                    selection=dragging!;focused=true
                }
                let tokens=(max(0,min(1,(event.location.x-diameter/2)/travel))*Double(maximumWindow)).rounded()
                let target=dragging ?? selection
                if compactStyle{dragUpdates.submit{setDragValue(tokens,target:target)}}
                else{setDragValue(tokens,target:target)}
            }.onEnded {event in
                let tokens=(max(0,min(1,(event.location.x-diameter/2)/travel))*Double(maximumWindow)).rounded()
                dragUpdates.finish{setDragValue(tokens,target:dragging ?? selection)}
                dragging=nil;onEditingChanged(false)
            })
            .animation(reduceMotion || dragging != nil ? nil:.easeOut(duration:0.18),value:window)
            .animation(reduceMotion || dragging != nil ? nil:.easeOut(duration:0.18),value:compact)
        }
        .frame(height:compactStyle ? 28:46).opacity(enabled ? 1:0.4)
        .focusable(enabled).focusEffectDisabled().focused($focused)
        .onKeyPress(.leftArrow){guard enabled else{return .ignored};adjust(-1);return .handled}
        .onKeyPress(.rightArrow){guard enabled else{return .ignored};adjust(1);return .handled}
        .onChange(of:selection){_,_ in if enabled{focused=true}}
        .accessibilityRepresentation {
            HStack {
                if !windowOnly{Slider(value:$compact,in:1...Double(max(2,maximumCompact)),step:1).accessibilityLabel("压缩触发点").accessibilityValue("\(Int(compact))K").disabled(!enabled || maximumCompact<=1)}
                Slider(value:$window,in:2...Double(max(3,maximumWindow)),step:1).accessibilityLabel("上下文窗口上限").accessibilityValue("\(Int(window))K").disabled(!enabled || maximumWindow<=2)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for:NSApplication.didBecomeActiveNotification)){_ in active=true}
        .onReceive(NotificationCenter.default.publisher(for:NSApplication.didResignActiveNotification)){_ in active=false}
        .onAppear{active=NSApplication.shared.isActive}.onDisappear{active=false;dragUpdates.cancel()}
    }
    private func setDragValue(_ value:Double,target:BudgetThumb){
        if !windowOnly && target == .compact{compact=max(1,min(Double(maximumCompact),value))}
        else{window=max(2,min(Double(maximumWindow),value))}
    }
    private func thumb(_ target:BudgetThumb)->some View {
        Circle().fill(LinearGradient(colors:target == .compact ? (maximumWindow==920 && Int(window)==920 ? [Color(red:0.78,green:0.59,blue:1),.purple]:[Color(red:0.43,green:0.63,blue:1),PanelStyle.blue]):[.white,Color(white:0.93)],startPoint:.topLeading,endPoint:.bottomTrailing))
            .overlay(Circle().strokeBorder(LinearGradient(colors:[.white.opacity(0.95),.white.opacity(0.35),.black.opacity(0.18)],startPoint:.topLeading,endPoint:.bottomTrailing),lineWidth:1))
            .overlay(Circle().strokeBorder(.white.opacity(target == .compact ? 0.35:0.65),lineWidth:0.75).padding(2))
            .frame(width:diameter,height:diameter)
            .shadow(color:.black.opacity(dragging==target ? 0.30:0.20),radius:dragging==target ? 6:4,y:2)
            .scaleEffect(dragging==target ? 1.07:1)
    }
    private func adjust(_ delta:Double){
        if !windowOnly && selection == .compact{compact=max(1,min(Double(maximumCompact),compact+delta))}
        else{window=max(2,min(Double(maximumWindow),window+delta))}
    }
}

struct RuntimeFixControl:View {
    @ObservedObject var model:Controller
    var body:some View {
                if let fix=model.runtimeFix {
                    VStack(alignment:.leading,spacing:7){
                        Toggle("提前压缩修复",isOn:Binding(get:{model.runtimeFix?.enabled ?? false},set:{value in Task{await model.setRuntimeFix(value)}}))
                            .toggleStyle(.switch).controlSize(.small)
                            .disabled(model.changingRuntimeFix || (!fix.enabled && (!fix.available || !fix.compatible)))
                        Text(fix.message).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                        DisclosureGroup("修复说明"){
                            VStack(alignment:.leading,spacing:6){
                                Text("避免历史推理重复计数。使用独立修复版 Codex \(fix.baseVersion)，切换后需完全退出并重开 Codex。")
                                Text("社区修复 · 适用于跨轮推理；以服务器已计入历史推理为前提。")
                                Link("查看补丁",destination:URL(string:"https://github.com/coinman-dev/codex-context-accounting-fix")!)
                            }.font(.caption2).foregroundStyle(.secondary).padding(.top,5)
                        }.font(.caption2).foregroundStyle(.secondary)
                    }.padding(10).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10))
                }
    }
}

struct ContentView: View {
    @ObservedObject var model:Controller
    @State private var confirmCompact=false
    @State private var showNewChatDefaults=false
    @State private var selectedThumb:BudgetThumb = .window
    private var maxMode:Bool {model.selected?.modelMetadata?.context_ceiling==920000 && Int(model.windowK)==920}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        // Keep content below the native title bar; NavigationSplitView installs
        // an automatic toolbar/sidebar chrome inside this AppKit-hosted window.
        HSplitView {
            VStack(alignment:.leading,spacing:14){
                HStack(spacing:7){
                    Circle().fill((model.serviceAvailable && model.bridgeCount>0) ? Color.green:Color.gray).frame(width:7,height:7)
                    Text("Codex").font(.system(size:11)).foregroundStyle(.secondary)
                }
                .frame(maxWidth:.infinity,alignment:.leading)
                .accessibilityElement(children:.ignore)
                .accessibilityLabel((model.serviceAvailable && model.bridgeCount>0) ? "已连接 Codex":"等待 Codex 连接")
                .help((model.serviceAvailable && model.bridgeCount>0) ? "已连接 Codex":"等待 Codex 连接")
                ScrollView {
                    LazyVStack(spacing:4){ForEach(model.chats){chat in
                        Button {model.selectedID=chat.id} label:{
                            VStack(alignment:.leading,spacing:5){Text(chat.title).font(.system(size:13,weight:.medium)).lineLimit(1).truncationMode(.middle);Text(chat.connected ? phaseName(chat.phase):"尚未接入").font(.system(size:11)).foregroundStyle(.secondary)}
                                .frame(maxWidth:.infinity,alignment:.leading).padding(12)
                                .background(model.selectedID==chat.id ? Color.white.opacity(0.08):.clear,in:RoundedRectangle(cornerRadius:12))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityAddTraits(model.selectedID==chat.id ? .isSelected:[])
                    }}
                }.frame(maxHeight:.infinity)
                Button("全局默认",systemImage:"slider.horizontal.3"){showNewChatDefaults=true}.buttonStyle(.bordered)
                Text("额外功能").font(.caption).foregroundStyle(.secondary)
                ContextExtensionControl(model:model)
                RuntimeFixControl(model:model)
                Button("打开 Codex",systemImage:"arrow.up.forward.app"){model.launchCodex()}.buttonStyle(.bordered)
            }.padding().frame(minWidth:235,idealWidth:270,maxWidth:340).background(PanelStyle.background)
            ScrollView {
                VStack(alignment:.leading,spacing:24){
                    if let chat=model.selected {
                        VStack(alignment:.leading,spacing:7){Text(chat.title).font(.system(size:20,weight:.medium)).lineLimit(2).truncationMode(.tail);Text(chat.model.map{modelDisplayName($0)} ?? "模型将在接入后识别").font(.callout).foregroundStyle(.secondary)}
                        VStack(alignment:.leading,spacing:12){
                            HStack(spacing:28){metric(chat.observedWindowTitle,formatted(chat.observedWindow));metric("最近请求用量",formatted(chat.lastUsage?.totalTokens))}
                            if let target=chat.targetWindow,let policy=chat.policy {
                                Text("已保存：可用窗口 \(formatted(target)) · 压缩阈值 \(formatted(min(policy.compact,policy.window*90/100)))\(chat.windowConfirmed ? "（窗口已确认）":"（窗口待确认）")").font(.callout).textSelection(.enabled)
                            }
                            if chat.phase=="awaiting_runtime_confirmation" {
                                Label("新预算已提交。上方仍是调整前的读回值，下一个正常请求完成后更新。",systemImage:"clock").font(.callout).foregroundStyle(.orange)
                            }
                        }
                        HStack {Spacer();ContextDetailsButton(chatID:chat.id,title:chat.title,model:model).id(chat.id)}
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
        .background(PanelStyle.background)
        .preferredColorScheme(.dark).tint(PanelStyle.blue)
        .onChange(of:model.selectedID){_,_ in model.fill()}
        .sheet(isPresented:$showNewChatDefaults){NewChatDefaultsView(model:model)}
        .confirmationDialog("请求 Codex 原生压缩？",isPresented:$confirmCompact,titleVisibility:.visible){Button("请求压缩"){Task{await model.act("compact")}};Button("取消",role:.cancel){}}message:{Text("压缩可能使用现有模型额度。压缩结果长度无法保证，完成后需要重新测量。")}
    }
    func budgetEditor()->some View {
        VStack(alignment:.leading,spacing:18){
            if maxMode {Label("MAX CONTEXT · 920K",systemImage:"bolt.fill").font(.callout.weight(.semibold)).foregroundStyle(.secondary)}
            rangeEditor()
            Text(model.selected?.modelMetadata?.context_ceiling != nil ? "920K 硬上限 · 最晚 904K 压缩 · 预留至少 16K" : "将蓝色压缩点往左拉，灰色压缩窗口余量随之增加。每步 1K，应用后生效。")
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
                VStack(spacing:5){Text("\(Int(max(0,model.windowK-model.compactK)))K").font(.system(size:22,weight:.medium,design:.rounded)).monospacedDigit().foregroundStyle(PanelStyle.headroom);Text("压缩窗口余量").font(.system(size:11)).foregroundStyle(.secondary)}
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
    private var statusHighlight:StatusItemHighlight?
    private var settingsWindow:NSWindow?
    private var refreshTask:Task<Void,Never>?
    private var refreshTimer:Timer?
    private var refreshInProgress=false
    private var refreshPending=false
    private var lastServiceStart=Date.distantPast
    private var serviceStarter:Process?
    private var menuPanel:ContextMenuPanel?
    private var localMenuMonitor:Any?
    private var globalMenuMonitor:Any?
    private var lastIconPercentage:Int?
    private var iconInitialized=false
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
        let item=NSStatusBar.system.statusItem(withLength:30)
        item.button?.title=""
        item.button?.imagePosition = .imageOnly
        item.button?.setButtonType(.pushOnPushOff)
        item.button?.target=self;item.button?.action=#selector(toggleContextPopover)
        statusItem=item
        if let button=item.button{statusHighlight=StatusItemHighlight(button:button,isOpen:{[weak self] in self?.menuPanel?.isVisible==true})}
        updateStatusIcon()
        if !background{showSettings()}
        publishStatus()
        refreshNow()
    }
    private func refreshNow(){
        refreshTimer?.invalidate();refreshTimer=nil
        if refreshInProgress{refreshPending=true;return}
        refreshInProgress=true
        refreshTask=Task{[weak self] in
            guard let self else{return}
            await model.refresh()
            guard !Task.isCancelled else{refreshInProgress=false;return}
            updateStatusIcon()
            if menuPanel?.isVisible==true,!model.menuDragInProgress,NSEvent.pressedMouseButtons==0{positionContextMenu()}
            publishStatus()
            if !model.serviceAvailable && Date().timeIntervalSince(lastServiceStart)>=15{startLocalService()}
            refreshInProgress=false
            if refreshPending{refreshPending=false;refreshNow();return}
            let visible=settingsWindow.map{$0.isVisible && !$0.isMiniaturized && $0.occlusionState.contains(.visible)} ?? false
            let delay=RefreshSchedule.interval(menuVisible:menuPanel?.isVisible==true,settingsVisible:visible,runningChats:model.runningChats.count,connected:model.bridgeCount>0,serviceAvailable:model.serviceAvailable)
            let timer=Timer(timeInterval:delay,repeats:false){[weak self] _ in Task{@MainActor [weak self] in self?.refreshNow()}}
            timer.tolerance=RefreshSchedule.tolerance(for:delay);refreshTimer=timer;RunLoop.main.add(timer,forMode:.common)
        }
    }
    func applicationDidBecomeActive(_ notification:Notification){refreshNow()}
    private func updateStatusIcon(){
        statusHighlight?.refresh()
        let busiest=model.busiestContext
        let percentage=busiest?.contextFraction.map{Int(($0*100).rounded())}
        if !iconInitialized || percentage != lastIconPercentage {
            statusItem?.button?.image=managerStatusImage(progress:busiest?.contextFraction)
            lastIconPercentage=percentage;iconInitialized=true
        }
        let summary=model.runningChats.isEmpty ? (model.serviceAvailable ? "暂无运行中的聊天":"等待连接") : "\(model.runningChats.count) 个运行中 · \(busiest.map{"最高占用 \($0.contextPercentage)"} ?? "等待用量读回")"
        statusItem?.button?.toolTip="Context Manager · \(summary)"
        statusItem?.button?.setAccessibilityLabel("Context Manager，\(summary)，打开聊天概览")
    }
    @objc private func toggleContextPopover(){
        refreshNow()
        if menuPanel?.isVisible==true{closeContextMenu();return}
        guard statusItem?.button != nil else{return}
        if menuPanel==nil{
            let panel=ContextMenuPanel(contentRect:.zero,styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
            panel.isReleasedWhenClosed=false;panel.isFloatingPanel=true;panel.hidesOnDeactivate=false;panel.delegate=self
            panel.level = .popUpMenu;panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
            panel.backgroundColor = .clear;panel.isOpaque=false;panel.hasShadow=true;panel.animationBehavior = .none
            menuPanel=panel
        }
        let backdrop=NSVisualEffectView();backdrop.material = .popover;backdrop.blendingMode = .behindWindow;backdrop.state = .active
        backdrop.wantsLayer=true;backdrop.layer?.cornerRadius=12;backdrop.layer?.masksToBounds=true
        let host=NSHostingView(rootView:ContextMenuView(model:model,openChat:{[weak self] id in
            guard let self else{return};self.model.selectedID=id;self.model.fill();self.showSettings()
        },openSettings:{[weak self] in self?.showSettings()},quit:{[weak self] in self?.quitEntry()}))
        host.sizingOptions=[]
        host.translatesAutoresizingMaskIntoConstraints=false;backdrop.addSubview(host)
        NSLayoutConstraint.activate([host.leadingAnchor.constraint(equalTo:backdrop.leadingAnchor),host.trailingAnchor.constraint(equalTo:backdrop.trailingAnchor),host.topAnchor.constraint(equalTo:backdrop.topAnchor),host.bottomAnchor.constraint(equalTo:backdrop.bottomAnchor)])
        menuPanel?.contentView=backdrop;positionContextMenu();menuPanel?.orderFrontRegardless();menuPanel?.makeKey()
        statusHighlight?.refresh()
        localMenuMonitor=NSEvent.addLocalMonitorForEvents(matching:[.leftMouseDown,.rightMouseDown,.keyDown]){[weak self] event in
            guard let self,self.menuPanel?.isVisible==true else{return event}
            if event.type == .keyDown{if event.keyCode==53{self.closeContextMenu();return nil};return event}
            if event.window !== self.menuPanel && event.window !== self.statusItem?.button?.window{self.closeContextMenu()}
            return event
        }
        globalMenuMonitor=NSEvent.addGlobalMonitorForEvents(matching:[.leftMouseDown,.rightMouseDown]){[weak self] _ in Task{@MainActor in
            guard let self else{return}
            if let button=self.statusItem?.button,let window=button.window,window.convertToScreen(button.convert(button.bounds,to:nil)).contains(NSEvent.mouseLocation){return}
            self.closeContextMenu()
        }}
    }
    private func positionContextMenu(){
        guard let button=statusItem?.button,let window=button.window,let screen=window.screen ?? NSScreen.main else{return}
        let anchor=window.convertToScreen(button.convert(button.bounds,to:nil))
        let heightLimit=max(1,min(560,min(anchor.minY-4,screen.visibleFrame.maxY-8)-screen.visibleFrame.minY-8))
        if model.menuHeightLimit != heightLimit{model.menuHeightLimit=heightLimit}
        let frame=ContextMenuPlacement.frame(anchor:anchor,size:NSSize(width:400,height:model.contextMenuHeight),screen:screen.visibleFrame)
        if menuPanel?.frame != frame{menuPanel?.setFrame(frame,display:true)}
    }
    private func closeContextMenu(){
        model.menuDragInProgress=false
        menuPanel?.orderOut(nil);menuPanel?.contentView=nil
        statusHighlight?.refresh()
        if let localMenuMonitor{NSEvent.removeMonitor(localMenuMonitor);self.localMenuMonitor=nil}
        if let globalMenuMonitor{NSEvent.removeMonitor(globalMenuMonitor);self.globalMenuMonitor=nil}
    }
    private func startLocalService(){
        lastServiceStart=Date()
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
        appMenu.addItem(withTitle:"打开主窗口",action:#selector(showSettings),keyEquivalent:"m").target=self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:"退出 Context Manager",action:#selector(quitEntry),keyEquivalent:"q").target=self
        appItem.submenu=appMenu;bar.addItem(appItem)
        let editItem=NSMenuItem(title:"编辑",action:nil,keyEquivalent:""),edit=NSMenu(title:"编辑")
        for (title,action,key) in [("撤销","undo:","z"),("重做","redo:","Z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{edit.addItem(withTitle:title,action:Selector(action),keyEquivalent:key)}
        editItem.submenu=edit;bar.addItem(editItem);NSApplication.shared.mainMenu=bar
    }
    @objc private func showSettings(){
        closeContextMenu()
        if settingsWindow==nil{
            let window=NSWindow(contentRect:NSRect(x:0,y:0,width:1040,height:760),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
            window.title="Context Manager";window.minSize=NSSize(width:960,height:700)
            window.titleVisibility = .visible;window.titlebarAppearsTransparent=false
            window.appearance=NSAppearance(named:.darkAqua)
            window.backgroundColor=NSColor(white:0.095,alpha:1)
            window.contentView=NSHostingView(rootView:ContentView(model:model))
            window.isReleasedWhenClosed=false;window.delegate=self;window.center();window.setFrameAutosaveName("ContextControlSettings")
            settingsWindow=window
        }
        settingsWindow?.deminiaturize(nil);settingsWindow?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps:true);publishStatus();refreshNow()
    }
    @objc private func openCodex(){model.launchCodex()}
    @objc private func quitEntry(){NSApplication.shared.terminate(nil)}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows:Bool)->Bool{showSettings();return false}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{false}
    func windowWillClose(_ notification:Notification){publishStatus(windowVisible:false)}
    func windowDidResignKey(_ notification:Notification){
        guard notification.object as? NSWindow === menuPanel else{return}
        DispatchQueue.main.async{[weak self] in if self?.menuPanel?.isKeyWindow==false{self?.closeContextMenu()}}
    }
    private func publishStatus(windowVisible:Bool?=nil){
        let menuWindow=statusItem?.button?.window
        let frame=menuWindow?.frame ?? .zero
        let onScreen=frame.width>0 && frame.height>0 && NSScreen.screens.contains{$0.frame.intersects(frame)}
        let state:[String:Any]=["pid":ProcessInfo.processInfo.processIdentifier,"menuReady":statusItem?.isVisible==true,"menuWindowVisible":menuWindow?.isVisible==true,"menuOnScreen":onScreen,"menuFrame":["x":frame.origin.x,"y":frame.origin.y,"width":frame.width,"height":frame.height],"bundleIdentifier":Bundle.main.bundleIdentifier ?? "","windowVisible":windowVisible ?? settingsWindow?.isVisible ?? false,"bridgeCount":model.bridgeCount,"startedInBackground":background,"statusTitle":statusItem?.button?.title ?? "","runningChats":model.runningChats.count,"highestContextPercent":model.busiestContext?.contextFraction.map{Int(($0*100).rounded())} as Any? ?? NSNull()]
        guard let data=try? JSONSerialization.data(withJSONObject:state,options:.sortedKeys),data != lastStatus else{return}
        do {
            try FileManager.default.createDirectory(at:model.home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let url=model.home.appendingPathComponent("ui-status.json");try data.write(to:url,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);lastStatus=data
        }catch{}
    }
    func applicationWillTerminate(_ notification:Notification){closeContextMenu();refreshTimer?.invalidate();refreshTask?.cancel();try? FileManager.default.removeItem(at:model.home.appendingPathComponent("ui-status.json"))}
}
