import SwiftUI
import Charts

struct TokenCostCalendar:Decodable {
    struct Entry:Decodable,Identifiable,Equatable {
        let date:String;let hour:Int?;let tokens:Double;let requests:Int;let priced:Int;let unpriced:Int;let usd:Double?
        var id:String {date+":"+String(hour ?? -1)}
        var label:String {date+(hour.map{String(format:" %02d:00",$0)} ?? "")}
    }
    let today:String;let selectedDate:String?;let customRange:Bool?;let daily:[Entry];let hourly:[Entry];let monthly:[Entry]
}
private struct AnalyticsHoverCard:View {
    let title:String;let items:[String]
    var body:some View {
        VStack(alignment:.leading,spacing:12){
            Text(title).font(.callout.weight(.semibold))
            LazyVGrid(columns:[GridItem(.flexible(),alignment:.leading),GridItem(.flexible(),alignment:.leading)],alignment:.leading,spacing:12){
                ForEach(Array(items.enumerated()),id:\.offset){_,item in
                    let parts=item.components(separatedBy:": ")
                    VStack(alignment:.leading,spacing:5){if parts.count>1{Text(parts[0]).font(.caption).foregroundStyle(.secondary)};Text(parts.count>1 ? parts.dropFirst().joined(separator:": "):item).font(.callout.weight(.medium)).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)
                }
            }
        }.padding(14).frame(width:290).background(.regularMaterial,in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).strokeBorder(.white.opacity(0.15))).shadow(color:.black.opacity(0.35),radius:14,y:6)
    }
}
private struct CompactQuotaDateRange:View {
    @Binding var start:Date;@Binding var end:Date
    let onApply:()->Void;let onReset:()->Void
    var body:some View {
        HStack(spacing:6){
            Spacer(minLength:0)
            DatePicker(L("开始"),selection:Binding(get:{start},set:{start=$0;applyIfValid()}),displayedComponents:[.date,.hourAndMinute]).labelsHidden().datePickerStyle(.field).fixedSize().help(L("开始"))
            Text("–").foregroundStyle(.secondary)
            DatePicker(L("结束"),selection:Binding(get:{end},set:{end=$0;applyIfValid()}),displayedComponents:[.date,.hourAndMinute]).labelsHidden().datePickerStyle(.field).fixedSize().help(L("结束"))
            Button(action:onReset){Image(systemName:"arrow.uturn.backward")}.buttonStyle(.borderless).help(L("清除范围"))
        }.font(.caption2).controlSize(.small)
    }
    private func applyIfValid(){if end>start && end.timeIntervalSince(start)<=366*86400{onApply()}}
}
private struct TokenCostCalendarView:View {
    let calendar:TokenCostCalendar
    @Binding var period:String;@Binding var mode:String
    @Binding var date:Date;@Binding var start:Date;@Binding var end:Date
    var onDate:()->Void;var onApply:()->Void;var onReset:()->Void
    @State private var hovered:TokenCostCalendar.Entry?
    @State private var pointer:CGPoint?
    private var values:[TokenCostCalendar.Entry] {
        if period=="day"{return calendar.hourly}
        if calendar.customRange==true && period != "day"{return mode=="line" && period=="year" ? calendar.monthly:calendar.daily}
        if period=="week"{return Array(calendar.daily.suffix(7))}
        if period=="month"{return calendar.daily.filter{$0.date.prefix(7)==(calendar.selectedDate ?? calendar.today).prefix(7)}}
        return mode=="line" ? calendar.monthly:calendar.daily
    }
    private func money(_ value:Double?)->String {value.map{String(format:"≈ $%.4f",$0)} ?? "—"}
    private var offset:Int {
        guard period=="year",let date=values.first?.date,let d=ISO8601DateFormatter().date(from:date+"T00:00:00Z") else{return 0}
        var cal=Calendar(identifier:.gregorian);cal.timeZone=TimeZone(secondsFromGMT:0)!;return cal.component(.weekday,from:d)-1
    }
    var body:some View {
        VStack(alignment:.leading,spacing:16){
            HStack{Text(L("Token 费用日历")).font(.headline);Spacer();Picker(L("图表类型"),selection:$mode){Text(L("热力图")).tag("heatmap");Text(L("折线图")).tag("line")}.pickerStyle(.segmented).frame(width:180);Picker(L("费用时间范围"),selection:$period){Text(L("日")).tag("day");Text(L("周")).tag("week");Text(L("月")).tag("month");Text(L("年")).tag("year")}.pickerStyle(.segmented).frame(width:230)}
            HStack(alignment:.firstTextBaseline){Text(L("估算费用"));Text(values.contains{$0.priced>0} ? String(format:"≈ $%.2f",values.reduce(0){$0+($1.usd ?? 0)}):"—").font(.title2).monospacedDigit();Text("USD · "+L("无法计价")+": \(values.reduce(0){$0+$1.unpriced})").font(.caption).foregroundStyle(.secondary)}
            Group {
                if mode=="line" {if values.contains(where:{$0.priced>0}){costLine.frame(height:210)}else{Text(L("暂无可计价记录")).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:210)}}
                else if period=="year" {
                    ScrollView(.horizontal){LazyHGrid(rows:Array(repeating:GridItem(.fixed(12),spacing:4),count:7),spacing:4){ForEach(0..<offset,id:\.self){_ in Color.clear.frame(width:12,height:12)};ForEach(values){p in cell(p).frame(width:12,height:12)}}.padding(.vertical,4)}
                }else{LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:4),count:period=="week" ? 7:period=="month" ? 7:12),spacing:4){ForEach(values){p in cell(p).frame(height:40).overlay(Text(period=="day" ? String(p.hour ?? 0):String(p.date.suffix(5))).font(.caption).allowsHitTesting(false))}}}
            }.onContinuousHover{phase in switch phase{case .active(let p):pointer=p;case .ended:pointer=nil;hovered=nil}}
                .overlay(alignment:.topLeading){if let p=hovered{AnalyticsHoverCard(title:p.label,items:[L("估算费用")+": "+money(p.usd)+" USD","Token: "+quotaNumber(p.tokens),L("请求数")+": \(p.requests)",L("无法计价")+": \(p.unpriced)"]).offset(x:(pointer?.x ?? 0)+14,y:(pointer?.y ?? 0)+14).allowsHitTesting(false)}}
            HStack{Text(values.first?.label ?? "");Spacer();Text(L(calendar.customRange==true ? "按所选范围汇总":mode=="line" ? period=="year" ? "最近 12 个月，按月汇总":"每个点表示该时段的 API 估算费用":"颜色越深，估算费用越高"));Spacer();Text(values.last?.label ?? "")}.font(.caption2).foregroundStyle(.secondary)
            CompactQuotaDateRange(start:$start,end:$end,onApply:onApply,onReset:onReset)
            Image(systemName:"info.circle").font(.caption).foregroundStyle(.secondary).help(L("按现有 API 价格估算，沿用聊天费用的 Standard 与缓存写入估算规则；不是订阅账单。按云同步设置中的账号和设备范围汇总，空格表示无记录，无法计价的请求不按零元计算。"))
        }.padding(18).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).strokeBorder(.white.opacity(0.08)))
        .background{GeometryReader{g in Color.clear.onChange(of:g.frame(in:.global).minY){_,_ in hovered=nil}}}
        .onChange(of:period){_,_ in hovered=nil}.onChange(of:mode){_,_ in hovered=nil}.onChange(of:calendar.today){_,_ in hovered=nil}
        .onChange(of:values){_,_ in hovered=nil}.onChange(of:calendar.selectedDate){_,_ in hovered=nil}.onChange(of:calendar.customRange){_,_ in hovered=nil}
    }
    private func cell(_ p:TokenCostCalendar.Entry)->some View {
        let maxCost=max(0.000001,values.compactMap{$0.usd}.max() ?? 0)
        return RoundedRectangle(cornerRadius:3).fill(p.requests==0 ? Color.white.opacity(0.04):p.usd==nil ? Color.gray.opacity(0.4):Color.green.opacity(0.15+0.85*sqrt((p.usd ?? 0)/maxCost)))
            .overlay(RoundedRectangle(cornerRadius:3).strokeBorder(.white.opacity(p.unpriced>0 ? 0.5:0.08),style:StrokeStyle(lineWidth:1,dash:p.unpriced>0 ? [2,2]:[])))
            .onHover{inside in hovered=inside ? p:nil}.accessibilityLabel(p.label+" "+money(p.usd)+" USD · Token "+quotaNumber(p.tokens))
    }
    private var costLine:some View {
        Chart {
            if let hovered,let index=values.firstIndex(where:{$0.id==hovered.id}) {
                RuleMark(x:.value("x",index)).foregroundStyle(.white.opacity(0.4)).lineStyle(StrokeStyle(lineWidth:1))
                if let usd=hovered.usd{PointMark(x:.value("x",index),y:.value("USD",usd)).foregroundStyle(PanelStyle.blue).symbolSize(45)}
            }
            ForEach(Array(values.enumerated()),id:\.element.id){i,p in
                if let usd=p.usd {
                    let segment=values.prefix(i).filter{$0.usd==nil}.count
                    LineMark(x:.value("x",i),y:.value("USD",usd),series:.value("segment",segment)).foregroundStyle(PanelStyle.blue).lineStyle(StrokeStyle(lineWidth:1.8))
                    PointMark(x:.value("x",i),y:.value("USD",usd)).foregroundStyle(PanelStyle.blue).symbolSize(3)
                }
            }
        }.chartXScale(domain:0...max(1,values.count-1)).chartLegend(.hidden).chartYScale(domain:0...max(0.01,values.compactMap{$0.usd}.max() ?? 0.01)).chartXAxis{AxisMarks(values:.automatic(desiredCount:6)){value in AxisValueLabel{if let i=value.as(Int.self),values.indices.contains(i){Text(period=="day" ? String(values[i].hour ?? 0):String(values[i].date.suffix(period=="year" ? 7:5)))}}}}
        .chartOverlay{proxy in GeometryReader{geometry in Color.clear.contentShape(Rectangle()).onContinuousHover{phase in
            switch phase{case .active(let point):if let anchor=proxy.plotFrame{let frame=geometry[anchor];if frame.contains(point),let x:Double=proxy.value(atX:point.x-frame.minX){let i=Int(x.rounded());hovered=values.indices.contains(i) ? values[i]:nil}else{hovered=nil}};case .ended:hovered=nil}
        }.onChange(of:geometry.frame(in:.global).minY){_,_ in hovered=nil}}}
    }
}

