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
        if windowConfirmed{return L("已确认可用窗口")}
        if !connected || freshUsage != true{return L("上次读回窗口（待更新）")}
        return phase=="mismatch" ? L("运行时读回窗口（与目标不符）"):L("最近读回窗口")
    }
}
struct RuntimeFixState:Decodable,Equatable {let enabled:Bool;let available:Bool;let compatible:Bool;let baseVersion:String;let originalVersion:String?;let activeCount:Int;let pending:Bool;let message:String}
struct NewChatDefaultsState:Decodable,Equatable {let usableWindow:Int;let compact:Int;let revision:Int}
struct ContextExtensionState:Decodable,Equatable {let enabled:Bool;let effective:Bool;let pending:Bool;let activeCount:Int;let connectedCount:Int;let compatible:Bool;let available:Bool;let message:String}
struct NewChatDefaultsLimits:Decodable,Equatable {let maximumUsableWindow:Int;let effectivePercent:Int;let extended:Bool}
struct UpdateState:Decodable,Equatable {let currentVersion:String;let available:Bool;let version:String?;let phase:String;let error:String?;let retryAt:Int?}
struct QuotaWindow:Decodable,Equatable {let usedPercent:Double;let remainingPercent:Double;let windowDurationMins:Int?;let resetsAt:Int?}
struct QuotaBucket:Decodable,Equatable,Identifiable {let id:String;let name:String;let primary:QuotaWindow?;let secondary:QuotaWindow?;let hasCredits:Bool?;let unlimitedCredits:Bool?;let creditBalance:String?}
struct CreditBaseline:Decodable,Equatable {let last:Double;let baseline:Double}
struct QuotaState:Decodable,Equatable {let creditBaselines:[String:CreditBaseline?]?;let buckets:[QuotaBucket];let updatedAt:Int?;let loading:Bool;let stale:Bool;let error:String?}
struct ControlCapabilities:Decodable {let visibleBudget:Bool?;let quotaAnalytics:Bool?;let creditBaseline:Bool?}
struct SidebarProject:Decodable,Equatable,Identifiable {let id:String;let name:String;let roots:[String];let threadIds:[String]}
struct ChatSidebar:Decodable,Equatable {let projects:[SidebarProject];let standaloneThreadIds:[String]}
struct RuntimeState: Decodable {let apiVersion:Int?;let capabilities:ControlCapabilities?;let quota:QuotaState?;let update:UpdateState?;let version:String;let bridgeCount:Int;let threads:[Chat];let sidebar:ChatSidebar?;let runtimeFix:RuntimeFixState?;let contextCeilingPending:Bool?;let newChatDefaults:NewChatDefaultsState?;let newChatDefaultsPending:Bool?;let contextExtension:ContextExtensionState?;let newChatDefaultsLimits:NewChatDefaultsLimits?}
struct Connection: Decodable {let port:Int;let token:String}
struct DesktopSettings: Decodable {let desktopExecutable:String}
struct ServiceSettings: Decodable {let node:String}

