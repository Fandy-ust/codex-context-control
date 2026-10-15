import SwiftUI
import Charts

private func tokenLabel(_ value:Int?)->String {value.map{$0.formatted()+" tokens"} ?? "未记录"}
private func chartColor(_ category:String)->Color {
    switch category {case "tool_calls":return .blue;case "tool_results":return .cyan;case "user":return .green;case "assistant_final":return .blue;case "assistant_commentary":return .gray;case "instructions":return .orange;default:return Color(red:0.48,green:0.43,blue:0.60)}
}
struct ContextCategoryChart:View {
    let statistics:ContextStatistics
    @State private var selected:String?
    private struct Bar:Identifiable {let id:String;let title:String;let tokens:Int;let count:Int}
    private var bars:[Bar] {
        let short=["tool_calls":"工具调用","tool_results":"工具返回","user":"用户消息","assistant_final":"最终回复","assistant_commentary":"进度说明","instructions":"指令与摘要"]
        var result=statistics.categories.map{Bar(id:$0.category,title:short[$0.category] ?? $0.label,tokens:$0.tokensEstimate,count:$0.items)}
        if let tokens=statistics.unclassified.tokensEstimate {result.append(Bar(id:"other",title:"其他／未分项",tokens:tokens,count:statistics.unclassified.opaqueItems))}
        return result
    }
    var body:some View {
        VStack(alignment:.leading,spacing:10){
            Text("上下文分类分布").font(.headline)
            Chart(bars){bar in
                BarMark(x:.value("分类",bar.title),y:.value("token 占用",bar.tokens))
                    .foregroundStyle(chartColor(bar.id).opacity(selected==nil || selected==bar.title ? 1:0.4)).cornerRadius(5)
                    .accessibilityLabel(bar.title).accessibilityValue("约 \(bar.tokens) tokens，\(bar.count) 条")
            }
            .chartYAxisLabel("tokens · 估算").chartYAxis{AxisMarks{value in AxisGridLine();AxisValueLabel{if let n=value.as(Int.self){Text(n>=1000 ? "\(n/1000)K":"\(n)")}}}}
            .chartOverlay{proxy in GeometryReader{geometry in Rectangle().fill(.clear).contentShape(Rectangle()).onContinuousHover{phase in
                switch phase {case .active(let location):if let frame=proxy.plotFrame {let bounds=geometry[frame];selected=bounds.contains(location) ? proxy.value(atX:location.x-bounds.minX,as:String.self):nil};case .ended:selected=nil}
            }}}
            .frame(height:230)
            Group {if let bar=bars.first(where:{$0.title==selected}){Text("\(bar.title) · 约 \(tokenLabel(bar.tokens)) · \(bar.count) 条\(bar.id=="other" ? "已识别不透明项目":"")")}else{Text("将鼠标移到柱形上查看占用与条目数量")}}.font(.caption).foregroundStyle(.secondary).frame(height:20,alignment:.leading)
        }
    }
}

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
    private var measured:[ContextStatistics.Response] {responses.filter{$0.tokensPerSecond != nil}}
    private var upperBound:Int {max(2,(entries.last?.position ?? 0)+1)}
    var body:some View {
        VStack(alignment:.leading,spacing:14){
            HStack {Text("对话时间线与输出速度（tokens/s）").font(.headline);Spacer();Text("\(measured.count) / \(responses.count) 次响应有计时").font(.caption).foregroundStyle(.secondary)}
            HStack(spacing:18){legend("中间响应",type:"intermediate");legend("最终回复",type:"final");legend("用户输入／追加",type:"steering");legend("压缩",type:"compaction")}
            if measured.isEmpty {Text("已有输入与响应保留在事件轨道；尚无完整的输出计时。").font(.callout).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:130)}
            else {speedChart}
            if !entries.isEmpty {
                eventTrack
                Text("各图横轴对齐本地记录顺序，并非等长时间间隔。绿色菱形为用户输入；同一轮内再次加入的消息标为追加输入。紫色方形为压缩完成。输入与压缩事件没有输出速度。").font(.caption).foregroundStyle(.secondary)
                cacheChart
                HStack {Text("查看事件").font(.caption);Picker("查看事件",selection:$selectedID){Text("最新事件").tag("");ForEach(entries.reversed()){entry in Text("\(entry.position) · \(entry.kind)").tag(entry.id)}}.labelsHidden().frame(width:300);Spacer();Text("悬停节点或事件查看详情").font(.caption).foregroundStyle(.secondary)}
                if let entry=selected {
                    if let r=entry.response {responseDetails(r)}
                    else if let e=entry.event {eventDetails(e)}
                }
            }
            Text("速度是输出 token ÷ 从首个生成项目开始到用量记录的时间，含推理与工具参数生成，不含后续工具执行；属于观测平均值。一轮用户消息可能对应多次模型响应。").font(.caption).foregroundStyle(.secondary)
        }.padding(16).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
    }
    private func legend(_ label:String,type:String)->some View {
        HStack(spacing:5){Circle().fill(eventColor(type)).frame(width:7,height:7);Text(label)}.font(.caption).foregroundStyle(.secondary)
    }
    private var speedChart:some View {
        Chart {
            ForEach(measured){r in
                LineMark(x:.value("记录顺序",r.position),y:.value("tokens/s",r.tokensPerSecond!),series:.value("连续片段",r.segment)).foregroundStyle(.white.opacity(0.22))
                PointMark(x:.value("记录顺序",r.position),y:.value("tokens/s",r.tokensPerSecond!)).foregroundStyle(eventColor(r.eventType)).symbolSize(hovered==r.position ? 90:r.eventType=="final" ? 55:25)
            }
            if let hovered {RuleMark(x:.value("记录顺序",hovered)).foregroundStyle(.white.opacity(0.2))}
        }
        .chartXScale(domain:0...upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Double.self){Text(n.formatted(.number.precision(.fractionLength(0...1)))).frame(width:50,alignment:.leading)}}}}
        .chartOverlay{proxy in hoverArea(proxy)}.frame(height:210)
    }
    private var eventTrack:some View {
        VStack(alignment:.leading,spacing:5){
            Text("对话事件 · 包含无计时的响应").font(.caption).foregroundStyle(.secondary)
            Chart {
                ForEach(responses){r in PointMark(x:.value("记录顺序",r.position),y:.value("事件",0)).foregroundStyle(eventColor(r.eventType)).symbolSize(hovered==r.position ? 90:r.eventType=="final" ? 55:18)}
                ForEach(events){e in
                    if e.eventType=="compaction" {PointMark(x:.value("记录顺序",e.position),y:.value("事件",0)).symbol(.square).foregroundStyle(.purple).symbolSize(hovered==e.position ? 110:65)}
                    else {PointMark(x:.value("记录顺序",e.position),y:.value("事件",0)).symbol(.diamond).foregroundStyle(.green).symbolSize(hovered==e.position ? 100:55)}
                }
                if let hovered {RuleMark(x:.value("记录顺序",hovered)).foregroundStyle(.white.opacity(0.2))}
            }.chartXScale(domain:0...upperBound).chartYScale(domain:-1...1).chartYAxis{AxisMarks(position:.trailing,values:[0]){_ in AxisValueLabel{Text(" ").frame(width:50,alignment:.leading).accessibilityHidden(true)}}}
                .chartOverlay{proxy in hoverArea(proxy)}.frame(height:55)
        }
    }
    private var cacheChart:some View {
        VStack(alignment:.leading,spacing:6){
            Text("缓存命中与请求输入").font(.caption).foregroundStyle(.secondary)
            Chart {
                ForEach(responses){r in
                    if let input=r.inputTokens{LineMark(x:.value("记录顺序",r.position),y:.value("tokens",input),series:.value("类型","input")).foregroundStyle(.gray.opacity(0.6))}
                    if let cache=r.cachedInputTokens{LineMark(x:.value("记录顺序",r.position),y:.value("tokens",cache),series:.value("类型","cache")).foregroundStyle(.cyan)}
                }
                ForEach(events.filter{$0.eventType=="compaction"}){e in RuleMark(x:.value("记录顺序",e.position)).foregroundStyle(.purple.opacity(0.5)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
                if let hovered {RuleMark(x:.value("记录顺序",hovered)).foregroundStyle(.white.opacity(0.3))}
            }.chartXScale(domain:0...upperBound)
            .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Int.self){Text(n>=1000 ? "\(n/1000)K":"\(n)").frame(width:50,alignment:.leading)}}}}
            .chartOverlay{proxy in hoverArea(proxy)}.frame(height:110)
            Text("青色：缓存命中　灰色：输入总量　紫色虚线：压缩完成；命中量是输入的子集").font(.caption2).foregroundStyle(.secondary)
        }
    }
    private func hoverArea(_ proxy:ChartProxy)->some View {
        GeometryReader{geometry in Rectangle().fill(.clear).contentShape(Rectangle()).onContinuousHover{phase in
            switch phase {case .active(let location):
                if let frame=proxy.plotFrame {let bounds=geometry[frame];if bounds.contains(location),let index=proxy.value(atX:location.x-bounds.minX,as:Double.self){hovered=entries.min{abs(Double($0.position)-index)<abs(Double($1.position)-index)}?.position}else{hovered=nil}}
            case .ended:hovered=nil}
        }}
    }
    private func eventDetails(_ e:ContextStatistics.TimelineEvent)->some View {
        VStack(alignment:.leading,spacing:8){
            Text("记录 \(e.position) · \(e.kind) · \(e.timestamp)").font(.caption.weight(.semibold)).foregroundStyle(eventColor(e.eventType))
            if e.eventType=="compaction" {
                Text("已用压缩后的历史替换此前上下文；保留 \(e.retainedItems.map{String($0)} ?? "未知") 个项目。")
                Text("这是压缩完成事件，不额外叠加一份 token 用量，也不把缓存变化视为精确压缩量。")
            }else{
                Text("用户文本约 \(tokenLabel(e.tokensEstimate)) · 附带 \(e.images) 张图片（图片 token 未单独计量）")
                Text(e.eventType=="steering" ? "这条消息在同一轮已有输入或模型输出后加入，作为独立用户消息进入上下文；未并入工具返回。":"这是独立用户输入；环境注入和明文压缩摘要不计入用户事件。")
            }
            Text("对话轮次 \(e.turnId ?? "未记录")").foregroundStyle(.tertiary)
        }.font(.caption).frame(maxWidth:.infinity,alignment:.leading).padding(12).background(eventColor(e.eventType).opacity(0.08),in:RoundedRectangle(cornerRadius:10))
    }
    private func responseDetails(_ r:ContextStatistics.Response)->some View {
        VStack(alignment:.leading,spacing:8){
            Text("#\(r.index) · \(r.kind) · \(r.timestamp)").font(.caption.weight(.semibold))
            Text("输出 \(tokenLabel(r.outputTokens))　其中推理 \(tokenLabel(r.reasoningTokens))　速度 \(r.tokensPerSecond.map{String(format:"%.1f tokens/s",$0)} ?? "暂无计时")")
            Text("缓存命中 \(tokenLabel(r.cachedInputTokens))　变化 \(r.cacheDelta.map{($0>=0 ? "+":"")+$0.formatted()} ?? "无上次记录")　命中率 \(r.cacheHitRate.map{String(format:"%.1f%%",$0*100)} ?? "未记录")")
            Text("输入 \(tokenLabel(r.inputTokens))　缓存写入 \(tokenLabel(r.cacheWriteTokens))　观测时长 \(r.durationMs.map{String(format:"%.2f 秒",$0/1000)} ?? "未记录")")
            Text("模型 \(r.config.model ?? "未记录") · 推理 \(r.config.effort ?? "未记录") · 服务 \(r.config.serviceTier ?? "未记录")")
            Text("当时可用窗口 \(tokenLabel(r.config.contextWindow)) · 压缩阈值 \(tokenLabel(r.config.compactThreshold))")
            Text("对话轮次 \(r.turnId ?? "未记录")").foregroundStyle(.tertiary)
        }.font(.caption).monospacedDigit().frame(maxWidth:.infinity,alignment:.leading).padding(12).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10))
    }
}