struct QuotaAnalyticsReport:Decodable {
    struct Capabilities:Decodable {let weekly:Bool;let fiveHour:Bool}
    struct Selection:Decodable {let mode:String;let label:String}
    let simpleChartIds:[String]?;let reliability:QuotaReliability?;let costCalendar:TokenCostCalendar?;let capabilities:Capabilities?;let selection:Selection?;let dashboard:QuotaOutlook?;let model:String?;let models:[Option]?;let modelNotice:String?
    struct Option:Decodable,Identifiable {let id:String;let label:String}
    struct Section:Decodable,Identifiable {let id:String;let title:String;let chartIds:[String]}
    struct Overview:Decodable {
        struct Window:Decodable {let label:String;let weeklyPP:Double}
        let weeklyUsed:Double?;let fiveUsed:Double?;let tokens:Double?;let tokensPerPP:Double?;let updatedAt:Double?;let largestWindow:Window?
    }
    struct Quality:Decodable {
        struct Progress:Decodable {let files:Int;let pending:Int;let unreadable:Int;let bytesRead:Int}
        let snapshots:Int;let requests:Int;let comparableIntervals:Int;let discontinuities:Int;let unknownAccount:Bool;let notes:[String];let progress:Progress?
    }
    let schemaVersion:Int;let generatedAt:Double;let timeZone:String;let days:Int;let scope:String;let pool:String
    let scopes:[Option];let pools:[Option];let sections:[Section];let charts:[QuotaAnalysisChart];let overview:Overview;let quality:Quality
}
struct QuotaOutlook:Decodable {
    struct Period:Decodable,Identifiable {
        let id:String;let title:String;let status:String;let observedAt:Double;let resetAt:Double
        let remainingPercent:Double;let hoursUntilReset:Double;let hoursRemaining:Double?;let projectedRemaining:Double?
        let finishesBeforeReset:Bool?;let hoursBeforeReset:Double?;let depletionAt:Double?;let chart:QuotaAnalysisChart;let forecastOverlayChart:QuotaAnalysisChart?;let comparisonChart:QuotaAnalysisChart?;let costChart:QuotaAnalysisChart?;let overlayChart:QuotaAnalysisChart?;let costOverlayChart:QuotaAnalysisChart?
    }
    struct Credits:Decodable {let id:String;let title:String;let balance:Double;let observedAt:Double;let chart:QuotaAnalysisChart}
    let pool:String?;let pools:[QuotaAnalyticsReport.Option];let verified:Bool;let periods:[Period];let credits:Credits?
}
func quotaDuration(_ hours:Double?)->String {
    guard let hours,hours.isFinite else{return "—"}
    let minutes=max(0,Int((hours*60).rounded()))
    if minutes<1{return L("不足 1 分钟")}
    let days=minutes/1440,h=minutes%1440/60,m=minutes%60
    return [days>0 ? "\(days) "+L("天"):"",h>0 ? "\(h) "+L("小时"):"",days==0 && m>0 ? "\(m) "+L("分钟"):""].filter{!$0.isEmpty}.joined(separator:" ")
}
private struct QuotaOutlookCard:View {
    let period:QuotaOutlook.Period
    private var depletionText:String? {
        guard period.status=="ready",period.finishesBeforeReset==true,let at=period.depletionAt,at.isFinite else{return nil}
        let date=Date(timeIntervalSince1970:at/1000),calendar=Calendar.current
        let day=calendar.isDateInToday(date) ? L("今天"):calendar.isDateInTomorrow(date) ? L("明天"):date.formatted(.dateTime.year().month().day().locale(Localization.locale))
        let formatter=DateFormatter();formatter.locale=Localization.locale;formatter.dateFormat="HH:mm"
        return L("预计 {0} 用完").replacingOccurrences(of:"{0}",with:day+" "+formatter.string(from:date))
    }
    private var verdict:String {
        if period.status=="ready" {
            if period.finishesBeforeReset==true && (period.hoursBeforeReset ?? 0)<1/60{return L("预计接近重置时用完")}
            return period.finishesBeforeReset==true ? L("预计提前")+" "+quotaDuration(period.hoursBeforeReset)+" "+L("用完") : L("预计重置时还有")+" "+quotaNumber(period.projectedRemaining)+"% "+L("未使用")
        }
        switch period.status {
        case "exhausted":return L("额度已用完，等待重置")
        case "stale":return L("观测已过期，刷新后再预测")
        case "awaiting_reset":return L("已到重置时间，等待新读数")
        case "unidentified":return L("账户尚未识别，暂时无法预测")
        case "flat":return L("近期额度读数未变，暂时无法预测")
        default:return L("观测还不够，暂时无法预测")
        }
    }
    var body:some View {
        VStack(alignment:.leading,spacing:22){
            HStack{Text(L(period.title)).font(.system(size:16,weight:.semibold));Spacer();Text(quotaDuration(period.hoursUntilReset)+" "+L("后重置")).font(.caption).foregroundStyle(.secondary).help(Date(timeIntervalSince1970:period.resetAt/1000).formatted())}
            HStack(alignment:.top,spacing:16){
                metric(["stale","awaiting_reset"].contains(period.status) ? "上次剩余":"当前剩余",quotaNumber(period.remainingPercent)+"%",color:PanelStyle.blue)
                metric("用完还需",quotaDuration(period.hoursRemaining))
                metric("重置时预计剩余",period.projectedRemaining.map{quotaNumber($0)+"%"} ?? "—")
            }
            HStack(spacing:16){Text(verdict);Spacer(minLength:8);if let depletionText{Text(depletionText).monospacedDigit()}}.font(.callout).foregroundStyle(period.finishesBeforeReset==true ? Color.orange:PanelStyle.blue).minimumScaleFactor(0.85)
        }.padding(22).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:14)).overlay(RoundedRectangle(cornerRadius:14).strokeBorder(.white.opacity(0.08)))
    }
    private func metric(_ title:String,_ value:String,color:Color = .primary)->some View {
        VStack(alignment:.leading,spacing:10){Text(L(title)).font(.caption).foregroundStyle(.secondary);Text(value).font(.system(size:24,weight:.medium)).monospacedDigit().foregroundStyle(color).fixedSize(horizontal:false,vertical:true)}.frame(maxWidth:.infinity,alignment:.leading)
    }
}
struct QuotaAnalysisPoint:Decodable,Identifiable,Equatable {
    let id:String;let x:Double;let y:Double;let series:String?;let segment:String?;let label:String?;let at:Double?
    let value:Double?;let rightY:Double?;let tokens:Double?;let alignedTokens:Double?;let weeklyPP:Double?;let fivePP:Double?;let cacheRate:Double?;let partial:Bool?;let estimated:Bool?;let durationHours:Double?;let projected:Bool?
    let costUSD:Double?;let quotaPP:Double?;let intervalStart:Double?;let rawY:Double?
    let low:Double?;let high:Double?;let q1:Double?;let q3:Double?
}
struct QuotaReliability:Decodable {let level:String;let label:String;let explanation:String;let samples:Int}
struct QuotaAnalysisChart:Decodable,Identifiable {
    struct Fit:Decodable {let slope:Double;let intercept:Double;let r2:Double;let count:Int}
    struct Summary:Decodable {let count:Int;let min:Double;let median:Double;let max:Double}
    struct Ranking:Decodable,Identifiable {let id:String;let category:String;let label:String;let tokens:Double;let requests:Int}
    let rangeStart:Double?;let rangeEnd:Double?
    let id:String;let title:String;let kind:String;let xLabel:String;let yLabel:String;let rightLabel:String?;let wide:Bool?
    let interpretation:String?;let reliability:QuotaReliability?;let guide:[String]?;let modelScope:String?;let points:[QuotaAnalysisPoint];let empty:String?;let note:String?;let xMax:Double?;let xMin:Double?;let timeAxis:String?;let yMax:Double?;let fit:Fit?;let summary:Summary?
    var labels:[String]=[];var ranking:[Ranking]=[]
    enum CodingKeys:String,CodingKey {case rangeStart,rangeEnd,interpretation,reliability,id,title,kind,xLabel,yLabel,rightLabel,wide,guide,modelScope,points,empty,note,xMax,xMin,timeAxis,yMax,fit,summary,rows}
    init(from decoder:Decoder)throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        rangeStart=try c.decodeIfPresent(Double.self,forKey:.rangeStart);rangeEnd=try c.decodeIfPresent(Double.self,forKey:.rangeEnd)
        id=try c.decode(String.self,forKey:.id);title=try c.decode(String.self,forKey:.title);kind=try c.decode(String.self,forKey:.kind)
        xLabel=try c.decode(String.self,forKey:.xLabel);yLabel=try c.decode(String.self,forKey:.yLabel);rightLabel=try c.decodeIfPresent(String.self,forKey:.rightLabel);wide=try c.decodeIfPresent(Bool.self,forKey:.wide)
        interpretation=try c.decodeIfPresent(String.self,forKey:.interpretation);reliability=try c.decodeIfPresent(QuotaReliability.self,forKey:.reliability)
        guide=try c.decodeIfPresent([String].self,forKey:.guide);modelScope=try c.decodeIfPresent(String.self,forKey:.modelScope);points=try c.decode([QuotaAnalysisPoint].self,forKey:.points);empty=try c.decodeIfPresent(String.self,forKey:.empty);note=try c.decodeIfPresent(String.self,forKey:.note)
        xMax=try c.decodeIfPresent(Double.self,forKey:.xMax);xMin=try c.decodeIfPresent(Double.self,forKey:.xMin);timeAxis=try c.decodeIfPresent(String.self,forKey:.timeAxis);yMax=try c.decodeIfPresent(Double.self,forKey:.yMax);fit=try c.decodeIfPresent(Fit.self,forKey:.fit);summary=try c.decodeIfPresent(Summary.self,forKey:.summary)
        if kind=="table" {ranking=(try? c.decode([Ranking].self,forKey:.rows)) ?? []}else{labels=(try? c.decode([String].self,forKey:.rows)) ?? []}
    }
}
func quotaRatioNumber(_ n:Double)->String {n.formatted(.number.precision(.fractionLength(0...6)).locale(Localization.locale))}
func quotaNumber(_ n:Double?)->String {
    guard let n,n.isFinite else{return "—"}
    if abs(n)>=1000000{return String(format:"%.1fM",n/1000000)}
    if abs(n)>=1000{return String(format:"%.0fK",n/1000)}
    return n.formatted(.number.precision(.fractionLength(0...2)).locale(Localization.locale))
}