@MainActor final class Controller: ObservableObject {
    @Published var languageSelection=Localization.choice
    @Published var languageRevision=0
    private var languageObservers:[NSObjectProtocol]=[]
    init(){
        for name in [Localization.didChange,Notification.Name.NSSystemTimeZoneDidChange] {
            languageObservers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in
                Task{@MainActor [weak self] in self?.languageSelection=Localization.choice;self?.languageRevision+=1}
            })
        }
    }
    deinit{for observer in languageObservers{NotificationCenter.default.removeObserver(observer)}}
    func setLanguage(_ value:LanguageChoice){do{try Localization.setChoice(value)}catch{notice=L("无法保存语言设置：{0}",error.localizedDescription)}}
    @Published var chats:[Chat]=[]
    @Published var sidebar:ChatSidebar?
    @Published var selectedID:String?
    @Published var showQuotaAnalytics=false
    @Published var supportsQuotaAnalytics=false
    @Published var appVersion=Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "—"
    @Published var updateState:UpdateState?
    @Published var checkingUpdates=false
    @Published var quota:QuotaState?
    @Published var quotaRefreshing=false
    @Published var selectedQuotaID="codex"
    var selectedQuota:QuotaBucket? {quota?.buckets.first{$0.id==selectedQuotaID} ?? quota?.buckets.first}
    var selectedCreditBaseline:CreditBaseline? {guard let id=selectedQuota?.id,let entries=quota?.creditBaselines,let value=entries[id] else{return nil};return value}
    @Published var supportsVisibleBudget=false
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
    @Published var notice=L("正在读取本地状态…")
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
        request.timeoutInterval=route==ControlAPI.quotaAnalytics ? 60:30
        if let body {request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:body)}
        let (data,response)=try await URLSession.shared.data(for:request)
        guard (response as? HTTPURLResponse)?.statusCode==200 else {
            let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
            throw NSError(domain:"ContextControl",code:1,userInfo:[NSLocalizedDescriptionKey:L(object?["error"] as? String ?? "本地服务暂时不可用")])
        }
        return data
    }
    func refresh() async {
        if refreshing || menuDragInProgress{return};refreshing=true;defer{refreshing=false}
        do {let state=try JSONDecoder().decode(RuntimeState.self,from:await api(ControlAPI.state))
            guard !menuDragInProgress else{return}
            supportsVisibleBudget=state.capabilities?.visibleBudget == true;supportsQuotaAnalytics=state.capabilities?.quotaAnalytics == true;appVersion=state.version
            if quota != state.quota{acceptQuota(state.quota)}
            if updateState != state.update{updateState=state.update;if updateState?.phase=="installed"{notice=L("更新已安装，请重开 Codex")}else if updateState?.phase=="error",let error=updateState?.error{notice=L("更新失败：{0}",error)}}
            if chats != state.threads{chats=state.threads}
            if sidebar != state.sidebar{sidebar=state.sidebar}
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
            if Localization.canonical(notice)=="正在读取本地状态…"||Localization.canonical(notice).hasPrefix("读取失败："){notice=bridgeCount>0 ? L("已接入 Codex。") : L("已加载本地聊天；打开聊天后实时同步。")}
        }catch{serviceAvailable=false;notice=L("读取失败：{0}", error.localizedDescription)}
    }
    func acceptQuota(_ value:QuotaState?){
        quota=value
        if value?.buckets.contains(where:{$0.id==selectedQuotaID}) != true,let first=value?.buckets.first{selectedQuotaID=first.id}
    }
    func resetCredits() async {
        guard let id=selectedQuota?.id else{return};quotaRefreshing=true;defer{quotaRefreshing=false}
        do{acceptQuota(try JSONDecoder().decode(QuotaState.self,from:await api(ControlAPI.quotaCreditBaseline,body:["id":id])));notice=L("Credits 基准已重置")}catch{notice=error.localizedDescription}
    }
    func refreshQuota() async {
        guard !quotaRefreshing else{return};quotaRefreshing=true;defer{quotaRefreshing=false}
        do{acceptQuota(try JSONDecoder().decode(QuotaState.self,from:await api(ControlAPI.quotaRefresh,body:[:])))}catch{notice=L("暂时无法读取额度")}
    }
    func updateApp(install:Bool=false) async {
        checkingUpdates=true;defer{checkingUpdates=false}
        do{updateState=try JSONDecoder().decode(UpdateState.self,from:await api(install ? ControlAPI.installUpdate:ControlAPI.checkUpdate,body:[:]));if let error=updateState?.error{notice=error}else{notice=install ? L("正在下载更新，安装后请重开 Codex"):L(updateState?.available == true ? "发现新版本":"已是最新版本")}}catch{notice=error.localizedDescription}
    }
    func scanChats() async {
        working=true;defer{working=false}
        do{_ = try await api(ControlAPI.scan,body:[:]);await refresh();notice=L("本地聊天已更新")}catch{notice=error.localizedDescription}
    }
    func setContextExtension(_ enabled:Bool) async {
        changingContextExtension=true;defer{changingContextExtension=false}
        do{let data=try await api(ControlAPI.contextExtension,body:["enabled":enabled]);contextExtension=try JSONDecoder().decode(ContextExtensionState.self,from:data);await refresh();fill();notice=contextExtension?.message ?? L("拓展设置已保存")}catch{notice=error.localizedDescription}
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
        guard let metadata=selected?.modelMetadata,let percent=metadata.effective_context_window_percent,let maximum=metadata.max_context_window else{throw BudgetInputError(message:L("等待当前模型信息后即可设置实际可用窗口"))}
        guard metadata.context_catalog_ready != false else{throw BudgetInputError(message:bridgeCount==0 ? L("打开 Codex 并进入聊天后即可调整"):selected?.connected == true ? L("请完整退出并重开 Codex，使上下文设置生效"):L("请先在 Codex 打开此聊天"))}
        guard !waitingForModel else{throw BudgetInputError(message:L("正在读取此聊天的窗口设置"))}
        guard Int(compactK)<=maximumCompactK else{throw BudgetInputError(message:L("压缩阈值需保留下一轮输入余量"))}
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
    func policyCommand(_ raw:[String:Any],usableWindow:Int)->[String:Any]{
        if !supportsVisibleBudget{return ["policy":raw]}
        var budget=raw;budget.removeValue(forKey:"window");budget["usableWindow"]=usableWindow
        return ["budget":budget]
    }
    func act(_ action:String) async {
        guard let chat=selected else{return};working=true;defer{working=false}
        do {
            var body:[String:Any]=["id":chat.id]
            if action=="preflight"||action=="policy"{body.merge(policyCommand(try policy,usableWindow:Int(windowK)*1000),uniquingKeysWith:{$1})}
            if action=="policy"{body["apply"]=true;body["expectedRevision"]=editingRevision}
            let data=try await api(ControlAPI.routes[action] ?? "/invalid",body:body)
            let object=try JSONSerialization.jsonObject(with:data) as? [String:Any]
            if action=="preflight"{notice=(object?["message"] as? String ?? L("预检完成"))+((object?["notes"] as? [String])?.map{"\n"+$0}.joined() ?? "")}
            else if action=="policy"{editingRevision=(object?["policy"] as? [String:Any])?["revision"] as? Int ?? editingRevision;budgetEdited=false;notice=L("预算已保存。请查看下方应用状态；实际值将在正常下一轮请求后确认。")}
            else{notice=object?["message"] as? String ?? L("操作已提交。")}
            await refresh()
        }catch{notice=error.localizedDescription}
    }
    func setRuntimeFix(_ enabled:Bool) async {
        if changingRuntimeFix{return};changingRuntimeFix=true;defer{changingRuntimeFix=false}
        do {
            runtimeFix=try JSONDecoder().decode(RuntimeFixState.self,from:await api(ControlAPI.runtimeFix,body:["enabled":enabled]))
            notice=runtimeFix?.message ?? L("设置已保存")
        }catch{notice=error.localizedDescription}
    }
    func launchCodex(){
        do {
            let settings=try JSONDecoder().decode(DesktopSettings.self,from:Data(contentsOf:home.appendingPathComponent("settings.json")))
            let app=URL(fileURLWithPath:settings.desktopExecutable).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/open");process.arguments=["-a",app.path]
            try process.run();notice=L("已请求打开 Codex；预算控制会随运行时自动接入。")
        }catch{notice=error.localizedDescription}
    }
}

