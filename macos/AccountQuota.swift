import SwiftUI
import AppKit

func quotaPeriod(_ window:QuotaWindow)->String {
    guard let minutes=window.windowDurationMins else{return L("额度周期")}
    if minutes%1440==0{return L("{0}天",minutes/1440)}
    if minutes%60==0{return L("{0}小时",minutes/60)}
    return L("{0}分钟",minutes)
}

@MainActor func quotaBarsStatusImage(bucket:QuotaBucket?,stale:Bool)->NSImage {
    let remaining=[bucket?.primary,bucket?.secondary].compactMap{$0?.remainingPercent}.min().map{max(0,min(1,$0/100))}
    let image=NSImage(size:NSSize(width:48,height:24));image.lockFocus()
    let opacity:CGFloat=remaining == nil ? 0.35:stale ? 0.45:1
    let bolt=NSBezierPath();bolt.move(to:NSPoint(x:18,y:23));bolt.line(to:NSPoint(x:2,y:10));bolt.line(to:NSPoint(x:10,y:10));bolt.line(to:NSPoint(x:5,y:0));bolt.line(to:NSPoint(x:23,y:14));bolt.line(to:NSPoint(x:14,y:14));bolt.close()
    for x:CGFloat in [1,4.2,7.4,10.6,13.8,17,20.2] {
        let strip=NSBezierPath(rect:NSRect(x:x,y:0,width:2.7,height:24))
        NSGraphicsContext.saveGraphicsState();strip.addClip()
        bolt.lineWidth=0.7;NSColor.black.withAlphaComponent(opacity*0.35).setStroke();bolt.stroke()
        bolt.addClip();strip.lineWidth=0.6;strip.stroke()
        if let remaining,remaining>0{NSColor.black.withAlphaComponent(opacity).setFill();NSBezierPath(rect:NSRect(x:x,y:0,width:2.7,height:24*remaining)).fill()}
        NSGraphicsContext.restoreGraphicsState()
    }
    let label=remaining.map{String(format:"%.0f%%",$0*100)} ?? "—"
    let font=NSFont.monospacedDigitSystemFont(ofSize:9,weight:.semibold)
    let attributes:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:NSColor.black]
    let text=label as NSString,measured=text.size(withAttributes:attributes)
    let x:CGFloat=21.5+(22-measured.width)/2
    text.draw(at:NSPoint(x:x,y:0.5),withAttributes:[.font:font,.foregroundColor:NSColor.black.withAlphaComponent(opacity)])
    image.unlockFocus();image.isTemplate=true;return image
}

struct AccountQuotaSection:View {
    @ObservedObject var model:Controller
    private var stale:Bool {!model.serviceAvailable || model.quota?.stale == true}
    private var windows:[QuotaWindow] {[model.selectedQuota?.primary,model.selectedQuota?.secondary].compactMap{$0}.sorted{($0.windowDurationMins ?? Int.max)<($1.windowDurationMins ?? Int.max)}}
    var body:some View {
        VStack(alignment:.leading,spacing:8){
            HStack(spacing:6){Image(systemName:"bolt.fill");Text(L("账户额度")).fontWeight(.medium);Spacer();if model.quotaRefreshing{ProgressView().controlSize(.mini)};Button{Task{await model.refreshQuota()}} label:{Image(systemName:"arrow.clockwise")}.buttonStyle(.plain).disabled(model.quotaRefreshing).help(L("刷新额度"))}.font(.system(size:12)).foregroundStyle(.secondary)
            if (model.quota?.buckets.count ?? 0)>1 {
                Picker(L("额度类型"),selection:$model.selectedQuotaID){ForEach(model.quota?.buckets ?? []){bucket in Text(bucket.name).tag(bucket.id)}}.labelsHidden()
            }
            if windows.isEmpty {
                Text(L(model.quotaRefreshing || model.quota?.loading == true ? "正在读取额度…":"额度暂不可用")).font(.system(size:12)).foregroundStyle(.secondary)
            } else {
                ForEach(Array(windows.enumerated()),id:\.offset){_,window in
                    HStack(alignment:.firstTextBaseline,spacing:8){
                        Text(quotaPeriod(window)).foregroundStyle(.secondary)
                        Text(L("剩余 {0}%",Int(window.remainingPercent.rounded()))).monospacedDigit().fontWeight(.medium)
                            .foregroundStyle(stale ? Color.secondary:window.remainingPercent<=5 ? .red:window.remainingPercent<=20 ? .orange:.primary)
                        Spacer()
                        if let reset=window.resetsAt{Text(Date(timeIntervalSince1970:Double(reset)),format:.dateTime.month(.abbreviated).day().hour().minute()).foregroundStyle(.tertiary).help(L("重置时间"))}
                    }.font(.system(size:12))
                }
                if model.selectedQuota?.hasCredits == true || model.selectedQuota?.unlimitedCredits == true {Text(L("额外额度可用")).font(.system(size:11)).foregroundStyle(.secondary)}
            }
            if stale{Text(L("上次记录，待刷新")).font(.system(size:11)).foregroundStyle(.orange)}
        }.padding(10).frame(maxWidth:.infinity,alignment:.leading).background(.primary.opacity(0.035),in:RoundedRectangle(cornerRadius:9)).padding(.horizontal,4)
    }
}
