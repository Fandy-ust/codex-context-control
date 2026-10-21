import SwiftUI
import AppKit

extension Chat {
    var menuEligible:Bool {ephemeral != true && canAcceptDirectInput != false && (threadSource==nil || threadSource=="user") && (connected || (lastActivityAt ?? 0)>0)}
    var isRunning:Bool {menuEligible && connected && ["active","inProgress"].contains(status ?? "")}
    // Use the runtime's observed capacity, never an unapplied slider draft.
    var contextFraction:Double? {
        guard let used=lastUsage?.totalTokens,used>=0,let capacity=displayedContextWindow,capacity>0 else{return nil}
        return Double(used)/Double(capacity)
    }
    var contextPercentage:String {contextFraction.map{String(format:"%.0f%%",$0*100)} ?? "—"}
}

extension Controller {
    var runningChats:[Chat] {serviceAvailable ? chats.filter(\.isRunning):[]}
    var recentChats:[Chat] {Array(chats.filter{$0.menuEligible && ($0.lastActivityAt ?? 0)>0 && (!serviceAvailable || !$0.isRunning)}.prefix(5))}
    var busiestContext:Chat? {runningChats.filter{$0.freshUsage==true && $0.contextFraction != nil}.max{($0.contextFraction ?? 0)<($1.contextFraction ?? 0)}}
    var contextMenuHeight:CGFloat {min(menuHeightLimit,max(300,CGFloat(runningChats.count+recentChats.count)*52+295))}
}

@MainActor func managerStatusImage(progress:Double?)->NSImage {
    let image=NSImage(size:NSSize(width:22,height:22))
    image.lockFocus()
    let track=NSBezierPath(ovalIn:NSRect(x:1.5,y:1.5,width:19,height:19))
    track.lineWidth=1.7;NSColor.black.withAlphaComponent(0.25).setStroke();track.stroke()
    if let progress,progress>0 {
        let arc=NSBezierPath();arc.lineWidth=1.7;arc.lineCapStyle = .round
        arc.appendArc(withCenter:NSPoint(x:11,y:11),radius:9.5,startAngle:90,endAngle:90-min(1,progress)*360,clockwise:true)
        NSColor.black.setStroke();arc.stroke()
    }
    // Monochrome menu-bar version of Assets/ContextManager: ring + three bars.
    // Keep the outer ring live; an idle icon must not imply a fictional usage.
    NSColor.black.setFill()
    for (y,width) in [(13.4,7.2),(10.3,8.6),(7.2,10.0)] {
        NSBezierPath(roundedRect:NSRect(x:7,y:y,width:width,height:1.5),xRadius:0.75,yRadius:0.75).fill()
    }
    image.unlockFocus();image.isTemplate=true;image.accessibilityDescription="Context Manager"
    return image
}

struct ContextUsageRing:View {
    let fraction:Double?;let stale:Bool
    private var color:Color {stale ? .gray:(fraction ?? 0)>=0.95 ? .orange:(fraction ?? 0)>=0.8 ? .yellow:.blue}
    var body:some View {
        ZStack {
            Circle().stroke(.primary.opacity(0.10),lineWidth:2)
            if let fraction {Circle().trim(from:0,to:max(0,min(1,fraction))).stroke(color,style:StrokeStyle(lineWidth:2,lineCap:.round)).rotationEffect(.degrees(-90))}
            Text(fraction.map{String(format:"%.0f%%",$0*100)} ?? "—")
                .font(.system(size:8.5,weight:.semibold,design:.rounded)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7).padding(3)
        }.frame(width:28,height:28).accessibilityHidden(true)
    }
}

private struct MenuRowFrames:PreferenceKey {
    static let defaultValue:[String:CGRect]=[:]
    static func reduce(value:inout [String:CGRect],nextValue:()->[String:CGRect]){value.merge(nextValue(),uniquingKeysWith:{$1})}
}

