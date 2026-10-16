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
    var contextMenuHeight:CGFloat {min(560,max(210,CGFloat(runningChats.count+recentChats.count)*52+175))}
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
    var body:some View {
        VStack(alignment:.leading,spacing:8){
            Button(action:openSettings){
                HStack{Text("打开主窗口");Spacer();Text("⌘M").foregroundStyle(.tertiary)}
                    .font(.system(size:13)).padding(.horizontal,10).padding(.vertical,7).contentShape(Rectangle())
            }.buttonStyle(ContextMenuButtonStyle()).keyboardShortcut("m")
            Divider().padding(.horizontal,8)
            ScrollView {
                VStack(alignment:.leading,spacing:2){
                    sectionLabel("正在运行",count:model.runningChats.count)
                    if model.runningChats.isEmpty {
                        Text(model.serviceAvailable ? "暂无运行中的聊天":"正在连接控制服务…").font(.system(size:12)).foregroundStyle(.secondary).padding(10)
                    }
                    ForEach(model.runningChats){chat in chatRow(chat)}
                    if !model.recentChats.isEmpty {
                        Divider().padding(.horizontal,8).padding(.vertical,6)
                        sectionLabel("近期聊天",count:model.recentChats.count)
                        ForEach(model.recentChats){chat in chatRow(chat)}
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
        let stale = !model.serviceAvailable || !chat.connected || chat.freshUsage != true
        return Button{openChat(chat.id)} label:{
            HStack(spacing:10){
                Text(chat.title).font(.system(size:14,weight:.medium)).lineLimit(1).truncationMode(.middle).frame(maxWidth:.infinity,alignment:.leading)
                VStack(alignment:.trailing,spacing:3){
                    ContextUsageRing(fraction:chat.contextFraction,stale:stale)
                    Text(chat.contextFraction != nil ? "\(shortTokens(chat.lastUsage?.totalTokens)) / \(shortTokens(chat.observedWindow))\(stale ? " · 上次":"")":"尚无用量")
                        .font(.system(size:9)).foregroundStyle(.secondary)
                }.monospacedDigit().frame(width:100,alignment:.trailing)
            }.padding(.horizontal,10).frame(height:50).contentShape(Rectangle())
        }.buttonStyle(ContextMenuButtonStyle()).help("\(chat.title) · \(chat.contextPercentage)\(stale ? "（上次读回）":"")；点击打开设置")
            .accessibilityLabel("\(chat.title)，上下文 \(chat.contextPercentage)\(stale ? "，上次读回":"")，打开设置")
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