func formatted(_ n:Int?) -> String {guard let n else{return L("待观测")};return n.formatted()+" tokens"}
func phaseName(_ value:String?) -> String {
    switch value {case "extension_pending":return L("等待重开 Codex");case "compacting":return L("正在保护性压缩");case "confirmed":return L("窗口已确认");case "awaiting_runtime_confirmation":return L("等待下一轮确认");case "reloading":return L("正在应用");case "waiting_for_idle","queued":return L("等待轮次结束");case "needs_compaction":return L("需要先压缩");case "needs_observation":return L("等待用量记录");case "error","mismatch":return L("需要处理");case "saved":return L("已保存");default:return L("尚未接入")}
}

enum PanelStyle {
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
                    if maximumWindow==920 && Int(window)==920 {MaxContextFlow(vivid:true,paused:(!compactStyle && !active) || !enabled).frame(width:fillX)}else{Rectangle().fill(PanelStyle.blue).frame(width:fillX)}
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
                if !windowOnly{Slider(value:$compact,in:1...Double(max(2,maximumCompact)),step:1).accessibilityLabel(L("压缩触发点")).accessibilityValue("\(Int(compact))K").disabled(!enabled || maximumCompact<=1)}
                Slider(value:$window,in:2...Double(max(3,maximumWindow)),step:1).accessibilityLabel(L("上下文窗口上限")).accessibilityValue("\(Int(window))K").disabled(!enabled || maximumWindow<=2)
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
                        Toggle(L("提前压缩修复"),isOn:Binding(get:{model.runtimeFix?.enabled ?? false},set:{value in Task{await model.setRuntimeFix(value)}}))
                            .toggleStyle(.switch).controlSize(.small)
                            .disabled(model.changingRuntimeFix || (!fix.enabled && (!fix.available || !fix.compatible)))
                        Text(L(fix.message)).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                        DisclosureGroup(L("修复说明")){
                            VStack(alignment:.leading,spacing:6){
                                Text(L("避免历史推理重复计数。使用独立修复版 Codex {0}，切换后需完全退出并重开 Codex。", fix.baseVersion))
                                Text(L("社区修复 · 适用于跨轮推理；以服务器已计入历史推理为前提。"))
                                Link(L("查看补丁"),destination:URL(string:"https://github.com/coinman-dev/codex-context-accounting-fix")!)
                            }.font(.caption2).foregroundStyle(.secondary).padding(.top,5)
                        }.font(.caption2).foregroundStyle(.secondary)
                    }.padding(10).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10))
                }
    }
}