@MainActor struct ContextMenuView:View {
    @ObservedObject var model:Controller
    let openChat:(String)->Void
    let openSettings:()->Void
    let quit:()->Void
    @State private var editingChatID:String?
    @State private var hoverSelection=MenuHoverSelection()
    @State private var heldRunning:[String]=[]
    @State private var heldRecent:[String]=[]
    private var running:[Chat] {editingChatID == nil ? model.runningChats:heldRunning.compactMap{id in model.chats.first{$0.id==id && $0.menuEligible}}}
    private var recent:[Chat] {editingChatID == nil ? model.recentChats:heldRecent.compactMap{id in model.chats.first{$0.id==id && $0.menuEligible}}}
    var body:some View {
        VStack(alignment:.leading,spacing:8){
            Button(action:openSettings){
                HStack{Text(L("打开主窗口"));Spacer();Text(model.globalShortcutEnabled ? model.globalShortcut.replacingOccurrences(of:"Control",with:"Ctrl").replacingOccurrences(of:"Shift",with:"⇧").replacingOccurrences(of:"Alt",with:"⌥").replacingOccurrences(of:"Command",with:"⌘").replacingOccurrences(of:"+",with:" ") : "").foregroundStyle(.tertiary)}
                    .font(.system(size:13)).padding(.horizontal,10).padding(.vertical,7).contentShape(Rectangle())
            }.buttonStyle(ContextMenuButtonStyle())
            AccountQuotaSection(model:model)
            Divider().padding(.horizontal,8)
            ScrollView {
                VStack(alignment:.leading,spacing:2){
                    sectionLabel(L("正在运行"),count:running.count)
                    if running.isEmpty {
                        Text(model.serviceAvailable ? L("暂无运行中的聊天"):L("正在连接控制服务…")).font(.system(size:12)).foregroundStyle(.secondary).padding(10)
                    }
                    ForEach(running){chat in chatRow(chat)}
                    if !recent.isEmpty {
                        Divider().padding(.horizontal,8).padding(.vertical,6)
                        sectionLabel(L("近期聊天"),count:recent.count)
                        ForEach(recent){chat in chatRow(chat)}
                    }
                }
                .softScrollEdges(28)
            }.scrollIndicators(.automatic)
            .coordinateSpace(name:"contextMenuRows")
            .onPreferenceChange(MenuRowFrames.self){frames in
                hoverSelection.updateFrames(frames);syncSelection()
            }
            .onContinuousHover(coordinateSpace:.named("contextMenuRows")){phase in
                switch phase {
                case .active(let point):pointerMoved(to:point)
                case .ended:pointerMoved(to:nil)
                }
            }
            Divider().padding(.horizontal,8)
            HStack(spacing:6){
                Circle().fill(model.serviceAvailable && model.bridgeCount>0 ? Color.green:Color.gray).frame(width:6,height:6)
                Text("Context Manager")
                Spacer()
                Button(L("退出"),action:quit).buttonStyle(.plain).help(L("退出菜单栏入口"))
            }.font(.system(size:11)).foregroundStyle(.secondary).padding(.horizontal,10).padding(.vertical,4)
        }.padding(8).frame(width:400,height:model.contextMenuHeight)
    }
    private func sectionLabel(_ title:String,count:Int)->some View {
        HStack{Text(title);Spacer();Text("\(count)").monospacedDigit()}.font(.system(size:10,weight:.medium)).foregroundStyle(.secondary).padding(.horizontal,10).padding(.vertical,4)
    }
    private func pointerMoved(to point:CGPoint?){
        hoverSelection.move(to:point);syncSelection()
    }
    private func syncSelection(){
        let next=hoverSelection.activeID
        guard editingChatID != next else{return}
        if editingChatID==nil,next != nil{
            heldRunning=model.runningChats.map(\.id);heldRecent=model.recentChats.map(\.id)
        }
        editingChatID=next
    }
    private func chatRow(_ chat:Chat)->some View {
        MenuChatRow(model:model,serviceAvailable:model.serviceAvailable,chat:chat,isEditing:editingChatID==chat.id,openChat:openChat,dragChanged:{active in
            hoverSelection.setDragging(chat.id,active:active)
            model.menuDragInProgress=hoverSelection.draggingID != nil
            syncSelection()
        })
        .background(GeometryReader{geometry in
            Color.clear.preference(key:MenuRowFrames.self,value:[chat.id:geometry.frame(in:.named("contextMenuRows"))])
        })
    }
}

private struct ResponseSpeedTrend:Shape {
    let samples:[Double?]
    func path(in rect:CGRect)->Path {
        let values=Array(samples.suffix(16)),valid=values.compactMap{$0}.filter{$0.isFinite && $0>=0}
        guard valid.count>=2,let low=valid.min(),let high=valid.max() else{return Path()}
        var path=Path(),drawing=false
        for (index,sample) in values.enumerated(){
            guard let value=sample,value.isFinite,value>=0 else{drawing=false;continue}
            let x=rect.minX+1+CGFloat(index)/CGFloat(max(1,values.count-1))*(rect.width-2)
            let y=high>low ? rect.maxY-1-CGFloat((value-low)/(high-low))*(rect.height-2):rect.midY
            let point=CGPoint(x:x,y:y)
            if drawing{path.addLine(to:point)}else{path.move(to:point)};drawing=true
        }
        return path
    }
}

