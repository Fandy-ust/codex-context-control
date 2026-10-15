import SwiftUI
import Charts

private func tokenLabel(_ value:Int?)->String {value.map{$0.formatted()+" tokens"} ?? "未记录"}
private func eventColor(_ type:String)->Color {
    switch type {case "final":return .blue;case "user_input","steering":return .green;case "compaction":return .purple;default:return Color(white:0.78)}
}
private struct TimelineEntry:Identifiable {
    let id:String;let position:Int;let kind:String;let eventType:String
    let response:ContextStatistics.Response?;let event:ContextStatistics.TimelineEvent?
}
@MainActor private final class TimelineSelection:ObservableObject {
    @Published private(set) var hovered:Int?
    @Published private(set) var selectedID=""
    func hover(_ position:Int?){if hovered != position{hovered=position}}
    func pin(_ id:String){if selectedID != id{selectedID=id};hover(nil)}
}
@MainActor private func chosenEntry(_ entries:[TimelineEntry],_ selection:TimelineSelection)->TimelineEntry? {
    entries.first{$0.position==selection.hovered} ?? entries.first{$0.id==selection.selectedID} ?? entries.last
}
private enum TimelinePlotKind {case speed,cache,events}
#if DEBUG
@MainActor enum ChartInteractionProbe {
    static var chartBuilds=0
    private static weak var selection:TimelineSelection?
    fileprivate static func rendered(_ state:TimelineSelection){chartBuilds+=1;selection=state}
    static func hover(_ position:Int?){selection?.hover(position)}
    static func pin(_ id:String){selection?.pin(id)}
    static var selectedID:String?{selection?.selectedID}
}
#endif
@MainActor struct ContextResponseChart:View,Equatable {
    let responses:[ContextStatistics.Response]
    let events:[ContextStatistics.TimelineEvent]
    nonisolated let revision:String
    private let entries:[TimelineEntry]
    private let measured:[ContextStatistics.Response]
    @State private var selection=TimelineSelection()
    init(responses:[ContextStatistics.Response],events:[ContextStatistics.TimelineEvent],revision:String){
        self.responses=responses;self.events=events;self.revision=revision
        measured=responses.filter{$0.tokensPerSecond != nil}
        let output=responses.map{TimelineEntry(id:$0.id,position:$0.position,kind:"响应 #\($0.index) · \($0.kind)",eventType:$0.eventType,response:$0,event:nil)}
        let input=events.map{TimelineEntry(id:$0.id,position:$0.position,kind:$0.kind,eventType:$0.eventType,response:nil,event:$0)}
        entries=(output+input).sorted{$0.position<$1.position}
    }
    nonisolated static func ==(lhs:Self,rhs:Self)->Bool{lhs.revision==rhs.revision}
    private var upperBound:Int {max(2,(entries.last?.position ?? 0)+1)}
    var body:some View {
#if DEBUG
        let _=ChartInteractionProbe.rendered(selection)
#endif
        return VStack(alignment:.leading,spacing:10){
            HStack {Text("对话趋势").font(.headline);Spacer();Text("\(measured.count)/\(responses.count) 次响应有计时").font(.caption).foregroundStyle(.secondary)}
            VStack(alignment:.leading,spacing:6){
                HStack {Text("生成速度").font(.caption.weight(.medium));Spacer();TimelineSpeedLabel(entries:entries,selection:selection)}
                if measured.isEmpty {Text("暂无完整计时").font(.caption).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:100)}
                else {speedChart}
                HStack(spacing:12){Text("输入与缓存").font(.caption.weight(.medium));Spacer();HStack(spacing:4){Circle().fill(.gray).frame(width:5,height:5);Text("输入")};HStack(spacing:4){Circle().fill(.cyan).frame(width:5,height:5);Text("缓存命中")}}.font(.caption2).foregroundStyle(.secondary)
                cacheChart
                HStack(spacing:12){Text("对话事件").font(.caption.weight(.medium));Spacer();legend("中间",type:"intermediate");legend("最终",type:"final");legend("输入",type:"steering");legend("压缩",type:"compaction")}
                eventTrack
            }
            if !entries.isEmpty {TimelineDetails(entries:entries,selection:selection)}
            DisclosureGroup("统计说明"){
                Text("横轴按记录顺序；悬停联动，点击固定。生成速度不含开始前的等待；空缺断线，橙色空心点为未经原始响应核实的日志零值。输入、压缩不计速度。图表用于对照变化，不单独判断因果。")
                    .font(.caption).foregroundStyle(.secondary).padding(.top,5)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(14).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
        .onHover{inside in if !inside{selection.hover(nil)}}
    }
    private func legend(_ label:String,type:String)->some View {
        HStack(spacing:5){Circle().fill(eventColor(type)).frame(width:7,height:7);Text(label)}.font(.caption).foregroundStyle(.secondary)
    }
    private var speedChart:some View {
        Chart {
            ForEach(measured){r in
                LineMark(x:.value("记录顺序",r.position),y:.value("tokens/s",r.tokensPerSecond!),series:.value("连续片段",r.segment)).foregroundStyle(.white.opacity(0.22))
                PointMark(x:.value("记录顺序",r.position),y:.value("tokens/s",r.tokensPerSecond!)).foregroundStyle(eventColor(r.eventType)).symbolSize(r.eventType=="final" ? 55:25)
            }
            ForEach(events.filter{$0.eventType=="compaction"}){e in RuleMark(x:.value("记录顺序",e.position)).foregroundStyle(.purple.opacity(0.35)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
        }
        .chartXScale(domain:0...upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Double.self){Text(n.formatted(.number.precision(.fractionLength(0...1)))).frame(width:50,alignment:.leading)}}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
        .chartOverlay{proxy in hoverArea(proxy,kind:.speed)}.frame(height:165)
    }
    private var eventTrack:some View {
        Chart {
                ForEach(responses){r in PointMark(x:.value("记录顺序",r.position),y:.value("事件",0)).foregroundStyle(eventColor(r.eventType)).symbolSize(r.eventType=="final" ? 55:18)}
                ForEach(events){e in
                    if e.eventType=="compaction" {PointMark(x:.value("记录顺序",e.position),y:.value("事件",0)).symbol(.square).foregroundStyle(.purple).symbolSize(65)}
                    else {PointMark(x:.value("记录顺序",e.position),y:.value("事件",0)).symbol(.diamond).foregroundStyle(.green).symbolSize(55)}
                }
            }.chartXScale(domain:0...upperBound).chartYScale(domain:-1...1).chartYAxis{AxisMarks(position:.trailing,values:[0]){_ in AxisValueLabel{Text(" ").frame(width:50,alignment:.leading).accessibilityHidden(true)}}}
                .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08));AxisValueLabel()}}
                .chartOverlay{proxy in hoverArea(proxy,kind:.events)}.frame(height:36)
    }
    private var cacheChart:some View {
        Chart {
                ForEach(responses){r in
                    if let input=r.inputTokens{LineMark(x:.value("记录顺序",r.position),y:.value("tokens",input),series:.value("类型","input-\(r.inputSegment)")).foregroundStyle(.gray.opacity(0.6))}
                    if let cache=r.cachedInputTokens{LineMark(x:.value("记录顺序",r.position),y:.value("tokens",cache),series:.value("类型","cache-\(r.cacheSegment)")).foregroundStyle(.cyan)}
                }
                ForEach(responses.filter{$0.cacheStatus=="zero_in_log"}){r in
                    PointMark(x:.value("记录顺序",r.position),y:.value("tokens",0)).symbol{Circle().strokeBorder(.orange,lineWidth:1.5).frame(width:7,height:7)}
                }
                ForEach(events.filter{$0.eventType=="compaction"}){e in RuleMark(x:.value("记录顺序",e.position)).foregroundStyle(.purple.opacity(0.5)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
            }.chartXScale(domain:0...upperBound)
            .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Int.self){Text(n>=1000 ? "\(n/1000)K":"\(n)").frame(width:50,alignment:.leading)}}}}
            .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
            .chartOverlay{proxy in hoverArea(proxy,kind:.cache)}.frame(height:95)
    }
    private func hoverArea(_ proxy:ChartProxy,kind:TimelinePlotKind)->some View {
        TimelineOverlay(proxy:proxy,kind:kind,entries:entries,selection:selection)
    }
}
@MainActor private struct TimelineSpeedLabel:View {
    let entries:[TimelineEntry]
    @ObservedObject var selection:TimelineSelection
    var body:some View {Text(chosenEntry(entries,selection)?.response?.tokensPerSecond.map{String(format:"%.1f tokens/s",$0)} ?? "tokens/s").font(.caption).monospacedDigit().foregroundStyle(.secondary)}
}
@MainActor private struct TimelineOverlay:View {
    let proxy:ChartProxy;let kind:TimelinePlotKind;let entries:[TimelineEntry]
    @ObservedObject var selection:TimelineSelection
    private var focus:TimelineEntry? {entries.first{$0.position==selection.hovered} ?? entries.first{$0.id==selection.selectedID}}
    var body:some View {
        GeometryReader{geometry in
            ZStack {
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover{phase in if case .active(let location)=phase,let entry=nearest(location,geometry){selection.hover(entry.position)}}
                    .onTapGesture(coordinateSpace:.local){location in if let entry=nearest(location,geometry){selection.pin(entry.id)}}
                if let frame=proxy.plotFrame,let focus,let x=proxy.position(forX:focus.position){
                    let bounds=geometry[frame]
                    Rectangle().fill(.white.opacity(0.4)).frame(width:1,height:bounds.height).position(x:bounds.minX+x,y:bounds.midY).allowsHitTesting(false)
                    if let value=yValue(focus),let y=proxy.position(forY:value){
                        Circle().strokeBorder(.white,lineWidth:1.5).frame(width:10,height:10).position(x:bounds.minX+x,y:bounds.minY+y).allowsHitTesting(false)
                    }
                }
            }.help("悬停查看，点击固定事件")
        }
    }
    private func yValue(_ entry:TimelineEntry)->Double? {
        switch kind {case .speed:return entry.response?.tokensPerSecond;case .cache:return entry.response?.cachedInputTokens.map(Double.init);case .events:return 0}
    }
    private func nearest(_ location:CGPoint,_ geometry:GeometryProxy)->TimelineEntry? {
        guard !entries.isEmpty,let frame=proxy.plotFrame else{return nil};let bounds=geometry[frame]
        guard bounds.contains(location),let position=proxy.value(atX:location.x-bounds.minX,as:Double.self) else{return nil}
        var low=0,high=entries.count
        while low<high {let mid=(low+high)/2;if Double(entries[mid].position)<position{low=mid+1}else{high=mid}}
        if low==0{return entries[0]};if low==entries.count{return entries.last}
        return position-Double(entries[low-1].position)<=Double(entries[low].position)-position ? entries[low-1]:entries[low]
    }
}
@MainActor private struct TimelineDetails:View {
    let entries:[TimelineEntry]
    @ObservedObject var selection:TimelineSelection
    private var selected:TimelineEntry? {chosenEntry(entries,selection)}
    var body:some View {
        VStack(alignment:.leading,spacing:8){
            HStack(spacing:10){
                Picker("查看事件",selection:Binding(get:{selection.selectedID},set:{selection.pin($0)})){Text("最新事件").tag("");ForEach(entries.reversed()){entry in Text("\(entry.position) · \(entry.kind)").tag(entry.id)}}.labelsHidden().controlSize(.small).frame(width:245)
                Spacer()
                if let entry=selected{Text(entry.kind).font(.caption.weight(.medium)).foregroundStyle(eventColor(entry.eventType))}
            }
            if let entry=selected {
                if let r=entry.response{responseDetails(r)}
                else if let e=entry.event{eventDetails(e)}
            }
        }.padding(10).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10))
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
                Text(r.config.model ?? "模型未记录").foregroundStyle(.primary)
                Text("· \(r.config.effort ?? "—") · \(r.config.serviceTier ?? "—") · 窗口 \(compactTokens(r.config.contextWindow))")
                Spacer();Text(localTime(r.timestamp))
            }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
            DisclosureGroup("更多信息"){
                VStack(alignment:.leading,spacing:5){
                    if r.cacheStatus=="zero_in_log"{Text("缓存日志值为 0；这次原始响应未保存，无法区分未命中与缺失详情。").foregroundStyle(.orange)}
                    else if r.cacheStatus=="missing" || r.cacheStatus=="invalid"{Text("缓存数据未记录或无效，不按零计算。").foregroundStyle(.secondary)}
                    Text("生成用时 \(r.durationMs.map{String(format:"%.2f 秒",$0/1000)} ?? "未记录") · 生成前间隔 \(r.preGenerationGapMs.map{String(format:"≈ %.2f 秒",$0/1000)} ?? "未记录")")
                    Text("生成前间隔来自最近输入记录到首个生成项目，含客户端等待等开销，不是精确的服务器首 token 延迟。").foregroundStyle(.secondary)
                    if let parts=r.costEstimate?.breakdown {ForEach(parts){part in HStack {Text(part.label);Spacer();Text("\(part.tokens.formatted()) tokens · \(String(format:"$%.4f",part.usd))").monospacedDigit()}}}
                    Text("本次 API 估算 \(r.costEstimate?.usd.map{String(format:"$%.4f",$0)} ?? "未知") · 按配置档位")
                    Text("推理 \(tokenLabel(r.reasoningTokens)) · 缓存写入（估算） \(tokenLabel(r.costEstimate?.breakdown?.first(where:{$0.category=="cache_write"})?.tokens)) · 用时 \(r.durationMs.map{String(format:"%.2f 秒",$0/1000)} ?? "未记录")")
                    Text("压缩阈值 \(tokenLabel(r.config.compactThreshold)) · 轮次 \(r.turnId ?? "未记录")")
                }.font(.caption2).foregroundStyle(.secondary).textSelection(.enabled).padding(.top,4)
            }.font(.caption2).foregroundStyle(.secondary)
        }
    }
}