struct ProjectChatSidebar:View {
    @ObservedObject var model:Controller
    @AppStorage("project-sidebar-expanded") private var expandedJSON="[]"
    private var expanded:Set<String> {Set((try? JSONDecoder().decode([String].self,from:Data(expandedJSON.utf8))) ?? [])}
    private var projects:[SidebarProject] {model.sidebar?.projects ?? []}
    private var recent:[Chat] {model.chats.sorted{($0.lastActivityAt ?? 0)>($1.lastActivityAt ?? 0)}}
    private func setExpanded(_ id:String,_ value:Bool){
        var ids=expanded;if value{ids.insert(id)}else{ids.remove(id)}
        if let data=try? JSONEncoder().encode(ids.sorted()),let json=String(data:data,encoding:.utf8){expandedJSON=json}
    }
    private func revealSelection(){
        guard let id=model.selectedID,let project=projects.first(where:{$0.threadIds.contains(id)}) else{return}
        if !expanded.contains(project.id){setExpanded(project.id,true)}
    }
    var body:some View {
        GeometryReader{geometry in
            VStack(alignment:.leading,spacing:0){
                projectList.frame(height:max(0,geometry.size.height-15)*0.5)
                Color.clear.frame(height:15)
                VStack(alignment:.leading,spacing:6){
                    heading("最近",count:recent.count)
                    ScrollView{LazyVStack(spacing:4){
                        if recent.isEmpty{empty("暂无最近聊天")}
                        ForEach(recent){chat in chatRow(chat)}
                    }.frame(maxWidth:.infinity,alignment:.leading).padding(.bottom,28)}
                    .overlay(alignment:.bottom){bottomFade}
                }.frame(maxHeight:.infinity)
            }
        }
        .onAppear{revealSelection()}
        .onChange(of:model.selectedID){_,_ in revealSelection()}
    }
    private var projectList:some View {
        let byID=Dictionary(model.chats.map{($0.id,$0)},uniquingKeysWith:{first,_ in first})
        return VStack(alignment:.leading,spacing:6){
            heading("项目",count:projects.count)
            ScrollView{LazyVStack(alignment:.leading,spacing:4){
                if projects.isEmpty{empty("暂无本地项目")}
                ForEach(projects){project in
                    DisclosureGroup(isExpanded:Binding(get:{expanded.contains(project.id)},set:{setExpanded(project.id,$0)})){
                        LazyVStack(spacing:4){
                            if project.threadIds.isEmpty{empty("暂无聊天")}
                            ForEach(project.threadIds.compactMap{byID[$0]}){chat in chatRow(chat)}
                        }.padding(.leading,6)
                    }label:{
                        HStack(spacing:7){
                            Image(systemName:"folder").foregroundStyle(.secondary)
                            Text(project.name).font(.system(size:12,weight:.medium)).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength:2)
                            Text("\(project.threadIds.count)").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical,7).help(project.roots.joined(separator:"\n"))
                    }.padding(.horizontal,8)
                }
            }.frame(maxWidth:.infinity,alignment:.leading).padding(.bottom,28)}
            .overlay(alignment:.bottom){bottomFade}
        }
    }
    private var bottomFade:some View {
        Rectangle().fill(.ultraThinMaterial).frame(height:28)
            .overlay(LinearGradient(colors:[.clear,PanelStyle.background],startPoint:.top,endPoint:.bottom))
            .mask(LinearGradient(colors:[.clear,.black],startPoint:.top,endPoint:.bottom))
            .allowsHitTesting(false).accessibilityHidden(true)
    }
    private func heading(_ title:String,count:Int)->some View {
        HStack{Text(L(title));Spacer();Text("\(count)")}.font(.system(size:11,weight:.medium)).foregroundStyle(.secondary).padding(.horizontal,10)
    }
    private func empty(_ title:String)->some View {
        Text(L(title)).font(.caption).foregroundStyle(.secondary).padding(10).frame(maxWidth:.infinity,alignment:.leading)
    }
    private func chatRow(_ chat:Chat)->some View {
        Button{model.selectedID=chat.id}label:{
            VStack(alignment:.leading,spacing:3){
                Text(chat.title).font(.system(size:12,weight:.medium)).lineLimit(1).truncationMode(.middle)
                HStack(spacing:10){
                    Text(model.sidebar?.projects.first(where:{$0.threadIds.contains(chat.id)})?.name ?? L("单独聊天")).lineLimit(1).truncationMode(.tail)
                    Spacer(minLength:0)
                    Text(L(chat.connected ? "已接入":"未接入")).fixedSize()
                }.font(.system(size:10)).foregroundStyle(.secondary)
            }.frame(maxWidth:.infinity,alignment:.leading).padding(.horizontal,10).padding(.vertical,8)
                .background(model.selectedID==chat.id ? Color.white.opacity(0.08):Color.white.opacity(0.015),in:RoundedRectangle(cornerRadius:12)).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityAddTraits(model.selectedID==chat.id ? .isSelected:[])
    }
}

