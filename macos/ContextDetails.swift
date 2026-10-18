import SwiftUI
import Charts

func modelDisplayName(_ raw:String)->String {
    guard raw.lowercased().hasPrefix("gpt-") else{return raw}
    let parts=raw.dropFirst(4).split(separator:"-").map(String.init)
    guard let version=parts.first else{return raw}
    return (["GPT-"+version]+parts.dropFirst().map{$0.capitalized}).joined(separator:" ")
}
func effortDisplayName(_ raw:String?)->String {
    guard let raw else{return "—"}
    switch raw.lowercased(){case "xhigh":return "XHigh";default:return raw.capitalized}
}
func serviceTierDisplayName(_ raw:String?)->String {
    guard let raw else{return "—"}
    switch raw.lowercased(){case "priority","fast":return "Fast";case "default","standard":return "Standard";case "ultrafast":return "Ultrafast";default:return raw.capitalized}
}

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
        let groups:[Group];let checkedAt:String;let source:String
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

@MainActor private final class DeferredContextDetails {var statistics:ContextStatistics?;var payload:Data?}

@MainActor struct ContextDetailsView:View {
    let chatID:String;let title:String
    @ObservedObject var model:Controller
    @State private var statistics:ContextStatistics?
    @State private var loading=false
    @State private var error:String?
    @State private var autoRefresh=true
    @State private var lastPayload:Data?
    @State private var chartInteracting=false
    @State private var visible=true
    @State private var deferred=DeferredContextDetails()
    @State private var interactionRefresh:Task<Void,Never>?
    var body:some View {
        VStack(alignment:.leading,spacing:16){
            HStack{Text(L("上下文详情")).font(.title3.weight(.semibold));Spacer();if loading{ProgressView().controlSize(.small)};Button(L("刷新"),systemImage:"arrow.clockwise"){Task{await reload(force:true)}}.disabled(loading)}.buttonStyle(.bordered)
            HStack {Text(statistics.map{ $0.snapshotKind=="last_request" ? L("最近请求快照 · {0}", timestamp($0.snapshotAt)):L("本地保留历史 · 尚无可对齐用量") } ?? L("正在读取所选聊天…")).font(.caption).foregroundStyle(.secondary);Spacer();Toggle(L("自动刷新"),isOn:$autoRefresh).toggleStyle(.switch).controlSize(.small).font(.caption)}
            if let error{Label(error,systemImage:"exclamationmark.circle").font(.callout).foregroundStyle(.orange)}
            Group {
                if let s=statistics {
                    VStack(alignment:.leading,spacing:16){
                        ContextSummaryView(statistics:s)
                        ContextResponseChart(responses:s.responses,events:s.timelineEvents,revision:s.threadId+":"+s.generatedAt+":"+Localization.language.rawValue,onInteractionChanged:{active in if chartInteracting != active{chartInteracting=active}}).equatable()
                        VStack(spacing:0){
                            HStack {Text(L("分类"));Spacer();Text(L("条目")).frame(width:65,alignment:.trailing);Text(L("占用（估算）")).frame(width:115,alignment:.trailing)}.font(.caption).foregroundStyle(.secondary).padding(.bottom,8)
                            ForEach(s.categories){row in
                                HStack {Circle().fill(color(row.category)).frame(width:7,height:7);Text(L(row.label)).font(.callout);if row.images>0{Text(L("含 {0} 张图片", row.images)).font(.caption).foregroundStyle(.secondary)};Spacer();Text("\(row.items)").frame(width:65,alignment:.trailing);Text("≈ \(amount(row.tokensEstimate))").frame(width:115,alignment:.trailing)}.monospacedDigit().padding(.vertical,10)
                                Divider().opacity(0.4)
                            }
                            HStack {Circle().fill(color("other")).frame(width:7,height:7);Text(L("其他／未分项"));Spacer();Text(L("{0} 项*", s.unclassified.opaqueItems)).frame(width:65,alignment:.trailing);Text(s.unclassified.tokensEstimate.map{"≈ \(amount($0))"} ?? L("无法对齐")).frame(width:115,alignment:.trailing)}.font(.callout).monospacedDigit().padding(.vertical,10)
                        }
                        Text(L("* 已识别 {0} 个推理项目、{1} 个不透明压缩项目；另有 {2} 张图片（已包含在消息内）。", s.unclassified.reasoningItems, s.unclassified.compactionItems, s.unclassified.images)).font(.caption).foregroundStyle(.secondary)
                        if s.unclassified.status=="estimate_exceeds_input"{Text(L("文本估算超过请求输入量，暂不显示差额；不会将它当作零占用。")).font(.caption).foregroundStyle(.orange)}
                        DisclosureGroup(L("各工具调用次数")){
                            VStack(spacing:9){ForEach(s.toolCalls){tool in HStack{Text(tool.name).font(.system(.caption,design:.monospaced));Spacer();Text(L("{0} 次", tool.count)).monospacedDigit()}}}.padding(.top,12)
                        }
                        DisclosureGroup(L("推理生成统计与统计口径")){
                            VStack(alignment:.leading,spacing:10){
                                Text(L("本次压缩后、快照之前记录了 {0} 次响应，生成推理 {1}。这是生成量，不是当前保留的推理占用。", s.sampledResponses, amount(s.reasoningGenerated)))
                                Text(L("普通文本摘要已并入文本，只计一次；不透明压缩内容已合并到其他。此快照包含 {0} 条普通文本摘要。", s.plaintextSummaryItems))
                                ForEach(s.notes,id:\.self){Text(L($0))}
                                Text(L("{0}。统计在本机进行，不保存消息或推理正文。", L(s.tokenizer)))
                                Link(L("了解压缩摘要"),destination:URL(string:"https://developers.openai.com/api/docs/guides/compaction")!)
                            }.font(.caption).foregroundStyle(.secondary).padding(.top,12)
                        }
                    }.padding(.vertical,6).padding(.trailing,8)
                }else if !loading{ContentUnavailableView(L("暂无上下文统计"),systemImage:"chart.bar.xaxis",description:Text(L("这个聊天需要有本地记录。正常交互后点击刷新。")))}
            }
        }
        .frame(maxWidth:.infinity,alignment:.leading).preferredColorScheme(.dark)
        .task(id:chatID){
            await reload(force:false)
            while !Task.isCancelled {do{try await Task.sleep(for:.seconds(10))}catch{break};if autoRefresh && !chartInteracting{await reload(force:false)}}
        }
        .onChange(of:chartInteracting){_,active in
            interactionRefresh?.cancel()
            if !active{interactionRefresh=Task{
                do{try await Task.sleep(for:.milliseconds(180))}catch{return}
                guard !Task.isCancelled && visible && !chartInteracting else{return}
                if let pending=deferred.statistics{statistics=pending;lastPayload=deferred.payload;deferred.statistics=nil;deferred.payload=nil}
                if autoRefresh{await reload(force:false)}
            }}
        }
        .onAppear{visible=true}
        .onDisappear{visible=false;interactionRefresh?.cancel()}
    }
    private func reload(force:Bool) async {
        if loading || !visible{return};loading=true;defer{loading=false}
        do {
            let data=try await model.api(ControlAPI.statistics,body:["id":chatID,"refresh":force])
            if data==lastPayload{if !chartInteracting{deferred.statistics=nil;deferred.payload=nil};error=nil;return}
            let decoded=try await Task.detached(priority:.utility){try JSONDecoder().decode(ContextStatistics.self,from:data)}.value
            guard !Task.isCancelled,decoded.threadId==chatID else{return}
            if chartInteracting{deferred.statistics=decoded;deferred.payload=data}else{deferred.statistics=nil;deferred.payload=nil;statistics=decoded;lastPayload=data};error=nil
        }catch {if !Task.isCancelled{self.error=error.localizedDescription}}
    }
    private func amount(_ n:Int)->String {n>=1000 ? (Double(n)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":n.formatted()}
    private func color(_ category:String)->Color {switch category{case "tool_calls":return .blue;case "tool_results":return .cyan;case "user":return .green;case "assistant_final":return .blue;case "assistant_commentary":return .gray;case "instructions":return .orange;default:return Color(red:0.48,green:0.43,blue:0.60)}}
    private func timestamp(_ text:String?)->String {
        guard let text else{return L("待观测")};let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        guard let date=formatter.date(from:text) else{return text}
        return date.formatted(Date.FormatStyle(date:.abbreviated,time:.standard).locale(Localization.locale))
    }
}


struct ContextSummaryView:View {
    let statistics:ContextStatistics
    private func amount(_ n:Int?)->String {n.map{ $0>=1000000 ? (Double($0)/1000000).formatted(.number.precision(.fractionLength(0...2)))+"M":$0>=1000 ? (Double($0)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":$0.formatted()} ?? L("待观测")}
    private func money(_ n:Double?)->String {n.map{String(format:"$%.2f",$0)} ?? L("待估算")}
    var body:some View {
        VStack(alignment:.leading,spacing:12){
            HStack(spacing:12){
                metric(L("活跃上下文"),statistics.inputTokens).help(L("最近一次请求的输入总量，包含缓存命中部分；不是窗口容量上限"))
                metric(L("缓存命中"),statistics.cachedInputTokens).help(L("最近请求复用的输入 token，已包含在活跃上下文内"))
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
                Text(L("本聊天费用 · API 估算")).font(.callout.weight(.medium));Spacer()
                if cost.unpricedRequests>0{Text(L("可估部分")).font(.caption).foregroundStyle(.secondary)}
                Text((cost.usd != nil ? "≈ ":"")+money(cost.usd)).font(.system(size:23,weight:.medium,design:.rounded)).monospacedDigit()
            }
            HStack {Text(L("Standard 单价 · 已估 {0}/{1} 次 · 非实际账单", cost.pricedRequests, cost.totalRequests));Spacer();Text("USD")}.font(.caption2).foregroundStyle(.secondary)
            HStack(spacing:12){ForEach(cost.breakdown){part in
                VStack(alignment:.leading,spacing:3){Text(part.category=="cache_write" ? L("缓存写入 · 估算"):L(part.label)).font(.caption2).foregroundStyle(.secondary);Text(cost.pricedRequests>0 ? amount(part.tokens):"—").font(.callout).monospacedDigit();Text(cost.pricedRequests>0 ? money(part.usd):"—").font(.caption2).foregroundStyle(.secondary).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)
            }}.padding(.vertical,3)
            DisclosureGroup(L("官方公式与计价明细")){
                VStack(alignment:.leading,spacing:8){
                    Text(L("新增写入按未命中输入估算，使用官方单价。"))
                    Text(L("普通输入 = 总输入 − 缓存读取 − 缓存写入"))
                    Text(L("费用 =（普通输入 × 输入价 + 缓存读取 × 读取价 + 缓存写入 × 写入价 + 输出 × 输出价）÷ 1,000,000"))
                    Link(L("OpenAI 官方 calculateInputCost"),destination:URL(string:"https://developers.openai.com/api/docs/guides/prompt-caching#monitor-cache-performance")!)
                    Text(L("四项按官方公式计费。估算写入对应的 token 已从普通输入扣除，不重复收费。"))
                    ForEach(cost.groups){group in HStack {Text(L("{0} · Standard 计价", modelDisplayName(group.model)));Spacer();Text(L("{0} 次 · {1}", group.requests, money(group.usd))).monospacedDigit()}}
                    if cost.unpricedRequests>0{Text(L("未计入：模型价格未知 {0} · 用量缺失 {1} · 不支持的费率 {2}", cost.unknownModel, cost.unknownUsage, cost.unsupportedRate)).foregroundStyle(.orange)}
                    Text(L("价格核对：{0}。仅累计本聊天请求，不含父聊天既有费用、税费、工具费或地区加价。缓存读取、写入分别计价，推理已包含在输出中。", cost.checkedAt))
                    Text(L("{0} 次已计价请求超过 272K，按长上下文费率。统一使用 Standard 基础单价，不含加速溢价。", cost.longContextCount))
                    Link(L("官方 API 价格"),destination:URL(string:cost.source)!)
                }.font(.caption).foregroundStyle(.secondary).padding(.top,8)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(14).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
}
