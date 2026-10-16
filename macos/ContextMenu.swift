import SwiftUI
import AppKit

extension Chat {
    var menuEligible:Bool {ephemeral != true && canAcceptDirectInput != false}
    var isRunning:Bool {menuEligible && connected && ["active","inProgress"].contains(status ?? "")}
    // Use the runtime's observed capacity, never an unapplied slider draft.
    var contextFraction:Double? {
        guard let used=lastUsage?.totalTokens,used>=0,let capacity=observedWindow,capacity>0 else{return nil}
        return Double(used)/Double(capacity)
    }
    var contextPercentage:String {contextFraction.map{String(format:"%.0f%%",$0*100)} ?? "—"}
}

extension Controller {
    var runningChats:[Chat] {serviceAvailable ? chats.filter(\.isRunning):[]}
    var recentChats:[Chat] {Array(chats.filter{$0.menuEligible && (!serviceAvailable || !$0.isRunning)}.prefix(5))}
    var busiestContext:Chat? {runningChats.filter{$0.freshUsage==true && $0.contextFraction != nil}.max{($0.contextFraction ?? 0)<($1.contextFraction ?? 0)}}
    var contextMenuHeight:CGFloat {min(menuHeightLimit,max(210,CGFloat(runningChats.count+recentChats.count)*52+175))}
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
    // Compact robot silhouette: antenna, rounded head and two clear eyes.
    NSColor.black.setStroke()
    let antenna=NSBezierPath();antenna.lineWidth=1.2;antenna.move(to:NSPoint(x:11,y:14.5));antenna.line(to:NSPoint(x:11,y:16.5));antenna.stroke()
    NSColor.black.setFill();NSBezierPath(ovalIn:NSRect(x:10.1,y:16,width:1.8,height:1.8)).fill()
    NSBezierPath(roundedRect:NSRect(x:5.7,y:6.5,width:10.6,height:8),xRadius:2.3,yRadius:2.3).fill()
    NSBezierPath(roundedRect:NSRect(x:4.2,y:9,width:1.5,height:3),xRadius:0.6,yRadius:0.6).fill()
    NSBezierPath(roundedRect:NSRect(x:16.3,y:9,width:1.5,height:3),xRadius:0.6,yRadius:0.6).fill()
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current?.compositingOperation = .copy
    NSColor.clear.setFill()
    for x in [8.0,12.0] {NSBezierPath(roundedRect:NSRect(x:x,y:10,width:2,height:2.3),xRadius:0.7,yRadius:0.7).fill()}
    NSGraphicsContext.restoreGraphicsState()
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

@MainActor struct ContextMenuView:View {
    @ObservedObject var model:Controller
    let openChat:(String)->Void
    let openSettings:()->Void
    let quit:()->Void
    @State private var editingChatID:String?
    @State private var heldRunning:[String]=[]
    @State private var heldRecent:[String]=[]
    private var running:[Chat] {editingChatID == nil ? model.runningChats:heldRunning.compactMap{id in model.chats.first{$0.id==id}}}
    private var recent:[Chat] {editingChatID == nil ? model.recentChats:heldRecent.compactMap{id in model.chats.first{$0.id==id}}}
    var body:some View {
        VStack(alignment:.leading,spacing:8){
            Button(action:openSettings){
                HStack{Text("打开主窗口");Spacer();Text("⌘M").foregroundStyle(.tertiary)}
                    .font(.system(size:13)).padding(.horizontal,10).padding(.vertical,7).contentShape(Rectangle())
            }.buttonStyle(ContextMenuButtonStyle()).keyboardShortcut("m")
            Divider().padding(.horizontal,8)
            ScrollView {
                VStack(alignment:.leading,spacing:2){
                    sectionLabel("正在运行",count:running.count)
                    if running.isEmpty {
                        Text(model.serviceAvailable ? "暂无运行中的聊天":"正在连接控制服务…").font(.system(size:12)).foregroundStyle(.secondary).padding(10)
                    }
                    ForEach(running){chat in chatRow(chat)}
                    if !recent.isEmpty {
                        Divider().padding(.horizontal,8).padding(.vertical,6)
                        sectionLabel("近期聊天",count:recent.count)
                        ForEach(recent){chat in chatRow(chat)}
                    }
                }
            }.scrollIndicators(.automatic)
            Divider().padding(.horizontal,8)
            HStack(spacing:6){
                Circle().fill(model.serviceAvailable && model.bridgeCount>0 ? Color.green:Color.gray).frame(width:6,height:6)
                Text("Context Manager")
                Spacer()
                Button("退出",action:quit).buttonStyle(.plain).help("退出菜单栏入口")
            }.font(.system(size:11)).foregroundStyle(.secondary).padding(.horizontal,10).padding(.vertical,4)
        }.padding(8).frame(width:400,height:model.contextMenuHeight)
    }
    private func sectionLabel(_ title:String,count:Int)->some View {
        HStack{Text(title);Spacer();Text("\(count)").monospacedDigit()}.font(.system(size:10,weight:.medium)).foregroundStyle(.secondary).padding(.horizontal,10).padding(.vertical,4)
    }
    private func chatRow(_ chat:Chat)->some View {
        MenuChatRow(model:model,chat:chat,canBegin:editingChatID==nil || editingChatID==chat.id,openChat:openChat,beginEditing:{
            if editingChatID==nil{heldRunning=model.runningChats.map(\.id);heldRecent=model.recentChats.map(\.id)}
            editingChatID=chat.id
        },endEditing:{if editingChatID==chat.id{editingChatID=nil}})
    }
}

@MainActor private struct MenuChatRow:View {
    @ObservedObject var model:Controller
    let chat:Chat;let canBegin:Bool;let openChat:(String)->Void;let beginEditing:()->Void;let endEditing:()->Void
    @State private var draft:MenuBudgetDraft?
    @State private var selection:BudgetThumb = .window
    @State private var hovering=false
    @State private var dragging=false
    @State private var touched=false
    @State private var saving=false
    @State private var feedback:String?
    @State private var failed=false
    private var maxMode:Bool {chat.modelMetadata?.context_ceiling==920000 && (draft.map{Int($0.windowK)==920} ?? (chat.observedWindow==920000))}
    private var stale:Bool {!model.serviceAvailable || !chat.connected || chat.freshUsage != true}
    var body:some View {
        ZStack {
            if let draft {
                Button{openChat(chat.id)}label:{Color.clear.contentShape(Rectangle())}
                    .buttonStyle(.plain).accessibilityLabel("打开 \(chat.title) 的主面板")
                editor(draft)
            }else{information}
        }.frame(height:50).contentShape(Rectangle())
            .background {if maxMode {MaxContextFlow().clipShape(RoundedRectangle(cornerRadius:5))}else{RoundedRectangle(cornerRadius:5).fill(.primary.opacity(hovering || draft != nil ? 0.06:0))}}
            .onHover{inside in hovering=inside;if inside{begin()}else{finishIfClean()}}
            .onChange(of:canBegin){_,allowed in if allowed && hovering{begin()}}
            .accessibilityAction(named:"调节预算"){begin()}
    }
    private var information:some View {
        Button{openChat(chat.id)} label:{
            HStack(spacing:10){
                Text(chat.title).font(.system(size:14,weight:.medium)).lineLimit(1).truncationMode(.middle).frame(maxWidth:.infinity,alignment:.leading)
                VStack(alignment:.trailing,spacing:3){
                    ContextUsageRing(fraction:chat.contextFraction,stale:stale)
                    Text(chat.contextFraction != nil ? "\(shortTokens(chat.lastUsage?.totalTokens)) / \(shortTokens(chat.observedWindow))\(stale ? " · 上次":"")":"尚无用量")
                        .font(.system(size:9)).foregroundStyle(.secondary)
                }.monospacedDigit().frame(width:100,alignment:.trailing)
            }.padding(.horizontal,10).contentShape(Rectangle())
        }.buttonStyle(.plain).help("\(chat.title) · \(chat.contextPercentage)；悬停调节预算，点击打开设置")
            .accessibilityLabel("\(chat.title)，上下文 \(chat.contextPercentage)\(stale ? "，上次读回":"")，打开设置")
    }
    private func editor(_ value:MenuBudgetDraft)->some View {
        VStack(spacing:0){
            HStack(spacing:8){
                if let feedback {Text(feedback).font(.system(size:10)).foregroundStyle(failed ? .orange:.secondary).lineLimit(1).help(feedback).allowsHitTesting(false)}
                else {
                    Text("压缩 \(Int(value.compactK))K").foregroundStyle(.blue).allowsHitTesting(false)
                    Text(value.maximumWindowK==920 && Int(value.windowK)==920 ? "MAX · 920K" : "窗口 \(Int(value.windowK))K").allowsHitTesting(false)
                }
                Spacer(minLength:2)
                if saving{ProgressView().controlSize(.mini).frame(width:28)}
                else{Button{Task{await apply()}}label:{Text("应用").frame(width:32,height:20).contentShape(Rectangle())}.foregroundStyle(.blue).disabled(!value.changed || !model.serviceAvailable)}
                Button{cancel()}label:{Image(systemName:"xmark").frame(width:20,height:20).contentShape(Rectangle())}.disabled(saving).help("取消未提交的修改")
            }.buttonStyle(.plain).font(.system(size:11,weight:.medium)).monospacedDigit().frame(height:20)
            BudgetRangeSlider(window:Binding(get:{draft?.windowK ?? value.windowK},set:{draft?.setWindow($0);touched=true;feedback=nil}),compact:Binding(get:{draft?.compactK ?? value.compactK},set:{draft?.setCompact($0);touched=true;feedback=nil}),selection:$selection,maximumWindow:value.maximumWindowK,maximumCompact:value.maximumCompactK,compactStyle:true,onEditingChanged:{active in dragging=active;if !active{finishIfClean()}})
                .disabled(saving || !model.serviceAvailable)
        }.padding(.horizontal,10).help(feedback ?? chat.title)
    }
    private func begin(){
        guard draft==nil,canBegin,model.serviceAvailable,let value=try? MenuBudgetDraft(chat:chat) else{return}
        draft=value;touched=false;feedback=nil;failed=false;beginEditing()
    }
    private func finishIfClean(){if !hovering && !dragging && !saving && !touched{cancel()}}
    private func cancel(){draft=nil;touched=false;feedback=nil;failed=false;endEditing()}
    private func apply() async {
        guard let value=draft,!saving else{return};saving=true;failed=false
        do {
            guard let current=model.chats.first(where:{$0.id==value.chatID}),current.model==value.model,
                  current.modelMetadata?.effective_context_window_percent==value.effectivePercent,
                  current.modelMetadata?.max_context_window==value.maximumRawWindow else{throw BudgetInputError(message:"模型信息已变化，请取消后重新调整")}
            let data=try await model.api("/policy",body:["id":value.chatID,"policy":try value.policy(),"apply":true,"expectedRevision":value.revision])
            let result=try JSONSerialization.jsonObject(with:data) as? [String:Any]
            let code=(result?["plan"] as? [String:Any])?["code"] as? String
            switch code {
            case "waiting_for_idle":feedback="已保存 · 本轮结束后应用"
            case "needs_compaction":feedback="已保存 · 需先压缩再应用";failed=true
            case "needs_observation":feedback="已保存 · 等待用量读回"
            default:feedback="已提交 · 等待读回确认"
            }
            touched=false
            if let raw=result?["thread"],let data=try? JSONSerialization.data(withJSONObject:raw),let updated=try? JSONDecoder().decode(Chat.self,from:data){
                draft=try? MenuBudgetDraft(chat:updated)
                if let index=model.chats.firstIndex(where:{$0.id==updated.id}){model.chats[index]=updated}
                if !updated.connected{feedback="已保存 · 接入后自动应用"}
            }
            await model.refresh()
        }catch{feedback=error.localizedDescription;failed=true}
        saving=false;finishIfClean()
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