struct ContentView: View {
    @ObservedObject var model:Controller
    @State private var showControlPanel=false
    @State private var controlTab="general"
    @State private var selectedThumb:BudgetThumb = .window
    var body: some View {
        // Keep content below the native title bar; NavigationSplitView installs
        // an automatic toolbar/sidebar chrome inside this AppKit-hosted window.
        HSplitView {
            VStack(alignment:.leading,spacing:14){
                HStack(spacing:7){
                    Circle().fill((model.serviceAvailable && model.bridgeCount>0) ? Color.green:Color.gray).frame(width:7,height:7)
                    Text("Codex").font(.system(size:11)).foregroundStyle(.secondary)
                    Spacer()
                    Button{controlTab="general";showControlPanel=true}label:{Image(systemName:"gearshape").font(.system(size:17))}.buttonStyle(.plain).help(L("设置")).accessibilityIdentifier("control-panel-button")
                    Text("v"+model.appVersion).font(.system(size:10)).foregroundStyle(.secondary)
                }
                .frame(maxWidth:.infinity,alignment:.leading)
                .accessibilityElement(children:.ignore)
                .accessibilityLabel((model.serviceAvailable && model.bridgeCount>0) ? L("已连接 Codex"):L("等待 Codex 连接"))
                .help((model.serviceAvailable && model.bridgeCount>0) ? L("已连接 Codex"):L("等待 Codex 连接"))
                ProjectChatSidebar(model:model).frame(maxHeight:.infinity)
                Button{model.showQuotaAnalytics=true}label:{Label(L("额度分析"),systemImage:"chart.xyaxis.line").font(.system(size:12)).frame(maxWidth:.infinity,alignment:.leading).padding(8).contentShape(Rectangle())}.buttonStyle(.plain).disabled(!model.supportsQuotaAnalytics)
                QuotaSidebarView(model:model,open:{controlTab="quota";showControlPanel=true})
            }.padding().frame(minWidth:310,idealWidth:340,maxWidth:380).background(PanelStyle.background)
            Group {
                if model.showQuotaAnalytics {
                    QuotaAnalyticsView(model:model,onBack:{model.showQuotaAnalytics=false})
                } else {
            ScrollView {
                VStack(alignment:.leading,spacing:24){
                    if let chat=model.selected {
                        VStack(alignment:.leading,spacing:7){Text(chat.title).font(.system(size:20,weight:.medium)).lineLimit(2).truncationMode(.tail);Text(chat.model.map{modelDisplayName($0)} ?? L("模型将在接入后识别")).font(.callout).foregroundStyle(.secondary)}
                        budgetEditor().disabled(!model.canEditBudget)
                        HStack(alignment:.center,spacing:16){
                            VStack(alignment:.leading,spacing:4){
                                Text(chat.observedWindowTitle+" · "+formatted(chat.observedWindow)).font(.callout).foregroundStyle(.secondary)
                                Text(phaseName(chat.phase)).font(.caption).foregroundStyle(.secondary).help(L(chat.message ?? ""))
                            }
                            Spacer()
                            Button(L("应用")){Task{await model.act("policy")}}.buttonStyle(ApplyButtonStyle()).disabled(model.preview==nil || model.working)
                        }
                        if let error=model.previewError{Label(error,systemImage:"exclamationmark.circle").font(.callout).foregroundStyle(.orange)}
                        if !model.notice.isEmpty{Text(L(model.notice)).font(.caption).textSelection(.enabled).foregroundStyle(.secondary)}
                        Divider()
                        ContextDetailsView(chatID:chat.id,title:chat.title,model:model).id(chat.id)
                    }else{
                        ContentUnavailableView(L("等待聊天接入"),systemImage:"bubble.left.and.bubble.right",description:Text(L("照常打开 Codex 并进入聊天，控制连接会随运行时自动启动。首次安装后请正常重开一次客户端。")))
                    }
                }.padding(32).frame(maxWidth:850,alignment:.leading).frame(maxWidth:.infinity)
            }
                }
            }.frame(minWidth:650).background(PanelStyle.background)
        }
        .frame(minWidth:960,minHeight:670)
        .background(PanelStyle.background)
        .preferredColorScheme(.dark).tint(PanelStyle.blue).environment(\.locale,Localization.locale)
        .onChange(of:model.selectedID){_,_ in model.showQuotaAnalytics=false;model.fill()}
        .sheet(isPresented:$showControlPanel){MainControlPanelView(model:model,initialTab:controlTab,close:{showControlPanel=false})}

    }
    private func budgetEditor()->some View {
        VStack(alignment:.leading,spacing:12){
            HStack {
                budgetValue(L("压缩触发"),value:model.compactK,color:PanelStyle.blue,thumb:.compact)
                Spacer()
                budgetValue(L("上下文窗口"),value:model.windowK,color:.white,thumb:.window)
                Button{model.fill()}label:{Image(systemName:"arrow.counterclockwise")}.buttonStyle(.plain).foregroundStyle(.secondary).help(L("重新载入已保存预算"))
            }
            BudgetRangeSlider(window:Binding(get:{model.windowK},set:{model.setWindowK($0)}),compact:Binding(get:{model.compactK},set:{model.setCompactK($0)}),selection:$selectedThumb,maximumWindow:model.maximumWindowK,maximumCompact:model.maximumCompactK)
            HStack{Text("0K");Spacer();Text(L("模型上限 {0}K",model.maximumWindowK))}.font(.caption2).foregroundStyle(.tertiary)
        }
    }
    private func budgetValue(_ title:String,value:Double,color:Color,thumb:BudgetThumb)->some View {
        Button{selectedThumb=thumb}label:{HStack(spacing:8){Text(title).foregroundStyle(.secondary);Text("\(Int(value))K").foregroundStyle(color).monospacedDigit()}.font(.callout)}.buttonStyle(.plain).accessibilityLabel(L("选择{0}滑块，{1}K",title,Int(value)))
    }
}

