import SwiftUI
import AppKit

func quotaPeriod(_ window:QuotaWindow)->String {
    guard let minutes=window.windowDurationMins else{return L("额度周期")}
    if minutes==10080{return L("每周")}
    if minutes%1440==0{return L("{0}天",minutes/1440)}
    if minutes%60==0{return L("{0}小时",minutes/60)}
    return L("{0}分钟",minutes)
}

func quotaCountdown(_ reset:Int,now:Date)->String {
    let seconds=max(0,Int(ceil(Double(reset)-now.timeIntervalSince1970)))
    if seconds==0{return L("等待额度刷新")}
    let days=seconds/86400,hours=seconds%86400/3600,minutes=seconds%3600/60
    if days>0{return L("还剩 {0}天 {1}小时",days,hours)}
    if hours>0{return L("还剩 {0}小时 {1}分",hours,minutes)}
    return L("还剩 {0}分 {1}秒",minutes,seconds%60)
}

func quotaCreditLabel(_ raw:String?)->String? {
    guard let raw,let value=Double(raw),value.isFinite,value>=0 else{return nil}
    let amount=value>0 && value<0.01 ? "<0.01":value.formatted(.number.precision(.fractionLength(0...2)).locale(Localization.locale))
    return "\(amount) credits"
}

struct AccountQuotaSection:View {
    @ObservedObject var model:Controller
    private var stale:Bool {!model.serviceAvailable || model.quota?.stale == true}
    private var windows:[QuotaWindow] {[model.selectedQuota?.primary,model.selectedQuota?.secondary].compactMap{$0}.sorted{($0.windowDurationMins ?? Int.max)<($1.windowDurationMins ?? Int.max)}}
    var body:some View {
        TimelineView(.periodic(from:.now,by:1)){timeline in content(now:timeline.date)}
    }
    private func content(now:Date)->some View {
        VStack(alignment:.leading,spacing:8){
            HStack(spacing:6){Image(systemName:"bolt.fill");Text(L("账户额度")).fontWeight(.medium);Spacer();if model.quotaRefreshing{ProgressView().controlSize(.mini)};Button{Task{await model.refreshQuota()}} label:{Image(systemName:"arrow.clockwise")}.buttonStyle(.plain).disabled(model.quotaRefreshing).help(L("刷新额度"))}.font(.system(size:12)).foregroundStyle(.secondary)
            if (model.quota?.buckets.count ?? 0)>1 {
                Picker(L("额度类型"),selection:$model.selectedQuotaID){ForEach(model.quota?.buckets ?? []){bucket in Text(bucket.name).tag(bucket.id)}}.labelsHidden()
            }
            if windows.isEmpty && model.selectedQuota?.creditBalance == nil && model.selectedQuota?.hasCredits != true && model.selectedQuota?.unlimitedCredits != true {
                Text(L(model.quotaRefreshing || model.quota?.loading == true ? "正在读取额度…":"额度暂不可用")).font(.system(size:12)).foregroundStyle(.secondary)
            } else {
                ForEach(Array(windows.enumerated()),id:\.offset){_,window in
                    HStack(alignment:.firstTextBaseline,spacing:8){
                        Text(quotaPeriod(window)).foregroundStyle(.secondary)
                        Text(L("剩余 {0}%",Int(window.remainingPercent.rounded()))).monospacedDigit().fontWeight(.medium)
                            .foregroundStyle(window.remainingPercent<5 ? Color.red:window.remainingPercent<20 ? .yellow:.primary)
                        Spacer()
                        if let reset=window.resetsAt{VStack(alignment:.trailing,spacing:2){Text(Date(timeIntervalSince1970:Double(reset)),format:.dateTime.month(.abbreviated).day().hour().minute());Text(quotaCountdown(reset,now:now)).monospacedDigit()}.font(.system(size:10)).foregroundStyle(.secondary).help(L("重置时间"))}
                    }.font(.system(size:12))
                }
            }
            if model.selectedQuota?.unlimitedCredits == true{Text(L("额外额度不限量")).font(.system(size:11)).foregroundStyle(.secondary)}
            else if model.selectedQuota?.hasCredits == true && model.selectedQuota?.creditBalance == nil{Text(L("额外额度可用")).font(.system(size:11)).foregroundStyle(.secondary)}
            if let credit=quotaCreditLabel(model.selectedQuota?.creditBalance){Text(credit).font(.system(size:11)).monospacedDigit().foregroundStyle(.secondary)}
            if stale{Text(L("上次记录，待刷新")).font(.system(size:11)).foregroundStyle(.orange)}
        }.padding(10).frame(maxWidth:.infinity,alignment:.leading).background(.primary.opacity(0.035),in:RoundedRectangle(cornerRadius:9)).padding(.horizontal,4)
    }
}