struct QuotaAnalyticsView:View {
    @ObservedObject var model:Controller
    var onBack:()->Void
    private let fixture:Bool
    @State private var report:QuotaAnalyticsReport?
    @State private var section="overview"
    @State private var period=""
    @State private var outlookMetric="cost"
    @State private var outlookOverlay=true
    @State private var outlookOverlayCount=6
    @State private var outlookSmoothing=0
    @State private var forecastOverlay=false
    @State private var outlookStart=Date()
    @State private var outlookEnd=Date()
    @State private var outlookEdited=false
    @State private var customOutlookRange=false
    @State private var analysisMode="simple"
    @State private var costDate=Date()
    @State private var costStart=Calendar.current.startOfDay(for:Date())
    @State private var costEnd=Calendar.current.date(byAdding:.day,value:1,to:Calendar.current.startOfDay(for:Date())) ?? Date()
    @State private var customCostRange=false
    @State private var dateChosen=false
    @State private var costPeriod="year"
    @State private var costMode="heatmap"
    @State private var days=28
    @State private var scope=""
    @State private var selectedModel=""
    @State private var pool=""
    @State private var loading=false
    @State private var failure:String?
    @State private var epoch=0
    init(model:Controller,onBack:@escaping ()->Void,fixture:QuotaAnalyticsReport?=nil){self.model=model;self.onBack=onBack;self.fixture=fixture != nil;_report=State(initialValue:fixture)}
    private var hasWeekly:Bool {report?.capabilities?.weekly ?? true}
    private var hasFive:Bool {report?.capabilities?.fiveHour ?? true}
    private var metricCount:Int {1 + (hasWeekly ? (analysisMode=="advanced" ? 2:1):0) + (hasFive ? 1:0)}
    private var loadKey:String {"\(days):\(scope):\(pool):\(selectedModel):\(outlookOverlayCount):\(outlookSmoothing)"}
    private var cards:[QuotaAnalysisChart] {
        guard let report else{return []};let selected=report.sections.first{$0.id==section} ?? report.sections.first
        let ids=analysisMode=="advanced" ? (selected?.chartIds ?? []):(report.simpleChartIds ?? ["weekly","windows","weeks","ranking"])
        return ids.compactMap{id in report.charts.first{$0.id==id}}
    }
    var body:some View {
        GeometryReader{geometry in
            ScrollView {
                VStack(alignment:.leading,spacing:20){
                    Text(L("额度预测")).font(.system(size:22,weight:.semibold))
                    if let failure{Text(failure).font(.callout).foregroundStyle(.orange)}
                    outlook
                    Divider().padding(.top,12)
                    HStack{Text(L("使用分析")).font(.title2.weight(.semibold));Spacer();Picker(L("分析模式"),selection:$analysisMode){Text(L("简洁模式")).tag("simple");Text(L("高级分析")).tag("advanced")}.pickerStyle(.segmented).frame(width:270)}.padding(.top,12)
                    filters
                    if let notice=report?.modelNotice{Text(L(notice)).font(.caption).foregroundStyle(.secondary)}
                    if let pending=report?.quality.progress?.pending,pending>0{Text("\(L("正在增量导入历史")) · \(pending) \(L("个文件待处理"))").font(.caption).foregroundStyle(.orange)}
                    LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:12),count:metricCount),spacing:12){
                        if hasWeekly{metric("Weekly 已用",report?.overview.weeklyUsed.map{quotaNumber($0)+"%"})};if hasFive{metric("5h 已用",report?.overview.fiveUsed.map{quotaNumber($0)+"%"})}
                        metric("本周期本机 Token",quotaNumber(report?.overview.tokens));if hasWeekly && analysisMode=="advanced"{metric("每 1% 每周额度对应 Token",quotaNumber(report?.overview.tokensPerPP),note:report?.reliability?.label)}
                    }
                    if let calendar=report?.costCalendar{TokenCostCalendarView(calendar:calendar,period:$costPeriod,mode:$costMode,date:$costDate,start:$costStart,end:$costEnd,onDate:{dateChosen=true;if !customCostRange{costStart=Calendar.current.startOfDay(for:costDate);costEnd=Calendar.current.date(byAdding:.day,value:1,to:costStart) ?? costStart};Task{await reload()}},onApply:applyCostRange,onReset:{customCostRange=false;Task{await reload()}})}
                    if let window=report?.overview.largestWindow{Text("\(L("观测消耗最高窗口")) · \(window.label) · \(quotaNumber(window.weeklyPP)) pp").font(.caption).foregroundStyle(.secondary)}
                    if let report {
                        if analysisMode=="advanced"{Picker(L("分析分类"),selection:$section){ForEach(report.sections){s in Text(L(s.title)).tag(s.id)}}.pickerStyle(.segmented).frame(maxWidth:460)}
                        chartGrid(width:geometry.size.width)
                        DisclosureGroup(L("数据覆盖与口径")+" · \(report.quality.snapshots) "+L("次额度观测")){
                            VStack(alignment:.leading,spacing:8){ForEach(report.quality.notes,id:\.self){Text(L($0))};Text("\(L("可比较区间")): \(report.quality.comparableIntervals) · \(L("重置或断档")): \(report.quality.discontinuities) · \(report.timeZone)")}.font(.caption).foregroundStyle(.secondary).padding(.top,12)
                        }.font(.callout).padding(16).background(.white.opacity(0.025),in:RoundedRectangle(cornerRadius:10))
                    } else {Text(L(loading ? "正在读取额度历史…":"刷新以读取额度历史")).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:200)}
                }.padding(28).frame(maxWidth:1120,alignment:.leading).frame(maxWidth:.infinity).softScrollEdges()
            }.safeAreaInset(edge:.top){HStack{Button(L("返回预算"),systemImage:"arrow.left",action:onBack);Spacer();if loading{ProgressView().controlSize(.small)};Button(L("刷新"),systemImage:"arrow.clockwise"){Task{await model.refreshQuota();await reload(force:true)}}.disabled(loading)}.buttonStyle(.bordered).padding(.horizontal,28).padding(.vertical,12).background(PanelStyle.background)}
        }.background(PanelStyle.background)
        .task(id:loadKey){guard !fixture else{return};await reload();while !Task.isCancelled{do{try await Task.sleep(for:.seconds((report?.quality.progress?.pending ?? 0)>0 ? 2:5))}catch{return};await reload()}}
    }
    private var outlookPeriod:QuotaOutlook.Period? {
        report?.dashboard?.periods.first{$0.id==period} ?? report?.dashboard?.periods.first
    }
    private var outlookChart:QuotaAnalysisChart? {
        guard let dashboard=report?.dashboard else{return nil}
        if period=="credits",let credit=dashboard.credits{return credit.chart}
        if outlookOverlay,let chart=(outlookMetric=="cost" ? outlookPeriod?.costOverlayChart:outlookPeriod?.overlayChart){return chart}
        if outlookMetric=="cost",let cost=outlookPeriod?.costChart{return cost}
        return outlookPeriod?.comparisonChart ?? outlookPeriod?.chart ?? dashboard.credits?.chart
    }
    private var outlookControls:some View {
        HStack(spacing:8){
            if period != "credits" && outlookPeriod?.costChart != nil{Picker(L("图表指标"),selection:$outlookMetric){Text(L("剩余额度")).tag("remaining");Text(L("预估费用 / 1%")).tag("cost")}.labelsHidden().pickerStyle(.menu).fixedSize()}
            Spacer(minLength:0)
            if period != "credits" && outlookPeriod != nil{
                Toggle(L("重叠"),isOn:$outlookOverlay).toggleStyle(.switch).controlSize(.mini).onChange(of:outlookOverlay){_,_ in if !customOutlookRange{outlookEdited=false}}
                if outlookOverlay{Picker(L("重叠周期数"),selection:$outlookOverlayCount){ForEach([3,6,12],id:\.self){n in Text("\(n) "+L("周期")).tag(n)}}.labelsHidden().pickerStyle(.menu).fixedSize()}
            }
        }.controlSize(.small).font(.caption)
    }
    private var outlookPeriodPicker:some View {
            Picker(L("选择额度周期"),selection:Binding(get:{period=="credits" && report?.dashboard?.credits != nil ? "credits":outlookPeriod?.id ?? "credits"},set:{period=$0;if !customOutlookRange{outlookEdited=false}})){
                ForEach(report?.dashboard?.periods ?? []){p in Text(p.id=="five" ? "5hr":"Weekly").tag(p.id)}
                if report?.dashboard?.credits != nil{Text("Credits").tag("credits")}
            }.pickerStyle(.segmented).labelsHidden().frame(width:210)
    }
    private func outlookDate(_ start:Bool)->Binding<Date> {
        Binding(get:{
            if outlookEdited || customOutlookRange{return start ? outlookStart:outlookEnd}
            return Date(timeIntervalSince1970:((start ? (outlookChart?.rangeStart ?? outlookChart?.xMin):(outlookChart?.rangeEnd ?? outlookChart?.xMax)) ?? Date().timeIntervalSince1970*1000)/1000)
        },set:{value in
            if !outlookEdited && !customOutlookRange {
                outlookStart=Date(timeIntervalSince1970:(outlookChart?.rangeStart ?? outlookChart?.xMin ?? Date().timeIntervalSince1970*1000)/1000)
                outlookEnd=Date(timeIntervalSince1970:(outlookChart?.rangeEnd ?? outlookChart?.xMax ?? Date().timeIntervalSince1970*1000)/1000)
            }
            outlookEdited=true
            if start{outlookStart=value}else{outlookEnd=value}
        })
    }
    private var forecastControls:some View {
        HStack {
            Spacer(minLength:0)
            Toggle(L("重叠"),isOn:$forecastOverlay).toggleStyle(.switch).controlSize(.mini)
            if forecastOverlay {
                Picker(L("重叠周期数"),selection:$outlookOverlayCount){ForEach([3,6,12],id:\.self){n in Text("\(n) "+L("周期")).tag(n)}}.labelsHidden().pickerStyle(.menu).fixedSize()
            }
        }
    }
    private var comparisonFooter:some View {
        HStack(spacing:12){
            if period != "credits" {
                Picker(L("平滑"),selection:$outlookSmoothing){Text(L("关闭")).tag(0);Text(L("低")).tag(3);Text(L("中")).tag(5);Text(L("高")).tag(9)}.pickerStyle(.menu).fixedSize().controlSize(.small).help(L("仅平滑曲线，悬停显示原始观测"))
            }
            CompactQuotaDateRange(start:outlookDate(true),end:outlookDate(false),onApply:applyOutlookRange,onReset:{customOutlookRange=false;outlookEdited=false;Task{await reload()}})
        }
    }
    @ViewBuilder private var outlook:some View {
        if let dashboard=report?.dashboard,!dashboard.periods.isEmpty || dashboard.credits != nil {
            if dashboard.pools.count>1{Picker(L("额度类型"),selection:Binding(get:{pool.isEmpty ? dashboard.pool ?? "":pool},set:{pool=$0})){ForEach(dashboard.pools){p in Text(p.label).tag(p.id)}}.frame(maxWidth:240)}
            ForEach(dashboard.periods){p in QuotaOutlookCard(period:p)}
            if let credit=dashboard.credits{metric("Credits",quotaNumber(credit.balance),note:"当前余额")}
            if period != "credits",let chart=(forecastOverlay ? outlookPeriod?.forecastOverlayChart:outlookPeriod?.chart){QuotaAnalysisCard(chart:chart,headerControl:AnyView(forecastControls),centerControl:AnyView(outlookPeriodPicker))}
            if let chart=outlookChart{QuotaAnalysisCard(chart:chart,headerControl:AnyView(outlookControls),centerControl:AnyView(outlookPeriodPicker),footer:AnyView(comparisonFooter)).id(chart.id)}
        }else{Text(L(report==nil ? "正在读取额度历史…":"等待当前账户额度，可在下方查看历史分析")).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:190)}
    }
    private func applyOutlookRange(){
        let start=outlookDate(true).wrappedValue,end=outlookDate(false).wrappedValue
        guard end>start,end.timeIntervalSince(start)<=366*86400 else{return}
        outlookStart=start;outlookEnd=end;customOutlookRange=true;Task{await reload()}
    }
    private var filters:some View {
        HStack(alignment:.bottom,spacing:14){
            VStack(alignment:.leading,spacing:6){Text(L("模型"));Picker(L("模型"),selection:$selectedModel){Text(L("全部模型")).tag("");ForEach(report?.models ?? []){p in Text(p.label).tag(p.id)};if !selectedModel.isEmpty && !(report?.models ?? []).contains(where:{$0.id==selectedModel}){Text(selectedModel).tag(selectedModel)}}.labelsHidden().frame(maxWidth:200)}
            VStack(alignment:.leading,spacing:6){Text(L("记录来源"));Picker(L("记录来源"),selection:Binding(get:{scope},set:{scope=$0;pool=""})){Text(L("自动")+(report?.selection.map{" · "+L($0.label)} ?? "")).tag("");ForEach(report?.scopes ?? []){p in Text(L(p.label)).tag(p.id)}}.labelsHidden().frame(maxWidth:240)}
            VStack(alignment:.leading,spacing:6){Text(L("额度类型"));Picker(L("额度类型"),selection:Binding(get:{pool.isEmpty ? report?.pool ?? "":pool},set:{pool=$0})){ForEach(report?.pools ?? []){p in Text(p.label).tag(p.id)}}.labelsHidden().frame(maxWidth:180)}
            VStack(alignment:.leading,spacing:6){Text(L("时间范围"));Picker(L("时间范围"),selection:$days){ForEach([28,56,84],id:\.self){n in Text("\(n/7) "+L("周")).tag(n)}}.labelsHidden().frame(width:100)}
            Spacer(minLength:0)
        }.font(.caption).foregroundStyle(.secondary).disabled(loading)
    }
    private func metric(_ title:String,_ value:String?,note:String?=nil)->some View {
        VStack(alignment:.leading,spacing:10){Text(L(title)).font(.system(size:11)).foregroundStyle(.secondary);Text(value ?? "—").font(.system(size:25,weight:.medium)).monospacedDigit();if let note{Text(L(note)).font(.caption).foregroundStyle(.secondary)}}.frame(maxWidth:.infinity,alignment:.leading).padding(16).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).strokeBorder(.white.opacity(0.08)))
    }
    @ViewBuilder private func chartGrid(width:CGFloat)->some View {
        let rows=chartRows(width:width)
        VStack(spacing:16){ForEach(rows.indices,id:\.self){i in HStack(alignment:.top,spacing:16){ForEach(rows[i]){c in QuotaAnalysisCard(chart:c).frame(maxWidth:.infinity,alignment:.topLeading)}}}}
    }
    private func chartRows(width:CGFloat)->[[QuotaAnalysisChart]] {
        var result:[[QuotaAnalysisChart]]=[]
        for c in cards{if width>=780,c.wide != true,let last=result.last,last.count==1,last[0].wide != true{result[result.count-1].append(c)}else{result.append([c])}}
        return result
    }
    private func applyCostRange(){
        guard costEnd>costStart,costEnd.timeIntervalSince(costStart)<=366*86400,costStart<=Date() else{failure=L("请选择有效的开始和结束时间，范围不能超过一年");return}
        customCostRange=true;costDate=costStart;dateChosen=true;Task{await reload()}
    }
    @MainActor private func reload(force:Bool=false) async {
        epoch+=1;let key=epoch;loading=true;failure=nil
        defer{if epoch==key{loading=false}}
        do {
            var params:[String:Any]=["days":days,"refresh":force,"outlookOverlayCount":outlookOverlayCount,"outlookSmoothing":outlookSmoothing];if !scope.isEmpty{params["scope"]=scope};if !pool.isEmpty{params["pool"]=pool};if !selectedModel.isEmpty{params["model"]=selectedModel}
            if dateChosen{let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="yyyy-MM-dd";params["costDate"]=f.string(from:costDate)}
            if customOutlookRange{params["outlookStart"]=Int64(outlookStart.timeIntervalSince1970*1000);params["outlookEnd"]=Int64(outlookEnd.timeIntervalSince1970*1000)}
            if customCostRange{params["costStart"]=Int64(costStart.timeIntervalSince1970*1000);params["costEnd"]=Int64(costEnd.timeIntervalSince1970*1000)}
            let data=try await model.api(ControlAPI.quotaAnalytics,body:params);try Task.checkCancellation()
            let value=try JSONDecoder().decode(QuotaAnalyticsReport.self,from:data);guard epoch==key else{return};report=value
        }catch is CancellationError{}catch{if epoch==key{failure=error.localizedDescription}}
    }
}

