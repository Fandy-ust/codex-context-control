import SwiftUI
import Charts

struct ContextStatistics:Decodable,Sendable {
    struct Category:Decodable,Sendable,Identifiable {let category:String;let label:String;let items:Int;let tokensEstimate:Int;let images:Int;var id:String{category}}
    struct Tool:Decodable,Sendable,Identifiable {let name:String;let count:Int;var id:String{name}}
    struct Unclassified:Decodable,Sendable {let tokensEstimate:Int?;let status:String;let opaqueItems:Int;let images:Int;let reasoningItems:Int;let compactionItems:Int}
    let threadId:String;let generatedAt:String;let snapshotAt:String?;let snapshotKind:String;let model:String?
    struct CostPart:Decodable,Sendable,Identifiable {let category:String;let label:String;let tokens:Int;let usd:Double;var id:String{category}}
    struct Cost:Decodable,Sendable {
        let breakdown:[CostPart]
        struct Group:Decodable,Sendable,Identifiable {let model:String;let tier:String;let requests:Int;let usd:Double;var id:String{model+":"+tier}}
        let usd:Double?;let upperUSD:Double?;let maxWriteSurcharge:Double;let extraWriteTokens:Int;let pricedRequests:Int;let totalRequests:Int;let unpricedRequests:Int
        let unknownTier:Int;let unknownModel:Int;let unknownUsage:Int;let unsupportedRate:Int;let longContextCount:Int;let unverifiedWriteRequests:Int
        let standardUSD:Double?;let fastUSD:Double?;let standardUpperUSD:Double?;let fastUpperUSD:Double?;let comparisonRequests:Int;let groups:[Group];let checkedAt:String;let source:String
    }
    let cost:Cost
    struct Response:Decodable,Sendable,Identifiable {
        struct Estimate:Decodable,Sendable {let usd:Double?;let upperUSD:Double?;let reason:String?;let tier:String?;let contextBand:String?;let writeEstimated:Bool?;let breakdown:[CostPart]?}
        let costEstimate:Estimate?
        struct Config:Decodable,Sendable {let model:String?;let effort:String?;let serviceTier:String?;let contextWindow:Int?;let compactThreshold:Int?}
        let id:String;let index:Int;let position:Int;let eventType:String;let timestamp:String;let turnId:String?;let kind:String
        let inputTokens:Int?;let outputTokens:Int?;let reasoningTokens:Int?;let cachedInputTokens:Int?;let cacheWriteTokens:Int?;let cacheDelta:Int?;let cacheHitRate:Double?
        let durationMs:Double?;let preGenerationGapMs:Double?;let recordToCompletionMs:Double?;let cacheStatus:String;let cacheSegment:Int;let inputSegment:Int;let tokensPerSecond:Double?;let timingKind:String;let segment:Int;let config:Config
    }
    struct TimelineEvent:Decodable,Sendable,Identifiable {
        let id:String;let position:Int;let timestamp:String;let turnId:String?;let eventType:String;let kind:String
        let tokensEstimate:Int?;let images:Int;let retainedItems:Int?;let responseId:String?
    }
    let timelineEvents:[TimelineEvent]
    let responses:[Response];let cachedInputTokens:Int?;let cacheWriteTokens:Int?
    let inputTokens:Int?;let visibleTokens:Int;let unclassified:Unclassified
    let categories:[Category];let toolCalls:[Tool];let reasoningGenerated:Int;let sampledResponses:Int
    let compactionCount:Int;let plaintextSummaryItems:Int;let tokenizer:String;let notes:[String]
}

struct ContextDetailsButton:View {
    let chatID:String;let title:String
    @ObservedObject var model:Controller
    @State private var showing=false
    var body:some View {
        Button {showing=true} label:{Label("上下文详情",systemImage:"chart.bar.xaxis")}
            .buttonStyle(.bordered).help("查看这个聊天的分类用量和消息数量")
            .sheet(isPresented:$showing){ContextDetailsView(chatID:chatID,title:title,model:model)}
    }
}

