import SwiftUI
import Charts

private func tokenLabel(_ value:Int?)->String {value.map{$0.formatted()+" tokens"} ?? "未记录"}
private func chartColor(_ category:String)->Color {
    switch category {case "tool_calls":return .blue;case "tool_results":return .cyan;case "user":return .green;case "assistant_final":return .purple;case "assistant_commentary":return .gray;case "instructions":return .orange;default:return Color(red:0.48,green:0.43,blue:0.60)}
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

struct ContextResponseChart:View {
    let responses:[ContextStatistics.Response]
    @State private var hovered:Int?
    @State private var selectedID:String=""
    private var selected:ContextStatistics.Response? {responses.first{$0.index==hovered} ?? responses.first{$0.id==selectedID} ?? responses.last}
    private var measured:[ContextStatistics.Response] {responses.filter{$0.tokensPerSecond != nil}}
    var body:some View {
        VStack(alignment:.leading,spacing:14){
            HStack {Text("每次响应的输出速度").font(.headline);Spacer();Text("\(measured.count) / \(responses.count) 次有计时").font(.caption).foregroundStyle(.secondary)}
            if measured.isEmpty {Text("已有响应保留在下方；尚无完整的输出计时。").font(.callout).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:130)}
            else {speedChart}
            Text("横轴为本聊天的模型响应序号，一轮对话可能包含多次响应。速度为输出 token ÷ 从首个生成项目开始到用量记录的时间，含推理与工具参数生成，不含工具执行；属于观测平均值。").font(.caption).foregroundStyle(.secondary)
            if !responses.isEmpty {
                cacheChart
                HStack {Text("查看响应").font(.caption);Picker("查看响应",selection:$selectedID){Text("最新响应").tag("");ForEach(responses.reversed()){r in Text("#\(r.index) · \(r.kind)").tag(r.id)}}.labelsHidden().frame(width:240);Spacer();Text("悬停白色节点查看详情").font(.caption).foregroundStyle(.secondary)}
                if let r=selected{responseDetails(r)}
            }
        }.padding(16).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
    }
    private var speedChart:some View {
        Chart {
            ForEach(measured){r in
                LineMark(x:.value("响应",r.index),y:.value("tokens/s",r.tokensPerSecond!),series:.value("连续片段",r.segment)).foregroundStyle(.white.opacity(0.35))
                PointMark(x:.value("响应",r.index),y:.value("tokens/s",r.tokensPerSecond!)).foregroundStyle(.white).symbolSize(hovered==r.index ? 85:28)
            }
            if let hovered {RuleMark(x:.value("响应",hovered)).foregroundStyle(.white.opacity(0.2))}
        }
        .chartXScale(domain:0...max(2,responses.count+1)).chartYAxisLabel("tokens/s")
        .chartOverlay{proxy in hoverArea(proxy)}.frame(height:210)
    }
    private var cacheChart:some View {
        VStack(alignment:.leading,spacing:6){
            Text("缓存命中与请求输入").font(.caption).foregroundStyle(.secondary)
            Chart {
                ForEach(responses){r in
                    if let input=r.inputTokens{LineMark(x:.value("响应",r.index),y:.value("tokens",input),series:.value("类型","input")).foregroundStyle(.gray.opacity(0.6))}
                    if let cache=r.cachedInputTokens{LineMark(x:.value("响应",r.index),y:.value("tokens",cache),series:.value("类型","cache")).foregroundStyle(.cyan)}
                }
                if let hovered {RuleMark(x:.value("响应",hovered)).foregroundStyle(.white.opacity(0.3))}
            }.chartXScale(domain:0...max(2,responses.count+1)).chartOverlay{proxy in hoverArea(proxy)}.frame(height:110)
            Text("青色：缓存命中　灰色：输入总量；命中量是输入的子集").font(.caption2).foregroundStyle(.secondary)
        }
    }
    private func hoverArea(_ proxy:ChartProxy)->some View {
        GeometryReader{geometry in Rectangle().fill(.clear).contentShape(Rectangle()).onContinuousHover{phase in
            switch phase {case .active(let location):
                if let frame=proxy.plotFrame {let bounds=geometry[frame];if bounds.contains(location),let index=proxy.value(atX:location.x-bounds.minX,as:Double.self){hovered=max(1,min(responses.count,Int(index.rounded())))}else{hovered=nil}}
            case .ended:hovered=nil}
        }}
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