@MainActor private struct MenuChatRow:View {
    let model:Controller
    let serviceAvailable:Bool
    let chat:Chat;let isEditing:Bool;let openChat:(String)->Void;let dragChanged:(Bool)->Void
    @State private var draft:MenuBudgetDraft?
    @State private var selection:BudgetThumb = .window
    @State private var dragging=false
    @State private var saving=false
    @State private var feedback:String?
    @State private var failed=false
    private var stale:Bool {!serviceAvailable || !chat.connected || chat.freshUsage != true}
    private var speedText:String {
        guard let rate=chat.responseSpeed?.tokensPerSecond,rate.isFinite,rate>=0 else{return "— tok/s"}
        let rounded=(rate*10).rounded(.down)/10
        let value=rounded.formatted(.number.precision(.fractionLength(0...1)))
        return value+" tok/s"
    }
    var body:some View {
        ZStack {
            if let draft {
                Button{openChat(chat.id)}label:{Color.clear.contentShape(Rectangle())}
                    .buttonStyle(.plain).accessibilityLabel(L("打开 {0} 的主面板", chat.title))
                editor(draft)
            }else{information}
        }.frame(height:50).contentShape(Rectangle())
            .background(.primary.opacity(isEditing || draft != nil ? 0.06:0),in:RoundedRectangle(cornerRadius:5))
            .onChange(of:isEditing,initial:true){_,active in if active{begin()}else{finishIfOutside()}}
            .onChange(of:serviceAvailable){_,_ in if isEditing{begin()}}
            .onChange(of:chat.modelMetadata){_,_ in cancel();if isEditing{begin()}}
            .onChange(of:chat.policy){_,_ in if isEditing && !dragging && !saving && draft?.edited != true{draft=try? MenuBudgetDraft(chat:chat)}}
            .onChange(of:saving){_,busy in if !busy && isEditing{begin()}}
            .accessibilityAction(named:L("调节预算")){begin()}
            .onDisappear{if dragging{dragChanged(false)}}
    }
    private var speedColor:Color {
        guard let rate=chat.responseSpeed?.tokensPerSecond,rate.isFinite,rate>=0 else{return .secondary}
        return rate>=40 ? .green:rate>=30 ? .yellow:.red
    }
    private func speedView(compact:Bool=false)->some View {
        HStack(spacing:4){
            Text(speedText).font(.system(size:compact ? 9:10)).monospacedDigit().foregroundStyle(speedColor)
            let direction=chat.responseSpeed?.direction
            Image(systemName:direction=="down" ? "arrow.down":"arrow.up").font(.system(size:9,weight:.semibold)).foregroundStyle(direction=="down" ? Color.red:Color.green).opacity(direction=="up" || direction=="down" ? 1:0).frame(width:8).accessibilityHidden(true)
            if let samples=chat.responseSpeed?.samples,samples.compactMap({$0}).count>=2 {
                ResponseSpeedTrend(samples:samples).stroke(Color(red:0.55,green:0.68,blue:0.85),style:StrokeStyle(lineWidth:1.25,lineCap:.round,lineJoin:.round)).frame(width:compact ? 38:52,height:14).accessibilityHidden(true)
            }
        }
    }
    private var information:some View {
        Button{openChat(chat.id)} label:{
            HStack(spacing:10){
                VStack(alignment:.leading,spacing:3){
                    Text(chat.title).font(.system(size:14,weight:.medium)).lineLimit(1).truncationMode(.middle)
                    if chat.isRunning {speedView()}
                }.frame(maxWidth:.infinity,alignment:.leading)
                VStack(alignment:.trailing,spacing:3){
                    ContextUsageRing(fraction:chat.contextFraction,stale:stale)
                    Text(chat.contextFraction != nil ? "\(shortTokens(chat.lastUsage?.totalTokens)) / \(shortTokens(chat.displayedContextWindow))\(stale ? L(" · 上次"):"")":L("尚无用量"))
                        .font(.system(size:9)).foregroundStyle(.secondary)
                }.monospacedDigit().frame(width:100,alignment:.trailing)
            }.padding(.horizontal,10).contentShape(Rectangle())
        }.buttonStyle(.plain).help(L("{0} · {1}；悬停调节预算，点击打开设置", chat.title, chat.contextPercentage))
            .accessibilityLabel(L("{0}，上下文 {1}{2}，打开设置", chat.title, chat.contextPercentage, stale ? L("，上次读回"):""))
    }
    private func editor(_ value:MenuBudgetDraft)->some View {
        VStack(spacing:0){
            HStack(spacing:8){
                if let feedback {Text(L(feedback)).font(.system(size:10)).foregroundStyle(failed ? .orange:.secondary).lineLimit(1).help(L(feedback)).allowsHitTesting(false)}
                else {
                    if let actual=chat.displayedContextWindow,actual/1000 != Int(value.windowK){Text(L("目标 {0}K · {1} {2}K", Int(value.windowK), stale ? L("上次"):L("实际"), actual/1000)).allowsHitTesting(false)}else{Text(Int(value.windowK)==value.maximumWindowK ? "MAX" : L("上下文 {0}K", Int(value.windowK))).allowsHitTesting(false)}
                }
                Spacer(minLength:2)
                if chat.isRunning {speedView(compact:true)}
                if saving{ProgressView().controlSize(.mini).frame(width:28)}
                else{Button{Task{await apply()}}label:{Text(L("应用")).font(.system(size:11,weight:.semibold)).foregroundStyle(.white).frame(width:78,height:22).background(Color.accentColor.opacity(value.changed && serviceAvailable ? 1:0.35),in:RoundedRectangle(cornerRadius:5)).contentShape(Rectangle())}.foregroundStyle(.blue).disabled(!value.changed || !serviceAvailable)}
            }.buttonStyle(.plain).font(.system(size:11,weight:.medium)).monospacedDigit().frame(height:20)
            BudgetRangeSlider(window:Binding(get:{draft?.windowK ?? value.windowK},set:{if draft?.windowK != $0{draft?.setWindow($0);feedback=nil}}),compact:.constant(value.compactK),selection:$selection,maximumWindow:value.maximumWindowK,maximumCompact:value.maximumCompactK,compactStyle:true,windowOnly:true,onEditingChanged:{active in dragging=active;dragChanged(active)})
                .disabled(saving || !serviceAvailable)
        }.padding(.horizontal,10).help(feedback ?? chat.title)
    }
    private func begin(){
        guard draft==nil,!saving,serviceAvailable,let value=try? MenuBudgetDraft(chat:chat) else{return}
        draft=value;feedback=nil;failed=false
    }
    private func finishIfOutside(){if !isEditing && !dragging{cancel()}}
    private func cancel(){draft=nil;feedback=nil;failed=false}
    private func apply() async {
        guard let value=draft,!saving else{return};saving=true;failed=false
        do {
            guard let current=model.chats.first(where:{$0.id==value.chatID}),current.model==value.model,
                  current.modelMetadata?.effective_context_window_percent==value.effectivePercent,
                  current.modelMetadata?.max_context_window==value.maximumRawWindow else{throw BudgetInputError(message:L("模型信息已变化，请重新调整"))}
            var command:[String:Any]=["id":value.chatID,"apply":true,"expectedRevision":value.revision]
            command.merge(model.policyCommand(try value.policy(),usableWindow:Int(value.windowK)*1000),uniquingKeysWith:{$1})
            let data=try await model.api(ControlAPI.policy,body:command)
            let result=try JSONSerialization.jsonObject(with:data) as? [String:Any]
            let code=(result?["plan"] as? [String:Any])?["code"] as? String
            switch code {
            case "waiting_for_idle":feedback=L("已保存 · 本轮结束后应用")
            case "needs_compaction":feedback=L("已保存 · 需先压缩再应用");failed=true
            case "needs_observation":feedback=L("已保存 · 等待用量读回")
            default:feedback=L("已提交 · 等待读回确认")
            }
            if let raw=result?["thread"],let data=try? JSONSerialization.data(withJSONObject:raw),let updated=try? JSONDecoder().decode(Chat.self,from:data){
                draft=try? MenuBudgetDraft(chat:updated)
                if !model.menuDragInProgress,let index=model.chats.firstIndex(where:{$0.id==updated.id}),model.chats[index] != updated{model.chats[index]=updated}
                if !updated.connected{feedback=L("已保存 · 接入后自动应用")}
            }
            await model.refresh()
        }catch{feedback=error.localizedDescription;failed=true}
        saving=false;finishIfOutside()
    }
    private func shortTokens(_ value:Int?)->String {value.map{String(format:"%.0fK",Double($0)/1000)} ?? "—"}
}

private struct ContextMenuButtonStyle:ButtonStyle {
    func makeBody(configuration:Configuration)->some View {
        MenuRowHighlight(content:configuration.label,pressed:configuration.isPressed)
    }
    private struct MenuRowHighlight<Content:View>:View {
        let content:Content;let pressed:Bool
        @State private var hovering=false
        var body:some View {
            content.foregroundStyle(.primary)
                .background(.primary.opacity(pressed ? 0.16:hovering ? 0.09:0),in:RoundedRectangle(cornerRadius:5))
                .onHover{hovering=$0}
        }
    }
}