private struct ContextDetailsView:View {
    let chatID:String;let title:String
    let model:Controller
    @Environment(\.dismiss) private var dismiss
    @State private var statistics:ContextStatistics?
    @State private var loading=false
    @State private var error:String?
    @State private var autoRefresh=true
    @State private var lastPayload:Data?
    var body:some View {
        VStack(alignment:.leading,spacing:16){
            HStack(alignment:.top){
                VStack(alignment:.leading,spacing:5){Text("上下文详情").font(.title2.weight(.semibold));Text(title).font(.callout).foregroundStyle(.secondary).lineLimit(1)}
                Spacer()
                if loading{ProgressView().controlSize(.small)}
                Button("刷新",systemImage:"arrow.clockwise"){Task{await reload(force:true)}}.disabled(loading)
                Button("完成"){dismiss()}.keyboardShortcut(.cancelAction)
            }
            HStack {Text(statistics.map{ $0.snapshotKind=="last_request" ? "最近请求快照 · \(timestamp($0.snapshotAt))":"本地保留历史 · 尚无可对齐用量" } ?? "正在读取所选聊天…").font(.caption).foregroundStyle(.secondary);Spacer();Toggle("自动刷新",isOn:$autoRefresh).toggleStyle(.switch).controlSize(.small).font(.caption)}
            if let error{Label(error,systemImage:"exclamationmark.circle").font(.callout).foregroundStyle(.orange)}
            ScrollView {
                if let s=statistics {
                    VStack(alignment:.leading,spacing:16){
                        ContextSummaryView(statistics:s)
                        ContextResponseChart(responses:s.responses,events:s.timelineEvents,revision:s.threadId+":"+s.generatedAt).equatable()
                        VStack(spacing:0){
                            HStack {Text("分类");Spacer();Text("条目").frame(width:65,alignment:.trailing);Text("占用（估算）").frame(width:115,alignment:.trailing)}.font(.caption).foregroundStyle(.secondary).padding(.bottom,8)
                            ForEach(s.categories){row in
                                HStack {Circle().fill(color(row.category)).frame(width:7,height:7);Text(row.label).font(.callout);if row.images>0{Text("含 \(row.images) 张图片").font(.caption).foregroundStyle(.secondary)};Spacer();Text("\(row.items)").frame(width:65,alignment:.trailing);Text("≈ \(amount(row.tokensEstimate))").frame(width:115,alignment:.trailing)}.monospacedDigit().padding(.vertical,10)
                                Divider().opacity(0.4)
                            }
                            HStack {Circle().fill(color("other")).frame(width:7,height:7);Text("其他／未分项");Spacer();Text("\(s.unclassified.opaqueItems) 项*").frame(width:65,alignment:.trailing);Text(s.unclassified.tokensEstimate.map{"≈ \(amount($0))"} ?? "无法对齐").frame(width:115,alignment:.trailing)}.font(.callout).monospacedDigit().padding(.vertical,10)
                        }
                        Text("* 已识别 \(s.unclassified.reasoningItems) 个推理项目、\(s.unclassified.compactionItems) 个不透明压缩项目；另有 \(s.unclassified.images) 张图片（已包含在消息内）。").font(.caption).foregroundStyle(.secondary)
                        if s.unclassified.status=="estimate_exceeds_input"{Text("文本估算超过请求输入量，暂不显示差额；不会将它当作零占用。").font(.caption).foregroundStyle(.orange)}
                        DisclosureGroup("各工具调用次数"){
                            VStack(spacing:9){ForEach(s.toolCalls){tool in HStack{Text(tool.name).font(.system(.caption,design:.monospaced));Spacer();Text("\(tool.count) 次").monospacedDigit()}}}.padding(.top,12)
                        }
                        DisclosureGroup("推理生成统计与统计口径"){
                            VStack(alignment:.leading,spacing:10){
                                Text("本次压缩后、快照之前记录了 \(s.sampledResponses) 次响应，生成推理 \(amount(s.reasoningGenerated))。这是生成量，不是当前保留的推理占用。")
                                Text("普通文本摘要已并入文本，只计一次；不透明压缩内容已合并到其他。此快照包含 \(s.plaintextSummaryItems) 条普通文本摘要。")
                                ForEach(s.notes,id:\.self){Text($0)}
                                Text("\(s.tokenizer)。统计在本机进行，不保存消息或推理正文。")
                                Link("了解压缩摘要",destination:URL(string:"https://developers.openai.com/api/docs/guides/compaction")!)
                            }.font(.caption).foregroundStyle(.secondary).padding(.top,12)
                        }
                    }.padding(.vertical,6).padding(.trailing,8)
                }else if !loading{ContentUnavailableView("暂无上下文统计",systemImage:"chart.bar.xaxis",description:Text("这个聊天需要有本地记录。正常交互后点击刷新。"))}
            }
        }
        .padding(26).frame(width:920,height:720).background(Color(white:0.095)).preferredColorScheme(.dark)
        .task(id:chatID){
            await reload(force:false)
            while !Task.isCancelled {do{try await Task.sleep(for:.seconds(10))}catch{break};if autoRefresh{await reload(force:false)}}
        }
    }
    private func reload(force:Bool) async {
        if loading{return};loading=true;defer{loading=false}
        do {
            let data=try await model.api("/context-stats",body:["id":chatID,"refresh":force])
            if data==lastPayload{error=nil;return}
            let decoded=try await Task.detached(priority:.utility){try JSONDecoder().decode(ContextStatistics.self,from:data)}.value
            guard !Task.isCancelled,decoded.threadId==chatID else{return}
            statistics=decoded;lastPayload=data;error=nil
        }catch {if !Task.isCancelled{self.error=error.localizedDescription}}
    }
    private func amount(_ n:Int)->String {n>=1000 ? (Double(n)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":n.formatted()}
    private func color(_ category:String)->Color {switch category{case "tool_calls":return .blue;case "tool_results":return .cyan;case "user":return .green;case "assistant_final":return .blue;case "assistant_commentary":return .gray;case "instructions":return .orange;default:return Color(red:0.48,green:0.43,blue:0.60)}}
    private func timestamp(_ text:String?)->String {
        guard let text else{return "待观测"};let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        guard let date=formatter.date(from:text) else{return text}
        return date.formatted(date:.abbreviated,time:.standard)
    }
}


struct ContextSummaryView:View {
    let statistics:ContextStatistics
    private func amount(_ n:Int?)->String {n.map{ $0>=1000000 ? (Double($0)/1000000).formatted(.number.precision(.fractionLength(0...2)))+"M":$0>=1000 ? (Double($0)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":$0.formatted()} ?? "待观测"}
    private func money(_ n:Double?)->String {n.map{String(format:"$%.2f",$0)} ?? "待估算"}
    private func tierName(_ tier:String)->String {switch tier{case "fast":return "Fast";case "standard":return "Standard";case "ultrafast":return "Ultrafast";case "flex":return "Flex";default:return tier}}
    var body:some View {
        VStack(alignment:.leading,spacing:12){
            HStack(spacing:12){
                metric("活跃上下文",statistics.inputTokens).help("最近一次请求的输入总量，包含缓存命中部分；不是窗口容量上限")
                metric("缓存命中",statistics.cachedInputTokens).help("最近请求复用的输入 token，已包含在活跃上下文内")
            }
            costCard
        }
    }
    private func metric(_ title:String,_ value:Int?)->some View {
        VStack(alignment:.leading,spacing:8){Text(title).font(.caption).foregroundStyle(.secondary);Text(amount(value)).font(.system(size:25,weight:.medium,design:.rounded)).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading).padding(16).background(.white.opacity(0.05),in:RoundedRectangle(cornerRadius:14))
    }
    private var costCard:some View {
        let cost=statistics.cost
        return VStack(alignment:.leading,spacing:9){
            HStack(alignment:.firstTextBaseline){
                Text("本聊天费用 · API 估算").font(.callout.weight(.medium));Spacer()
                if cost.unpricedRequests>0{Text("可估部分").font(.caption).foregroundStyle(.secondary)}
                Text((cost.usd != nil ? "≈ ":"")+money(cost.usd)).font(.system(size:23,weight:.medium,design:.rounded)).monospacedDigit()
            }
            HStack {Text("按配置 · 已估 \(cost.pricedRequests)/\(cost.totalRequests) 次 · 非实际账单");Spacer();Text("USD")}.font(.caption2).foregroundStyle(.secondary)
            HStack(spacing:12){ForEach(cost.breakdown){part in
                VStack(alignment:.leading,spacing:3){Text(part.category=="cache_write" ? "缓存写入 · 估算":part.label).font(.caption2).foregroundStyle(.secondary);Text(cost.pricedRequests>0 ? amount(part.tokens):"—").font(.callout).monospacedDigit();Text(cost.pricedRequests>0 ? money(part.usd):"—").font(.caption2).foregroundStyle(.secondary).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)
            }}.padding(.vertical,3)
            DisclosureGroup("官方公式与计价明细"){
                VStack(alignment:.leading,spacing:8){
                    Text("新增写入按未命中输入估算，使用官方单价。")
                    Text("普通输入 = 总输入 − 缓存读取 − 缓存写入")
                    Text("费用 =（普通输入 × 输入价 + 缓存读取 × 读取价 + 缓存写入 × 写入价 + 输出 × 输出价）÷ 1,000,000")
                    Link("OpenAI 官方 calculateInputCost",destination:URL(string:"https://developers.openai.com/api/docs/guides/prompt-caching#monitor-cache-performance")!)
                    Text("四项按官方公式计费。估算写入对应的 token 已从普通输入扣除，不重复收费。")
                    ForEach(cost.groups){group in HStack {Text("\(group.model) · \(tierName(group.tier))");Spacer();Text("\(group.requests) 次 · \(money(group.usd))").monospacedDigit()}}
                    if cost.unpricedRequests>0{Text("未计入：档位未知 \(cost.unknownTier) · 模型价格未知 \(cost.unknownModel) · 用量缺失 \(cost.unknownUsage) · 不支持的费率 \(cost.unsupportedRate)").foregroundStyle(.orange)}
                    if cost.comparisonRequests>0{Text("同批 \(cost.comparisonRequests) 次用量：Standard \(money(cost.standardUSD)) ／ Fast \(money(cost.fastUSD))").monospacedDigit()}
                    Text("价格核对：\(cost.checkedAt)。仅累计本聊天请求，不含父聊天既有费用、税费、工具费或地区加价。缓存读取、写入分别计价，推理已包含在输出中。")
                    Text("\(cost.longContextCount) 次已计价请求超过 272K，按长上下文费率。这里使用配置档位；日志未提供服务器最终结算档位，不能核对降档或实际扣费。")
                    Link("官方 API 价格",destination:URL(string:cost.source)!)
                }.font(.caption).foregroundStyle(.secondary).padding(.top,8)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(14).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
}
