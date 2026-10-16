import SwiftUI
import Charts

private func tokenLabel(_ value:Int?)->String {value.map{$0.formatted()+" tokens"} ?? "未记录"}
private func eventColor(_ type:String)->Color {
    switch type {case "final":return .blue;case "user_input","steering":return .green;case "compaction":return .purple;default:return Color(white:0.78)}
}
@MainActor private final class TimelineSelection:ObservableObject {
    @Published private(set) var hovered:Int?
    @Published private(set) var selectedID=""
    @Published private(set) var pinnedPosition:Double?
    func hover(_ index:Int?){if hovered != index{hovered=index}}
    func pin(_ id:String){if selectedID != id{selectedID=id};pinnedPosition=nil;hover(nil)}
    func pinBucket(_ position:Double){selectedID="";pinnedPosition=position;hover(nil)}
    func focus(_ data:TimelineData)->Int? {
        if let hovered,data.buckets.indices.contains(hovered){return hovered}
        return data.bucket(for:selectedID) ?? pinnedPosition.flatMap{data.bucket(at:$0)}
    }
}
private enum TimelinePlotKind {case speed,cache,events}
#if DEBUG
@MainActor enum ChartInteractionProbe {
    static var chartBuilds=0;static var bucketCount=0;static var period=0
    static var setSmoothing:((Double)->Void)?
    private static weak var selection:TimelineSelection?
    private static var data:TimelineData?
    fileprivate static func rendered(_ state:TimelineSelection,_ value:TimelineData){chartBuilds+=1;selection=state;data=value;bucketCount=value.buckets.count;period=value.period}
    static func hover(_ position:Int?){selection?.hover(position.flatMap{data?.bucket(at:Double($0))})}
    static func pin(_ id:String){selection?.pin(id)}
    static var selectedID:String?{selection?.selectedID}
}
#endif
@MainActor struct ContextResponseChart:View,Equatable {
    let responses:[ContextStatistics.Response];let events:[ContextStatistics.TimelineEvent]
    nonisolated let revision:String
    @State private var smoothing=12.0
    @State private var prepared:TimelineData?
    @State private var preparing=false
    private var key:String{revision+":"+String(Int(smoothing))}
    nonisolated static func ==(lhs:Self,rhs:Self)->Bool{lhs.revision==rhs.revision}
    var body:some View {
        VStack(alignment:.leading,spacing:10){
            HStack(spacing:10){
                Text("对话趋势").font(.headline);Spacer()
                Text("平滑度").font(.caption).foregroundStyle(.secondary)
                Slider(value:$smoothing,in:0...40,step:1).frame(width:130).accessibilityLabel("趋势平滑度")
                Text(smoothing<2 ? "关闭":"EMA \(Int(smoothing))").font(.caption.monospacedDigit()).frame(width:60,alignment:.trailing)
                if preparing{ProgressView().controlSize(.mini)}
            }
            if let data=prepared {
                TimelinePlots(data:data).equatable()
            }else{ProgressView("正在整理趋势…").frame(maxWidth:.infinity,minHeight:260)}
        }.padding(14).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
#if DEBUG
        .onAppear{ChartInteractionProbe.setSmoothing={smoothing=$0}}
        .onDisappear{ChartInteractionProbe.setSmoothing=nil}
#endif
        .task(id:key){
            let requestKey=key,period=Int(smoothing),responses=responses,events=events
            do {
                if prepared != nil{try await Task.sleep(for:.milliseconds(180))}
                try Task.checkCancellation();preparing=true
                let job=Task.detached(priority:.userInitiated){try TimelineData(responses:responses,events:events,revision:requestKey,period:period)}
                let result=try await withTaskCancellationHandler(operation:{try await job.value},onCancel:{job.cancel()})
                try Task.checkCancellation();prepared=result;preparing=false
            }catch {if !Task.isCancelled{preparing=false}}
        }
    }
}
@MainActor private struct TimelinePlots:View,Equatable {
    let data:TimelineData
    @State private var selection=TimelineSelection()
    nonisolated static func ==(lhs:Self,rhs:Self)->Bool{lhs.data.revision==rhs.data.revision}
    var body:some View {
#if DEBUG
        let _=ChartInteractionProbe.rendered(selection,data)
#endif
        return VStack(alignment:.leading,spacing:8){
            HStack{Text("每区间约 \(data.bucketSize) 次响应 · \(data.buckets.count) 个区间");Spacer();Text("共 \(data.responseCount) 次响应")}.font(.caption2).foregroundStyle(.secondary)
            HStack {Text(data.period<2 ? "区间生成均速":"生成速度 · EMA 趋势").font(.caption.weight(.medium));Spacer();TimelineSpeedLabel(data:data,selection:selection)}
            speedChart
            HStack(spacing:12){Text("输入与缓存").font(.caption.weight(.medium));Spacer();legend("输入",color:.gray);legend("缓存",color:.cyan)}
            cacheChart
            HStack(spacing:12){Text("区间事件").font(.caption.weight(.medium));Spacer();legend("最终",color:.blue);legend("输入",color:.green);legend("压缩",color:.purple);legend("零值",color:.orange)}
            eventTrack
            if !data.buckets.isEmpty{TimelineBucketDetails(data:data,selection:selection)}
            DisclosureGroup("统计说明"){
                Text("总览最多 120 个区间。平滑只改变趋势线；区间速度按输出量÷生成时间计算，输入和缓存取均值，输出取合计。缺失、模型变化和压缩处断开平滑；缓存零值保留事件标记和区间最小值。展开区间可逐条查看原始记录，点击可固定。").font(.caption).foregroundStyle(.secondary).padding(.top,5)
            }.font(.caption).foregroundStyle(.secondary)
        }.onHover{inside in if !inside{selection.hover(nil)}}
        .onChange(of:data.revision){_,_ in selection.hover(nil)}
    }
    private func legend(_ title:String,color:Color)->some View {HStack(spacing:4){Circle().fill(color).frame(width:5,height:5);Text(title)}.font(.caption2).foregroundStyle(.secondary)}
    private var speedChart:some View {
        Chart {
            ForEach(data.speed){point in
                LineMark(x:.value("记录顺序",point.position),y:.value("tokens/s",point.value),series:.value("片段",point.series)).interpolationMethod(.monotone).foregroundStyle(.white.opacity(0.8)).lineStyle(StrokeStyle(lineWidth:1.8))
                PointMark(x:.value("记录顺序",point.position),y:.value("tokens/s",point.value)).foregroundStyle(.white.opacity(0.35)).symbolSize(5)
            }
            ForEach(data.buckets.filter{$0.compactions>0}){b in RuleMark(x:.value("记录顺序",b.position)).foregroundStyle(.purple.opacity(0.35)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
        }.chartXScale(domain:0...data.upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Double.self){Text(n.formatted(.number.precision(.fractionLength(0...1)))).frame(width:50,alignment:.leading)}}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
        .chartOverlay{proxy in TimelineOverlay(proxy:proxy,kind:.speed,data:data,selection:selection)}.frame(height:165)
    }
    private var cacheChart:some View {
        Chart {
            ForEach(data.input){p in
                LineMark(x:.value("记录顺序",p.position),y:.value("tokens",p.value),series:.value("片段","input-\(p.series)")).interpolationMethod(.monotone).foregroundStyle(.gray.opacity(0.6))
                PointMark(x:.value("记录顺序",p.position),y:.value("tokens",p.value)).foregroundStyle(.gray.opacity(0.4)).symbolSize(3)
            }
            ForEach(data.cache){p in
                LineMark(x:.value("记录顺序",p.position),y:.value("tokens",p.value),series:.value("片段","cache-\(p.series)")).interpolationMethod(.monotone).foregroundStyle(.cyan)
                PointMark(x:.value("记录顺序",p.position),y:.value("tokens",p.value)).foregroundStyle(.cyan.opacity(0.4)).symbolSize(3)
            }
            ForEach(data.buckets.filter{$0.compactions>0}){b in RuleMark(x:.value("记录顺序",b.position)).foregroundStyle(.purple.opacity(0.5)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
        }.chartXScale(domain:0...data.upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Int.self){Text(n>=1000 ? "\(n/1000)K":"\(n)").frame(width:50,alignment:.leading)}}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
        .chartOverlay{proxy in TimelineOverlay(proxy:proxy,kind:.cache,data:data,selection:selection)}.frame(height:95)
    }
    private var eventTrack:some View {
        Chart {
            ForEach(data.buckets){b in
                if b.responses>b.finals {PointMark(x:.value("记录顺序",b.position),y:.value("事件",0)).foregroundStyle(.white.opacity(0.5)).symbolSize(12)}
                if b.finals>0 {PointMark(x:.value("记录顺序",b.position),y:.value("事件",0.35)).foregroundStyle(.blue).symbolSize(35)}
                if b.users>0 {PointMark(x:.value("记录顺序",b.position),y:.value("事件",-0.35)).symbol(.diamond).foregroundStyle(.green).symbolSize(35)}
                if b.compactions>0 {PointMark(x:.value("记录顺序",b.position),y:.value("事件",0.7)).symbol(.square).foregroundStyle(.purple).symbolSize(45)}
                if b.zeroCaches>0 {PointMark(x:.value("记录顺序",b.position),y:.value("事件",-0.7)).symbol{Circle().strokeBorder(.orange,lineWidth:1.5).frame(width:6,height:6)}}
            }
        }.chartXScale(domain:0...data.upperBound).chartYScale(domain:-1...1)
        .chartYAxis{AxisMarks(position:.trailing,values:[0]){_ in AxisValueLabel{Text(" ").frame(width:50,alignment:.leading).accessibilityHidden(true)}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08));AxisValueLabel()}}
        .chartOverlay{proxy in TimelineOverlay(proxy:proxy,kind:.events,data:data,selection:selection)}.frame(height:42)
    }
}
@MainActor private struct TimelineSpeedLabel:View {
    let data:TimelineData;@ObservedObject var selection:TimelineSelection
    var body:some View {let index=selection.focus(data) ?? data.buckets.indices.last
        Text(index.flatMap{data.buckets[$0].speed}.map{String(format:"区间 %.1f tokens/s",$0)} ?? "无计时").font(.caption).monospacedDigit().foregroundStyle(.secondary)
    }
}
@MainActor private struct TimelineOverlay:View {
    let proxy:ChartProxy;let kind:TimelinePlotKind;let data:TimelineData
    @ObservedObject var selection:TimelineSelection
    var body:some View {
        GeometryReader{geometry in ZStack{
            Rectangle().fill(.clear).contentShape(Rectangle())
                .onContinuousHover{phase in if case .active(let location)=phase,let index=nearest(location,geometry){selection.hover(index)}}
                .onTapGesture(coordinateSpace:.local){location in if let index=nearest(location,geometry){selection.pinBucket(data.buckets[index].position)}}
            if let index=selection.focus(data),let frame=proxy.plotFrame,let x=proxy.position(forX:data.buckets[index].position){
                let bounds=geometry[frame],b=data.buckets[index]
                if let left=proxy.position(forX:Double(b.startPosition)),let right=proxy.position(forX:Double(b.endPosition)){
                    Rectangle().fill(.white.opacity(0.04)).frame(width:max(2,right-left),height:bounds.height).position(x:bounds.minX+(left+right)/2,y:bounds.midY).allowsHitTesting(false)
                }
                Rectangle().fill(.white.opacity(0.4)).frame(width:1,height:bounds.height).position(x:bounds.minX+x,y:bounds.midY).allowsHitTesting(false)
            }
        }.help("悬停查看区间，点击固定")}
    }
    private func nearest(_ location:CGPoint,_ geometry:GeometryProxy)->Int? {
        guard let frame=proxy.plotFrame else{return nil};let bounds=geometry[frame]
        guard bounds.contains(location),let position=proxy.value(atX:location.x-bounds.minX,as:Double.self) else{return nil}
        return data.bucket(at:position)
    }
}
@MainActor private struct TimelineBucketDetails:View {
    let data:TimelineData;@ObservedObject var selection:TimelineSelection
    @State private var page=0
    private var index:Int{selection.focus(data) ?? data.buckets.count-1}
    var body:some View {
        let b=data.buckets[index],pageCount=max(1,Int(ceil(Double(b.entryRange.count)/20))),currentPage=min(page,pageCount-1)
        return VStack(alignment:.leading,spacing:9){
            HStack{Text(b.title).font(.callout.weight(.medium));Spacer();Text("\(b.responses) 次响应 · \(b.measured) 次计时").font(.caption).foregroundStyle(.secondary)}
            HStack(spacing:12){metric("区间均速",b.speed.map{String(format:"%.1f t/s",$0)} ?? "—");metric("输入均量",amount(b.inputMean));metric("缓存均量",amount(b.cacheMean));metric("输出合计",b.outputSamples>0 ? amount(Double(b.outputTokens)):"—")}
            Text("最终 \(b.finals) · 用户输入 \(b.users) · 压缩 \(b.compactions) · 缓存零值 \(b.zeroCaches)").font(.caption).foregroundStyle(.secondary)
            if !b.models.isEmpty {Text(b.models.map{modelDisplayName($0)}.joined(separator:" · ")).font(.caption2).foregroundStyle(.secondary).lineLimit(1)}
            if b.zeroCaches>0{Text("区间最低缓存：\(b.cacheMinimum.map{$0.formatted()} ?? "—") tokens").font(.caption2).foregroundStyle(.orange)}
            DisclosureGroup("原始记录（\(b.entryRange.count) 条）"){
                VStack(alignment:.leading,spacing:6){
                    HStack{Text("第 \(currentPage+1)/\(pageCount) 页").font(.caption);Spacer();Button("上一页"){page=max(0,currentPage-1)}.disabled(currentPage==0);Button("下一页"){page=min(pageCount-1,currentPage+1)}.disabled(currentPage+1>=pageCount)}.controlSize(.small)
                    ForEach(Array(data.page(bucket:index,page:currentPage))){entry in
                        Button{selection.pin(entry.id)} label:{HStack{Circle().fill(eventColor(entry.eventType)).frame(width:5,height:5);Text(entry.kind);Spacer();if let r=entry.response{Text(r.tokensPerSecond.map{String(format:"%.1f t/s",$0)} ?? "无计时").monospacedDigit()}}}.buttonStyle(.plain).font(.caption).padding(.vertical,3)
                    }
                    if let entry=data.entry(selection.selectedID),data.bucket(for:entry.id)==index{Divider();TimelineRawDetails(entry:entry)}
                }.padding(.top,6)
            }.font(.caption)
        }.padding(10).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10)).onChange(of:index){_,_ in page=0}
    }
    private func amount(_ n:Double?)->String{n.map{$0>=1000 ? String(format:"%.1fK",$0/1000):String(format:"%.0f",$0)} ?? "—"}
    private func metric(_ label:String,_ value:String)->some View{VStack(alignment:.leading,spacing:3){Text(label).font(.caption2).foregroundStyle(.secondary);Text(value).font(.callout).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)}
}
@MainActor private struct TimelineRawDetails:View {
    let entry:TimelineEntry
    var body:some View {
        VStack(alignment:.leading,spacing:8){Text(entry.kind).font(.caption.weight(.semibold));if let r=entry.response{responseDetails(r)}else if let e=entry.event{eventDetails(e)}}
    }
    private func compactTokens(_ value:Int?)->String {
        value.map{$0>=1000 ? (Double($0)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":$0.formatted()} ?? "—"
    }
    private func localTime(_ value:String)->String {
        let parser=ISO8601DateFormatter();parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        return parser.date(from:value)?.formatted(date:.omitted,time:.standard) ?? value
    }
    private func field(_ label:String,_ value:String)->some View {
        VStack(alignment:.leading,spacing:3){Text(label).font(.caption2).foregroundStyle(.secondary);Text(value).font(.system(size:13,weight:.medium)).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)
    }
    private func eventDetails(_ e:ContextStatistics.TimelineEvent)->some View {
        VStack(alignment:.leading,spacing:7){
            HStack {
                if e.eventType=="compaction" {field("保留项目",e.retainedItems.map{String($0)} ?? "—");field("状态","压缩完成")}
                else {field("文本 · 估算 tokens",compactTokens(e.tokensEstimate));field("图片","\(e.images)");field("输入类型",e.eventType=="steering" ? "同轮追加":"用户输入")}
                field("时间",localTime(e.timestamp))
            }
            Text("轮次 \(e.turnId ?? "未记录")").font(.caption2).foregroundStyle(.tertiary).textSelection(.enabled)
        }
    }
    private func responseDetails(_ r:ContextStatistics.Response)->some View {
        VStack(alignment:.leading,spacing:8){
            HStack(spacing:10){
                field("生成 · tokens/s",r.tokensPerSecond.map{String(format:"%.1f",$0)} ?? "—")
                field("输出 tokens",compactTokens(r.outputTokens))
                field("输入 tokens",compactTokens(r.inputTokens))
                field("缓存命中",compactTokens(r.cachedInputTokens))
                field("命中变化",r.cacheDelta.map{($0>=0 ? "+":"−")+compactTokens(abs($0))} ?? "—")
                field("命中率",r.cacheHitRate.map{String(format:"%.1f%%",$0*100)} ?? "—")
            }
            HStack(spacing:6){
                Text(r.config.model.map{modelDisplayName($0)} ?? "模型未记录").foregroundStyle(.primary)
                Text("· \(effortDisplayName(r.config.effort)) · \(serviceTierDisplayName(r.config.serviceTier))")
                Spacer();Text(localTime(r.timestamp))
            }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
            DisclosureGroup("更多信息"){
                VStack(alignment:.leading,spacing:5){
                    if r.cacheStatus=="zero_in_log"{Text("缓存日志值为 0；这次原始响应未保存，无法区分未命中与缺失详情。").foregroundStyle(.orange)}
                    else if r.cacheStatus=="missing" || r.cacheStatus=="invalid"{Text("缓存数据未记录或无效，不按零计算。").foregroundStyle(.secondary)}
                    Text("生成用时 \(r.durationMs.map{String(format:"%.2f 秒",$0/1000)} ?? "未记录") · 生成前间隔 \(r.preGenerationGapMs.map{String(format:"≈ %.2f 秒",$0/1000)} ?? "未记录")")
                    Text("生成前间隔来自最近输入记录到首个生成项目，含客户端等待等开销，不是精确的服务器首 token 延迟。").foregroundStyle(.secondary)
                    if let parts=r.costEstimate?.breakdown {ForEach(parts){part in HStack {Text(part.label);Spacer();Text("\(part.tokens.formatted()) tokens · \(String(format:"$%.4f",part.usd))").monospacedDigit()}}}
                    Text("本次 API 估算 \(r.costEstimate?.usd.map{String(format:"$%.4f",$0)} ?? "未知") · Standard 单价")
                    Text("推理 \(tokenLabel(r.reasoningTokens)) · 缓存写入（估算） \(tokenLabel(r.costEstimate?.breakdown?.first(where:{$0.category=="cache_write"})?.tokens)) · 用时 \(r.durationMs.map{String(format:"%.2f 秒",$0/1000)} ?? "未记录")")
                    Text("窗口 \(tokenLabel(r.config.contextWindow)) · 压缩阈值 \(tokenLabel(r.config.compactThreshold)) · 轮次 \(r.turnId ?? "未记录")")
                }.font(.caption2).foregroundStyle(.secondary).textSelection(.enabled).padding(.top,4)
            }.font(.caption2).foregroundStyle(.secondary)
        }
    }
}
