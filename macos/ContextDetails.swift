import SwiftUI
import Charts

struct ContextStatistics:Decodable {
    struct Category:Decodable,Identifiable {let category:String;let label:String;let items:Int;let tokensEstimate:Int;let images:Int;var id:String{category}}
    struct Tool:Decodable,Identifiable {let name:String;let count:Int;var id:String{name}}
    struct Unclassified:Decodable {let tokensEstimate:Int?;let status:String;let opaqueItems:Int;let images:Int;let reasoningItems:Int;let compactionItems:Int}
    let threadId:String;let snapshotAt:String?;let snapshotKind:String;let model:String?
    struct Response:Decodable,Identifiable {
        struct Config:Decodable {let model:String?;let effort:String?;let serviceTier:String?;let contextWindow:Int?;let compactThreshold:Int?}
        let id:String;let index:Int;let timestamp:String;let turnId:String?;let kind:String
        let inputTokens:Int?;let outputTokens:Int?;let reasoningTokens:Int?;let cachedInputTokens:Int?;let cacheWriteTokens:Int?;let cacheDelta:Int?;let cacheHitRate:Double?
        let durationMs:Double?;let tokensPerSecond:Double?;let timingKind:String;let segment:Int;let config:Config
    }
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
    @ObservedObject var model:Controller
    @Environment(\.dismiss) private var dismiss
    @State private var statistics:ContextStatistics?
    @State private var loading=false
    @State private var error:String?
    @State private var autoRefresh=true
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
                    VStack(alignment:.leading,spacing:22){
                        HStack(spacing:12){metric("请求输入总量",s.inputTokens,approximate:false);metric("可见文本估算",s.visibleTokens);metric("其他／未分项",s.unclassified.tokensEstimate)}
                        ContextCategoryChart(statistics:s)
                        HStack(spacing:12){metric("缓存命中（输入中的一部分）",s.cachedInputTokens,approximate:false);metric("缓存写入（运行时记录）",s.cacheWriteTokens,approximate:false)}
                        Text("缓存命中不额外占一份上下文。这里保留运行时的缓存统计，不改变 Codex 的缓存策略。").font(.caption).foregroundStyle(.secondary)
                        ContextResponseChart(responses:s.responses)
                        Text("分类来自这次请求开始前的保留历史。推理、图片等无法单独计量的部分合并到“其他／未分项”，差额包含估算误差。").font(.caption).foregroundStyle(.secondary)
                        VStack(spacing:0){
                            HStack {Text("分类");Spacer();Text("条目").frame(width:65,alignment:.trailing);Text("占用（估算）").frame(width:115,alignment:.trailing)}.font(.caption).foregroundStyle(.secondary).padding(.bottom,8)
                            ForEach(s.categories){row in
                                HStack {Circle().fill(color(row.category)).frame(width:7,height:7);Text(row.label).font(.callout);if row.images>0{Text("含 \(row.images) 张图片").font(.caption).foregroundStyle(.secondary)};Spacer();Text("\(row.items)").frame(width:65,alignment:.trailing);Text("≈ \(amount(row.tokensEstimate))").frame(width:115,alignment:.trailing)}.monospacedDigit().padding(.vertical,10)
                                Divider().opacity(0.4)
                            }
                            HStack {Circle().fill(color("other")).frame(width:7,height:7);Text("其他／未分项");Spacer();Text("\(s.unclassified.opaqueItems) 项*").frame(width:65,alignment:.trailing);Text(s.unclassified.tokensEstimate.map{"≈ \(amount($0))"} ?? "无法对齐").frame(width:115,alignment:.trailing)}.font(.callout).monospacedDigit().padding(.vertical,10)
                        }
                        Text("* 已识别 \(s.unclassified.reasoningItems) 个推理项目、\(s.unclassified.compactionItems) 个不透明压缩项目；另有 \(s.unclassified.images) 张图片。工具定义与消息格式没有单独的条目数，不能把图片数与消息数相加。").font(.caption).foregroundStyle(.secondary)
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
            await reload(force:true)
            while !Task.isCancelled {do{try await Task.sleep(for:.seconds(10))}catch{break};if autoRefresh{await reload(force:false)}}
        }
    }
    private func reload(force:Bool) async {
        if loading{return};loading=true;defer{loading=false}
        do {
            let data=try await model.api("/context-stats",body:["id":chatID,"refresh":force])
            let decoded=try JSONDecoder().decode(ContextStatistics.self,from:data)
            guard !Task.isCancelled,decoded.threadId==chatID else{return}
            statistics=decoded;error=nil
        }catch {if !Task.isCancelled{self.error=error.localizedDescription}}
    }
    private func metric(_ title:String,_ value:Int?,approximate:Bool=true)->some View {
        VStack(alignment:.leading,spacing:8){Text(title).font(.caption).foregroundStyle(.secondary);Text(value.map{(approximate ? "≈ ":"")+amount($0)} ?? "待观测").font(.system(size:25,weight:.medium,design:.rounded)).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading).padding(16).background(.white.opacity(0.05),in:RoundedRectangle(cornerRadius:14))
    }
    private func amount(_ n:Int)->String {n>=1000 ? (Double(n)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":n.formatted()}
    private func color(_ category:String)->Color {switch category{case "tool_calls":return .blue;case "tool_results":return .cyan;case "user":return .green;case "assistant_final":return .purple;case "assistant_commentary":return .gray;case "instructions":return .orange;default:return Color(red:0.48,green:0.43,blue:0.60)}}
    private func timestamp(_ text:String?)->String {
        guard let text else{return "待观测"};let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        guard let date=formatter.date(from:text) else{return text}
        return date.formatted(date:.abbreviated,time:.standard)
    }
}
