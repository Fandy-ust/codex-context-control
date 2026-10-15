import SwiftUI
import Charts

private func tokenLabel(_ value:Int?)->String {value.map{$0.formatted()+" tokens"} ?? "未记录"}
private func eventColor(_ type:String)->Color {
    switch type {case "final":return .blue;case "user_input","steering":return .green;case "compaction":return .purple;default:return Color(white:0.78)}
}
struct ContextResponseChart:View {
    let responses:[ContextStatistics.Response]
    let events:[ContextStatistics.TimelineEvent]
    @State private var hovered:Int?
    @State private var selectedID:String=""
    private struct Entry:Identifiable {
        let id:String;let position:Int;let kind:String;let eventType:String
        let response:ContextStatistics.Response?;let event:ContextStatistics.TimelineEvent?
    }
    private var entries:[Entry] {
        let output=responses.map{Entry(id:$0.id,position:$0.position,kind:"响应 #\($0.index) · \($0.kind)",eventType:$0.eventType,response:$0,event:nil)}
        let input=events.map{Entry(id:$0.id,position:$0.position,kind:$0.kind,eventType:$0.eventType,response:nil,event:$0)}
        return (output+input).sorted{$0.position<$1.position}
    }
    private var selected:Entry? {entries.first{$0.position==hovered} ?? entries.first{$0.id==selectedID} ?? entries.last}
    private var focusPosition:Int? {hovered ?? entries.first{$0.id==selectedID}?.position}
    private var measured:[ContextStatistics.Response] {responses.filter{$0.tokensPerSecond != nil}}
    private var upperBound:Int {max(2,(entries.last?.position ?? 0)+1)}
    var body:some View {
        VStack(alignment:.leading,spacing:10){
            HStack {Text("对话趋势").font(.headline);Spacer();Text("\(measured.count)/\(responses.count) 次响应有计时").font(.caption).foregroundStyle(.secondary)}
            VStack(alignment:.leading,spacing:6){
                HStack {Text("输出速度").font(.caption.weight(.medium));Spacer();Text(selected?.response?.tokensPerSecond.map{String(format:"%.1f tokens/s",$0)} ?? "tokens/s").font(.caption).monospacedDigit().foregroundStyle(.secondary)}
                if measured.isEmpty {Text("暂无完整计时").font(.caption).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:100)}
                else {speedChart}
                HStack(spacing:12){Text("输入与缓存").font(.caption.weight(.medium));Spacer();HStack(spacing:4){Circle().fill(.gray).frame(width:5,height:5);Text("输入")};HStack(spacing:4){Circle().fill(.cyan).frame(width:5,height:5);Text("缓存命中")}}.font(.caption2).foregroundStyle(.secondary)
                cacheChart
                HStack(spacing:12){Text("对话事件").font(.caption.weight(.medium));Spacer();legend("中间",type:"intermediate");legend("最终",type:"final");legend("输入",type:"steering");legend("压缩",type:"compaction")}
                eventTrack
            }
            if !entries.isEmpty {
                VStack(alignment:.leading,spacing:8){
                    HStack(spacing:10){
                        Picker("查看事件",selection:$selectedID){Text("最新事件").tag("");ForEach(entries.reversed()){entry in Text("\(entry.position) · \(entry.kind)").tag(entry.id)}}.labelsHidden().controlSize(.small).frame(width:245)
                        Spacer()
                        if let entry=selected{Text(entry.kind).font(.caption.weight(.medium)).foregroundStyle(eventColor(entry.eventType))}
                    }
                    if let entry=selected {
                        if let r=entry.response {responseDetails(r)}
                        else if let e=entry.event {eventDetails(e)}
                    }
                }.padding(10).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10))
            }
            DisclosureGroup("统计说明"){
                Text("横轴按记录顺序；悬停联动，点击固定。速度为观测平均值；缓存命中属于输入量。输入、压缩不计速度。图表用于对照变化，不单独判断因果。")
                    .font(.caption).foregroundStyle(.secondary).padding(.top,5)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(14).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
        .onHover{inside in if !inside{hovered=nil}}
        .onChange(of:selectedID){_,_ in hovered=nil}
    }
    private func legend(_ label:String,type:String)->some View {
        HStack(spacing:5){Circle().fill(eventColor(type)).frame(width:7,height:7);Text(label)}.font(.caption).foregroundStyle(.secondary)
    }
    private var speedChart:some View {
        Chart {
            ForEach(measured){r in
                LineMark(x:.value("记录顺序",r.position),y:.value("tokens/s",r.tokensPerSecond!),series:.value("连续片段",r.segment)).foregroundStyle(.white.opacity(0.22))
                PointMark(x:.value("记录顺序",r.position),y:.value("tokens/s",r.tokensPerSecond!)).foregroundStyle(eventColor(r.eventType)).symbolSize(focusPosition==r.position ? 90:r.eventType=="final" ? 55:25)
            }
            ForEach(events.filter{$0.eventType=="compaction"}){e in RuleMark(x:.value("记录顺序",e.position)).foregroundStyle(.purple.opacity(0.35)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
            if let hovered=focusPosition {RuleMark(x:.value("记录顺序",hovered)).foregroundStyle(.white.opacity(0.4))}
        }
        .chartXScale(domain:0...upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Double.self){Text(n.formatted(.number.precision(.fractionLength(0...1)))).frame(width:50,alignment:.leading)}}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
        .chartOverlay{proxy in hoverArea(proxy)}.frame(height:165)
    }
    private var eventTrack:some View {
        Chart {
                ForEach(responses){r in PointMark(x:.value("记录顺序",r.position),y:.value("事件",0)).foregroundStyle(eventColor(r.eventType)).symbolSize(focusPosition==r.position ? 90:r.eventType=="final" ? 55:18)}
                ForEach(events){e in
                    if e.eventType=="compaction" {PointMark(x:.value("记录顺序",e.position),y:.value("事件",0)).symbol(.square).foregroundStyle(.purple).symbolSize(focusPosition==e.position ? 110:65)}
                    else {PointMark(x:.value("记录顺序",e.position),y:.value("事件",0)).symbol(.diamond).foregroundStyle(.green).symbolSize(focusPosition==e.position ? 100:55)}
                }
                if let hovered=focusPosition {RuleMark(x:.value("记录顺序",hovered)).foregroundStyle(.white.opacity(0.2))}
            }.chartXScale(domain:0...upperBound).chartYScale(domain:-1...1).chartYAxis{AxisMarks(position:.trailing,values:[0]){_ in AxisValueLabel{Text(" ").frame(width:50,alignment:.leading).accessibilityHidden(true)}}}
                .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08));AxisValueLabel()}}
                .chartOverlay{proxy in hoverArea(proxy)}.frame(height:36)
    }
    private var cacheChart:some View {
        Chart {
                ForEach(responses){r in
                    if let input=r.inputTokens{LineMark(x:.value("记录顺序",r.position),y:.value("tokens",input),series:.value("类型","input")).foregroundStyle(.gray.opacity(0.6))}
                    if let cache=r.cachedInputTokens{LineMark(x:.value("记录顺序",r.position),y:.value("tokens",cache),series:.value("类型","cache")).foregroundStyle(.cyan)}
                }
                ForEach(events.filter{$0.eventType=="compaction"}){e in RuleMark(x:.value("记录顺序",e.position)).foregroundStyle(.purple.opacity(0.5)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
                if let hovered=focusPosition {RuleMark(x:.value("记录顺序",hovered)).foregroundStyle(.white.opacity(0.3))}
            }.chartXScale(domain:0...upperBound)
            .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Int.self){Text(n>=1000 ? "\(n/1000)K":"\(n)").frame(width:50,alignment:.leading)}}}}
            .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
            .chartOverlay{proxy in hoverArea(proxy)}.frame(height:95)
    }
    private func hoverArea(_ proxy:ChartProxy)->some View {
        GeometryReader{geometry in Rectangle().fill(.clear).contentShape(Rectangle())
            .onContinuousHover{phase in
                if case .active(let location)=phase,let entry=nearestEntry(location,proxy:proxy,geometry:geometry){hovered=entry.position}
            }
            .onTapGesture(coordinateSpace:.local){location in
                if let entry=nearestEntry(location,proxy:proxy,geometry:geometry){selectedID=entry.id}
            }
            .help("悬停查看，点击固定事件")
        }
    }
    private func nearestEntry(_ location:CGPoint,proxy:ChartProxy,geometry:GeometryProxy)->Entry? {
        guard let frame=proxy.plotFrame else{return nil};let bounds=geometry[frame]
        guard bounds.contains(location),let index=proxy.value(atX:location.x-bounds.minX,as:Double.self) else{return nil}
        return entries.min{abs(Double($0.position)-index)<abs(Double($1.position)-index)}
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
                field("速度 · tokens/s",r.tokensPerSecond.map{String(format:"%.1f",$0)} ?? "—")
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
                    if let parts=r.costEstimate?.breakdown {ForEach(parts){part in HStack {Text(part.label);Spacer();Text("\(part.tokens.formatted()) tokens · \(String(format:"$%.4f",part.usd))").monospacedDigit()}}}
                    if r.cacheWriteTokens==0 {Text("写入量采用上游计量；Codex 实测零值不能代表物理缓存没有增长。").foregroundStyle(.orange)}
                    Text("本次官方 API 折算 \(r.costEstimate?.usd.map{String(format:"$%.4f",$0)} ?? "未知") · 按配置档位")
                    Text("推理 \(tokenLabel(r.reasoningTokens)) · 缓存写入 \(tokenLabel(r.cacheWriteTokens)) · 用时 \(r.durationMs.map{String(format:"%.2f 秒",$0/1000)} ?? "未记录")")
                    Text("压缩阈值 \(tokenLabel(r.config.compactThreshold)) · 轮次 \(r.turnId ?? "未记录")")
                }.font(.caption2).foregroundStyle(.secondary).textSelection(.enabled).padding(.top,4)
            }.font(.caption2).foregroundStyle(.secondary)
        }
    }
}