private struct QuotaAnalysisCard:View {
    let chart:QuotaAnalysisChart
    var headerControl:AnyView?=nil
    var centerControl:AnyView?=nil
    var footer:AnyView?=nil
    @State private var selected:QuotaAnalysisPoint?
    @State private var hovering=false
    @State private var pointer:CGPoint?
    @State private var showGuide=false
    private let colors:[Color]=[Color(red:0.43,green:0.63,blue:1),Color(red:0.78,green:0.59,blue:1),Color(red:0.35,green:0.79,blue:0.69),Color(red:0.94,green:0.71,blue:0.42),Color(red:0.91,green:0.49,blue:0.60),.gray]
    private var groups:[String]{var seen=Set<String>();return chart.points.compactMap{$0.series}.filter{seen.insert($0).inserted}}
    private var maxY:Double {max(chart.yLabel=="USD / 1%" ? 0.000001:1,chart.yMax ?? chart.points.map{max($0.y,$0.high ?? 0)}.max() ?? 1)}
    private var maxRight:Double {max(1,chart.points.compactMap{$0.rightY}.max() ?? 1)}
    private var bounds:ClosedRange<Double> {
        if chart.kind=="bar" || chart.kind=="box" {return -0.6...max(0.6,Double(chart.points.count)-0.4)}
        let lo=chart.xMin ?? (chart.xMax != nil ? 0:chart.points.map{$0.x}.min() ?? 0),hi=chart.xMax ?? chart.points.map{$0.x}.max() ?? 1
        return lo...max(lo+1,hi)
    }
    private func color(_ p:QuotaAnalysisPoint)->Color{colors[(groups.firstIndex(of:p.series ?? "") ?? 0)%colors.count]}
    var body:some View {
        VStack(alignment:.leading,spacing:12){
            HStack(alignment:.firstTextBaseline){Text(L(chart.title)).font(.system(size:14,weight:.semibold));if let guide=chart.guide,!guide.isEmpty{Button{showGuide.toggle()}label:{Image(systemName:"info.circle")}.buttonStyle(.plain).accessibilityLabel(L("图表说明")).popover(isPresented:$showGuide){VStack(alignment:.leading,spacing:10){Text(L(chart.title)).font(.headline);ForEach(guide,id:\.self){Text(L($0)).font(.callout)}}.padding(18).frame(width:320)}};Spacer();if let headerControl{headerControl};Text(L(chart.yLabel)).font(.system(size:10)).foregroundStyle(.secondary)}.overlay{if let centerControl{centerControl}}
            if chart.kind=="table" && !chart.ranking.isEmpty {ranking}
            else if chart.points.isEmpty {Text(L(chart.empty ?? "尚无足够的可比较记录")).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth:.infinity,minHeight:190)}
            else {
        plot.overlay(alignment:.topLeading){if hovering,let selected,let pointer{AnalyticsHoverCard(title:selected.label ?? selected.series ?? L(chart.title),items:detail(selected).components(separatedBy:" · ")).offset(x:pointer.x+16,y:pointer.y+16).allowsHitTesting(false)}}.frame(height:chart.kind=="heatmap" ? min(380,max(210,Double(chart.labels.count)*15+30)):210)
                Text(L(chart.xLabel)+(chart.rightLabel.map{" · "+L("右轴")+": "+L($0)} ?? "")).font(.system(size:10)).foregroundStyle(.secondary).frame(maxWidth:.infinity)
                HStack(alignment:.center,spacing:12){
                    if !groups.isEmpty{HStack(spacing:12){ForEach(Array(groups.prefix(8).enumerated()),id:\.offset){i,name in HStack(spacing:5){Circle().fill(colors[i%colors.count]).frame(width:6,height:6);Text(L(name)).lineLimit(1)}}}.font(.system(size:10)).foregroundStyle(.secondary)}
                    Spacer(minLength:0);if let footer{footer}
                }

            }
            if let interpretation=chart.interpretation{Text(L(interpretation)).font(.caption).foregroundStyle(.secondary)}
            if let r=chart.reliability{Text(L(r.label)).font(.caption).foregroundStyle(.secondary)}
            if let summary=chart.summary{Text("\(L("通常观测值")) \(quotaNumber(summary.median)) · \(L("观测范围")) \(quotaNumber(summary.min))–\(quotaNumber(summary.max))").font(.caption).foregroundStyle(.secondary)}
            if chart.fit != nil || chart.reliability != nil{DisclosureGroup(L("技术详情")){
                VStack(alignment:.leading,spacing:8){if let fit=chart.fit{Text("n=\(fit.count) · R²=\(String(format:"%.2f",fit.r2))")};if let r=chart.reliability{Text(L(r.explanation));Text(L("可比较区间")+": \(r.samples)")}}.padding(.top,8)
            }.font(.caption).foregroundStyle(.secondary)}
            if chart.points.isEmpty,let footer{footer}
        }.padding(18).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).strokeBorder(.white.opacity(0.08)))
        .onChange(of:chart.points){_,_ in selected=nil;hovering=false}
    }
    private var plot:some View {
        Chart {
            ForEach(chart.points){p in
                if chart.kind=="heatmap" {
                    let row=Double(chart.labels.count)-p.y-1
                    RectangleMark(xStart:.value("x",p.x),xEnd:.value("x",p.x+1),yStart:.value("y",row),yEnd:.value("y",row+1)).foregroundStyle(colors[0].opacity(0.15+0.85*(p.value ?? 0)/max(1,chart.points.compactMap{$0.value}.max() ?? 1))).cornerRadius(3)
                } else if chart.kind=="bar" {
                    BarMark(x:.value("x",p.x),y:.value("y",p.y),width:.ratio(0.65)).foregroundStyle(color(p)).cornerRadius(3)
                } else if chart.kind=="box" {
                    RuleMark(x:.value("x",p.x),yStart:.value("low",p.low ?? p.y),yEnd:.value("high",p.high ?? p.y)).foregroundStyle(color(p))
                    BarMark(x:.value("x",p.x),yStart:.value("q1",p.q1 ?? p.y),yEnd:.value("q3",p.q3 ?? p.y),width:24).foregroundStyle(color(p).opacity(0.4))
                    PointMark(x:.value("x",p.x),y:.value("median",p.y)).symbol(.cross).foregroundStyle(.white).symbolSize(30)
                } else if chart.kind=="scatter" {
                    PointMark(x:.value("x",p.x),y:.value("y",p.y)).foregroundStyle(color(p).opacity(0.85)).symbolSize(25)
                } else {
                    LineMark(x:.value("x",p.x),y:.value("y",p.y),series:.value("series",p.segment ?? p.series ?? "line")).foregroundStyle(color(p)).lineStyle(StrokeStyle(lineWidth:1.8,dash:p.projected==true ? [6,4]:[]))
                    PointMark(x:.value("x",p.x),y:.value("y",p.y)).foregroundStyle(color(p)).symbolSize(3)
                    if chart.kind=="dual",let right=p.rightY {
                        LineMark(x:.value("x",p.x),y:.value("y",right/maxRight*maxY),series:.value("series","weekly-right"+(p.segment ?? ""))).foregroundStyle(colors[3]).lineStyle(StrokeStyle(lineWidth:1.5,dash:[6,4]))
                    }
                }
            }
            if let fit=chart.fit,fit.r2>=0.3 {
                ForEach([max(bounds.lowerBound,-fit.intercept/fit.slope),min(bounds.upperBound,(maxY-fit.intercept)/fit.slope)],id:\.self){x in LineMark(x:.value("x",x),y:.value("y",fit.intercept+fit.slope*x),series:.value("series","fit")).foregroundStyle(.white.opacity(0.55)).lineStyle(StrokeStyle(lineWidth:1,dash:[6,4]))}
            }
        }
        .chartXScale(domain:bounds).chartYScale(domain:0...(chart.kind=="heatmap" ? max(1,Double(chart.labels.count)):maxY))
        .chartLegend(.hidden)
        .chartXAxis{
            if chart.id=="weekly" {AxisMarks(values:Array(0...7).map{Double($0)}){value in AxisGridLine().foregroundStyle(.white.opacity(0.04));AxisValueLabel{if let x=value.as(Double.self){Text(quotaNumber(x)).font(.system(size:10))}}}}
            else if chart.kind=="heatmap" {AxisMarks(values:stride(from:0.5,to:chart.xMax ?? 7,by:chart.xMax==24 ? 3:1).map{$0}){value in AxisValueLabel{if let x=value.as(Double.self){Text(String(Int(x)+(chart.xMax==7 ? 1:0))).font(.system(size:10))}}}}
            else {AxisMarks(values:.automatic(desiredCount:5)){value in AxisGridLine().foregroundStyle(.white.opacity(0.04));AxisValueLabel{if let x=value.as(Double.self){Text(xLabel(x)).font(.system(size:10))}}}}
        }
        .chartYAxis{
            if chart.kind=="heatmap" {AxisMarks(position:.leading,values:Array(0..<chart.labels.count).map{Double($0)+0.5}){value in AxisValueLabel{if let y=value.as(Double.self){Text(yLabel(y)).font(.system(size:9))}}}}
            else {AxisMarks(position:.leading,values:.automatic(desiredCount:5)){value in AxisGridLine().foregroundStyle(.white.opacity(0.06));AxisValueLabel{if let y=value.as(Double.self){Text(yLabel(y)).font(.system(size:10))}}}}
            if chart.kind=="dual" {AxisMarks(position:.trailing,values:.automatic(desiredCount:5)){value in AxisValueLabel{if let y=value.as(Double.self){Text(quotaNumber(y/maxY*maxRight)).font(.system(size:10)).foregroundStyle(colors[3])}}}}
        }
        .chartOverlay{proxy in GeometryReader{geometry in
            let frame=proxy.plotFrame.map{geometry[$0]} ?? .zero
            ZStack(alignment:.topLeading){
                Color.clear.contentShape(Rectangle()).onContinuousHover{phase in
                    switch phase {
                    case .active(let location):
                        hovering=frame.contains(location)
                        let local=CGPoint(x:location.x-frame.minX,y:location.y-frame.minY);pointer=local
                        selected=chart.points.min{a,b in
                            let da=distance(a,local,proxy),db=distance(b,local,proxy)
                            if da != db{return da<db}
                            return abs((proxy.position(forY:a.y) ?? 0)-local.y)<abs((proxy.position(forY:b.y) ?? 0)-local.y)
                        }
                    case .ended:hovering=false
                    }
                }.onChange(of:geometry.frame(in:.global).minY){_,_ in hovering=false}
                if hovering,let selected,let x=proxy.position(forX:chart.kind=="heatmap" ? selected.x+0.5:selected.x){
                    Path{line in line.move(to:CGPoint(x:frame.minX+x,y:frame.minY));line.addLine(to:CGPoint(x:frame.minX+x,y:frame.maxY))}.stroke(.white.opacity(0.4),lineWidth:1)
                }
            }
        }}
        .accessibilityLabel(L(chart.title))
    }
    private func distance(_ p:QuotaAnalysisPoint,_ location:CGPoint,_ proxy:ChartProxy)->Double {
        let yy=chart.kind=="heatmap" ? Double(chart.labels.count)-p.y-0.5:p.y,xx=chart.kind=="heatmap" ? p.x+0.5:p.x
        guard let x=proxy.position(forX:xx),let y=proxy.position(forY:yy) else{return .infinity}
        return pow(Double(x-location.x),2)+(chart.kind=="bar" || chart.kind=="line" || chart.kind=="dual" ? 0:pow(Double(y-location.y),2))
    }
    private func xLabel(_ x:Double)->String {
        if chart.timeAxis=="elapsed"{return quotaNumber(x/((chart.xMax ?? 0) > 86400000 ? 86400000:3600000))+((chart.xMax ?? 0)>86400000 ? "d":"h")}
        if let axis=chart.timeAxis{let date=Date(timeIntervalSince1970:x/1000);return axis=="hours" ? date.formatted(.dateTime.hour().minute()):date.formatted(.dateTime.month(.twoDigits).day().hour())}
        if chart.kind=="dual" {return Date(timeIntervalSince1970:x/1000).formatted(.dateTime.month(.twoDigits).day(.twoDigits))}
        if chart.kind=="bar" || chart.kind=="box" {return chart.points.first{abs($0.x-x)<0.1}?.label ?? ""}
        return quotaNumber(x)
    }
    private func yLabel(_ y:Double)->String {
        if chart.kind=="heatmap" {let i=chart.labels.count-1-Int(y);return chart.labels.indices.contains(i) ? chart.labels[i]:""}
        return chart.yLabel=="USD / 1%" ? y.formatted(.number.precision(.significantDigits(1...3)).locale(Localization.locale)):quotaNumber(y)
    }
    private func detail(_ p:QuotaAnalysisPoint)->String {
        var values=[p.label,p.series.map{L($0)},L(chart.yLabel)+": "+(chart.yLabel=="USD / 1%" ? quotaRatioNumber(p.rawY ?? p.y):quotaNumber(chart.kind=="heatmap" ? p.value:(p.rawY ?? p.y)))].compactMap{$0}
        if let at=p.at{values.append(Date(timeIntervalSince1970:at/1000).formatted(.dateTime.month(.twoDigits).day().hour().minute()))}
        if let usd=p.costUSD{values.append(L("区间预估费用")+": $"+quotaRatioNumber(usd))};if let pp=p.quotaPP{values.append(L("额度消耗")+": "+quotaRatioNumber(pp)+"%")};if let start=p.intervalStart{values.append(L("开始")+": "+Date(timeIntervalSince1970:start/1000).formatted())}
        if let tokens=p.tokens{values.append("Token: "+quotaNumber(tokens))};if let weekly=p.weeklyPP{values.append("Weekly: \(quotaNumber(weekly)) pp")};if let five=p.fivePP{values.append("5h: \(quotaNumber(five)) pp")}
        if let weekly=p.weeklyPP,weekly>=1,let tokens=p.tokens,tokens>0{values.append("Token / pp: "+quotaNumber((p.alignedTokens ?? tokens)/weekly))}
        if let cache=p.cacheRate{values.append(L("缓存占比")+": \(Int((cache*100).rounded()))%")};if p.partial==true{values.append(L("部分窗口"))};if p.estimated==true{values.append(L("断档期间的净变化")+" · "+quotaNumber(p.durationHours)+" h")};return values.joined(separator:" · ")
    }
    private var ranking:some View {
        VStack(spacing:0){HStack{Text(L("类型")).frame(width:42,alignment:.leading);Text(L("名称"));Spacer();Text("Token").frame(width:80,alignment:.trailing);Text(L("请求数")).frame(width:55,alignment:.trailing)}.font(.caption).foregroundStyle(.secondary).padding(.bottom,8)
            ForEach(chart.ranking){row in HStack{Text(L(row.category=="chat" ? "对话":row.category=="project" ? "项目":"日期")).frame(width:42,alignment:.leading).foregroundStyle(.secondary);Text(row.label).lineLimit(1);Spacer();Text(quotaNumber(row.tokens)).frame(width:80,alignment:.trailing);Text("\(row.requests)").frame(width:55,alignment:.trailing)}.font(.caption).monospacedDigit().padding(.vertical,9);Divider().opacity(0.35)}
        }
    }
}
