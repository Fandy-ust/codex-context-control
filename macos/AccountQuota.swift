import SwiftUI
import AppKit

func quotaPeriod(_ window:QuotaWindow)->String {
    guard let minutes=window.windowDurationMins else{return L("额度周期")}
    if minutes%1440==0{return L("{0}天",minutes/1440)}
    if minutes%60==0{return L("{0}小时",minutes/60)}
    return L("{0}分钟",minutes)
}

@MainActor func quotaStatusImage(bucket:QuotaBucket?,stale:Bool)->NSImage {
    let image=NSImage(size:NSSize(width:22,height:22));image.lockFocus()
    let windows=[bucket?.primary,bucket?.secondary].compactMap{$0}.sorted{($0.windowDurationMins ?? Int.max)<($1.windowDurationMins ?? Int.max)}
    for index in 0..<max(1,windows.count) {
        let radius:CGFloat=index==0 ? 9.25:6.2
        let track=NSBezierPath(ovalIn:NSRect(x:11-radius,y:11-radius,width:radius*2,height:radius*2));track.lineWidth=1.6
        if windows.isEmpty{track.setLineDash([2,2],count:2,phase:0)}
        NSColor.black.withAlphaComponent(0.22).setStroke();track.stroke()
        if index<windows.count,windows[index].remainingPercent>0 {
            let arc=NSBezierPath();arc.lineWidth=1.6;arc.lineCapStyle = .round
            arc.appendArc(withCenter:NSPoint(x:11,y:11),radius:radius,startAngle:90,endAngle:90-windows[index].remainingPercent*3.6,clockwise:true)
            NSColor.black.withAlphaComponent(stale ? 0.45:1).setStroke();arc.stroke()
        }
    }
    let symbol=NSImage(systemSymbolName:windows.isEmpty ? "questionmark":"bolt.fill",accessibilityDescription:nil)?.withSymbolConfiguration(.init(pointSize:windows.count>1 ? 7:9,weight:.semibold))
    symbol?.draw(in:NSRect(x:7.5,y:6.5,width:7,height:9))
    image.unlockFocus();image.isTemplate=true;return image
}

struct QuotaPopoverView:View {
    @ObservedObject var model:Controller
    private var windows:[QuotaWindow] {[model.selectedQuota?.primary,model.selectedQuota?.secondary].compactMap{$0}.sorted{($0.windowDurationMins ?? Int.max)<($1.windowDurationMins ?? Int.max)}}
    private func color(_ window:QuotaWindow,_ index:Int)->Color {model.quota?.stale == true ? .gray:window.remainingPercent<=5 ? .red:window.remainingPercent<=20 ? .orange:index==0 ? .cyan:.purple}
    var body:some View {
        VStack(alignment:.leading,spacing:18){
            HStack {
                VStack(alignment:.leading,spacing:4){Text(L("账户额度")).font(.system(size:15,weight:.semibold));Text("Codex").font(.caption).foregroundStyle(.secondary)}
                Spacer()
                Button{Task{await model.refreshQuota()}} label:{Image(systemName:"arrow.clockwise")}.buttonStyle(.plain).disabled(model.quotaRefreshing).help(L("刷新额度"))
            }
            if (model.quota?.buckets.count ?? 0)>1 {
                Picker(L("额度类型"),selection:$model.selectedQuotaID){ForEach(model.quota?.buckets ?? []){bucket in Text(bucket.name).tag(bucket.id)}}.labelsHidden()
            }
            if !windows.isEmpty {
                HStack(spacing:22){
                    ZStack {
                        ForEach(Array(windows.enumerated()),id:\.offset){index,window in
                            let size:CGFloat=index==0 ? 84:66
                            Circle().stroke(.primary.opacity(0.08),lineWidth:5).frame(width:size,height:size)
                            Circle().trim(from:0,to:window.remainingPercent/100).stroke(color(window,index),style:StrokeStyle(lineWidth:5,lineCap:.round)).rotationEffect(.degrees(-90)).frame(width:size,height:size)
                        }
                        Image(systemName:"bolt.fill").font(.system(size:18,weight:.medium)).foregroundStyle(.secondary)
                    }.frame(width:90,height:90)
                    VStack(alignment:.leading,spacing:12){ForEach(Array(windows.enumerated()),id:\.offset){index,window in
                        VStack(alignment:.leading,spacing:3){Text(quotaPeriod(window)).font(.caption).foregroundStyle(.secondary);HStack(alignment:.firstTextBaseline,spacing:5){Text("\(Int(window.remainingPercent.rounded()))%").font(.system(size:25,weight:.semibold,design:.rounded)).monospacedDigit().foregroundStyle(color(window,index));Text(L("剩余")).font(.caption).foregroundStyle(.secondary)}}
                    }}
                }
                if model.selectedQuota?.hasCredits == true || model.selectedQuota?.unlimitedCredits == true {Label(L("额外额度可用"),systemImage:"plus.circle").font(.caption).foregroundStyle(.secondary)}
                Divider()
                Text(L("重置时间")).font(.caption).foregroundStyle(.secondary)
                VStack(alignment:.leading,spacing:10){ForEach(Array(windows.enumerated()),id:\.offset){index,window in
                    HStack{Circle().fill(color(window,index)).frame(width:5,height:5);Text(quotaPeriod(window)).font(.caption);Spacer();if let reset=window.resetsAt{Text(Date(timeIntervalSince1970:Double(reset)),format:.dateTime.month(.abbreviated).day().hour().minute()).font(.caption).foregroundStyle(.secondary)}else{Text("—").foregroundStyle(.secondary)}}
                }}
            } else {
                VStack(spacing:12){Image(systemName:"circle.dashed").font(.system(size:40,weight:.ultraLight)).foregroundStyle(.tertiary);Text(L(model.quotaRefreshing || model.quota?.loading == true ? "正在读取额度…":"额度暂不可用")).font(.callout).foregroundStyle(.secondary)}.frame(maxWidth:.infinity,minHeight:140)
            }
            HStack(spacing:5){
                if model.quotaRefreshing{ProgressView().controlSize(.mini)}
                if model.quota?.stale == true{Text(L("上次记录，待刷新")).foregroundStyle(.orange)}
                else if let updated=model.quota?.updatedAt{Text(L("更新于"));Text(Date(timeIntervalSince1970:Double(updated)/1000),style:.time)}
                Spacer()
            }.font(.system(size:10)).foregroundStyle(.tertiary)
        }.padding(20).frame(width:320).fixedSize(horizontal:false,vertical:true)
    }
}
