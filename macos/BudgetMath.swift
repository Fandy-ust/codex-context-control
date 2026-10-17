import Foundation

struct BudgetPreview {
    let usableWindow:Int
    let rawWindow:Int
    let compact:Int
    let compactPercent:Double
    let maximumUsableWindow:Int
    let maxCompactPercent:Double
}
struct BudgetInputError:LocalizedError {
    let message:String
    var errorDescription:String? {message}
}
enum BudgetMath {
    static func sliderPreview(windowK:Int,compactK:Int,effectivePercent:Int,maximumRawWindow:Int) throws -> BudgetPreview {
        guard windowK>=2,windowK<Int.max/20_000_000,compactK>=1,compactK<=windowK else{throw BudgetInputError(message:L("窗口至少为 2K，压缩阈值至少为 1K"))}
        let base=try preview(usableWindow:windowK*1000,compactPercent:1,effectivePercent:effectivePercent,maximumRawWindow:maximumRawWindow)
        let compact=compactK*1000
        guard compact<=base.rawWindow*90/100 else{throw BudgetInputError(message:L("压缩阈值超过当前窗口允许的上限"))}
        return BudgetPreview(usableWindow:base.usableWindow,rawWindow:base.rawWindow,compact:compact,compactPercent:Double(compactK)/Double(windowK)*100,maximumUsableWindow:base.maximumUsableWindow,maxCompactPercent:base.maxCompactPercent)
    }
    static func maximumSliderCompactK(windowK:Int,effectivePercent:Int,maximumRawWindow:Int) throws -> Int {
        let base=try sliderPreview(windowK:windowK,compactK:1,effectivePercent:effectivePercent,maximumRawWindow:maximumRawWindow)
        return min(windowK,base.rawWindow*90/100/1000)
    }
    static func linkedSliderCompactK(windowK:Int,ratioNumerator:Int,ratioDenominator:Int,maximumK:Int) -> Int {
        // Keep the selected rational ratio across repeated drags; rounding the
        // previous threshold again would accumulate error on a return trip.
        guard windowK>=2,ratioNumerator>0,ratioDenominator>=ratioNumerator else{return 1}
        let scaled=ratioDenominator.dividingFullWidth(windowK.multipliedFullWidth(by:ratioNumerator)).quotient
        return max(1,min(maximumK,scaled))
    }
    static func tokens(_ text:String) throws -> Int {
        let value=text.trimmingCharacters(in:.whitespacesAndNewlines)
        let pattern=try NSRegularExpression(pattern:"^(\\d+(?:\\.\\d+)?)\\s*([kKmM]?)$")
        guard let match=pattern.firstMatch(in:value,range:NSRange(value.startIndex...,in:value)),
              let numberRange=Range(match.range(at:1),in:value),let unitRange=Range(match.range(at:2),in:value),
              let number=Double(value[numberRange]) else{throw BudgetInputError(message:L("请输入 700K、0.7M 或整数"))}
        let unit=value[unitRange].lowercased(),multiplier=unit=="m" ? 1_000_000.0:unit=="k" ? 1000.0:1.0
        let result=number*multiplier
        guard result.isFinite,result>=0,result.rounded()==result,result<Double(Int.max/20000) else{throw BudgetInputError(message:L("请输入有效的整数 token 数"))}
        return Int(result)
    }
    static func preview(usableWindow:Int,compactPercent:Double,effectivePercent:Int,maximumRawWindow:Int) throws -> BudgetPreview {
        guard (1...100).contains(effectivePercent),maximumRawWindow>0,maximumRawWindow<Int.max/20000 else{throw BudgetInputError(message:L("等待当前模型的可用比例与上限"))}
        guard usableWindow>=1000 else{throw BudgetInputError(message:L("实际可用窗口至少为 1,000 tokens"))}
        let maximumUsableWindow=maximumRawWindow*effectivePercent/100
        guard usableWindow<=maximumUsableWindow else{throw BudgetInputError(message:L("当前模型最多可用 {0} tokens", maximumUsableWindow.formatted()))}
        let rawWindow=(usableWindow*100+effectivePercent-1)/effectivePercent
        let maximumCompact=rawWindow*90/100
        let maxBasisPoints=min(10000,((maximumCompact+1)*10000-1)/usableWindow)
        guard compactPercent.isFinite,compactPercent>0,compactPercent<=100 else{throw BudgetInputError(message:L("压缩比例必须大于 0% 且不超过 100%"))}
        guard abs(compactPercent*100-(compactPercent*100).rounded())<0.000001 else{throw BudgetInputError(message:L("压缩比例请输入最多两位小数的百分比"))}
        let basisPoints=Int((compactPercent*100).rounded())
        guard basisPoints>0,basisPoints<=maxBasisPoints else{throw BudgetInputError(message:L("这个窗口最多可设置 {0}% 的压缩比例", Double(maxBasisPoints)/100))}
        let compact=usableWindow*basisPoints/10000
        return BudgetPreview(usableWindow:usableWindow,rawWindow:rawWindow,compact:compact,compactPercent:Double(basisPoints)/100,maximumUsableWindow:maximumUsableWindow,maxCompactPercent:Double(maxBasisPoints)/100)
    }
}