@main @MainActor final class ContextControlApp:NSObject,NSApplicationDelegate,NSWindowDelegate {
    private let model=Controller()
    private var lastQuotaIcon:QuotaState?
    private var lastQuotaID:String?
    private var lastQuotaStale:Bool?
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
    private var iconInitialized=false
    private let background=CommandLine.arguments.contains("--background")
    private var lastStatus:Data?
    private var languageObservers:[NSObjectProtocol]=[]

    static func main(){
        let app=NSApplication.shared
        let delegate=ContextControlApp();app.delegate=delegate
        app.setActivationPolicy(.accessory);app.run()
        withExtendedLifetime(delegate){}
    }
    func applicationDidFinishLaunching(_ notification:Notification){
        startLocalService()
        installMainMenu()
        for name in [Localization.didChange,Notification.Name.NSSystemTimeZoneDidChange]{
            languageObservers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in
                Task{@MainActor [weak self] in self?.installMainMenu();self?.updateStatusIcon()}
            })
        }
        let item=NSStatusBar.system.statusItem(withLength:44)
        item.button?.title=""
        item.button?.imagePosition = .imageOnly
        item.button?.imageScaling = .scaleProportionallyDown
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
        let quotaSummary=model.selectedQuota.map{bucket in [bucket.primary,bucket.secondary].compactMap{$0}.map{L("{0}剩余 {1}%",quotaPeriod($0),Int($0.remainingPercent.rounded()))}.joined(separator:" · ")} ?? L("额度暂不可用")
        let quotaStale = !model.serviceAvailable || model.quota?.stale != false
        let quotaTooltip=quotaStale ? L("上次记录，待刷新")+" · "+quotaSummary:quotaSummary
        statusHighlight?.refresh()
        let busiest=model.busiestContext
        if !iconInitialized || lastQuotaIcon != model.quota || lastQuotaID != model.selectedQuota?.id || lastQuotaStale != quotaStale {
            statusItem?.button?.image=quotaBarsStatusImage(bucket:model.selectedQuota,stale:quotaStale)
            lastQuotaIcon=model.quota;lastQuotaID=model.selectedQuota?.id;lastQuotaStale=quotaStale
            iconInitialized=true
        }
        let summary=model.runningChats.isEmpty ? (model.serviceAvailable ? L("暂无运行中的聊天"):L("等待连接")) : L("{0} 个运行中 · {1}", model.runningChats.count, busiest.map{L("最高占用 {0}", $0.contextPercentage)} ?? L("等待用量读回"))
        statusItem?.button?.toolTip=L("Codex 额度 · {0}",quotaTooltip)+"\nContext Manager · \(summary)"
        statusItem?.button?.setAccessibilityLabel(L("Codex 额度 · {0}",quotaTooltip))
    }
    @objc private func toggleContextPopover(){
        refreshNow()
        if menuPanel?.isVisible==true{closeContextMenu();return}
        guard statusItem?.button != nil else{return}
        Task{await model.refreshQuota();updateStatusIcon()}
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
        do{try process.run();serviceStarter=process}catch{model.notice=L("无法启动本地服务：{0}", error.localizedDescription)}
    }
    private func installMainMenu(){
        let bar=NSMenu(),appItem=NSMenuItem(),appMenu=NSMenu()
        appMenu.addItem(withTitle:L("打开主窗口"),action:#selector(showSettings),keyEquivalent:"m").target=self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:L("退出 Context Manager"),action:#selector(quitEntry),keyEquivalent:"q").target=self
        appItem.submenu=appMenu;bar.addItem(appItem)
        let editItem=NSMenuItem(title:L("编辑"),action:nil,keyEquivalent:""),edit=NSMenu(title:L("编辑"))
        for (title,action,key) in [(L("撤销"),"undo:","z"),(L("重做"),"redo:","Z"),(L("剪切"),"cut:","x"),(L("复制"),"copy:","c"),(L("粘贴"),"paste:","v"),(L("全选"),"selectAll:","a")]{edit.addItem(withTitle:title,action:Selector(action),keyEquivalent:key)}
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
        let state:[String:Any]=["quotaIntegrated":true,"pid":ProcessInfo.processInfo.processIdentifier,"menuReady":statusItem?.isVisible==true,"menuWindowVisible":menuWindow?.isVisible==true,"menuOnScreen":onScreen,"menuFrame":["x":frame.origin.x,"y":frame.origin.y,"width":frame.width,"height":frame.height],"bundleIdentifier":Bundle.main.bundleIdentifier ?? "","windowVisible":windowVisible ?? settingsWindow?.isVisible ?? false,"bridgeCount":model.bridgeCount,"startedInBackground":background,"statusTitle":statusItem?.button?.title ?? "","runningChats":model.runningChats.count,"highestContextPercent":model.busiestContext?.contextFraction.map{Int(($0*100).rounded())} as Any? ?? NSNull()]
        guard let data=try? JSONSerialization.data(withJSONObject:state,options:.sortedKeys),data != lastStatus else{return}
        do {
            try FileManager.default.createDirectory(at:model.home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let url=model.home.appendingPathComponent("ui-status.json");try data.write(to:url,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);lastStatus=data
        }catch{}
    }
    func applicationWillTerminate(_ notification:Notification){closeContextMenu();refreshTimer?.invalidate();refreshTask?.cancel();try? FileManager.default.removeItem(at:model.home.appendingPathComponent("ui-status.json"))}
}
