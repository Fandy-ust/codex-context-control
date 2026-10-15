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
    static func tokens(_ text:String) throws -> Int {
        let value=text.trimmingCharacters(in:.whitespacesAndNewlines)
        let pattern=try NSRegularExpression(pattern:"^(\\d+(?:\\.\\d+)?)\\s*([kKmM]?)$")
        guard let match=pattern.firstMatch(in:value,range:NSRange(value.startIndex...,in:value)),
              let numberRange=Range(match.range(at:1),in:value),let unitRange=Range(match.range(at:2),in:value),
              let number=Double(value[numberRange]) else{throw BudgetInputError(message:"请输入 700K、0.7M 或整数")}
        let unit=value[unitRange].lowercased(),multiplier=unit=="m" ? 1_000_000.0:unit=="k" ? 1000.0:1.0
        let result=number*multiplier
        guard result.isFinite,result>=0,result.rounded()==result,result<Double(Int.max/20000) else{throw BudgetInputError(message:"请输入有效的整数 token 数")}
        return Int(result)
    }
    static func preview(usableWindow:Int,compactPercent:Double,effectivePercent:Int,maximumRawWindow:Int) throws -> BudgetPreview {
        guard (1...100).contains(effectivePercent),maximumRawWindow>0,maximumRawWindow<Int.max/20000 else{throw BudgetInputError(message:"等待当前模型的可用比例与上限")}
        guard usableWindow>=1000 else{throw BudgetInputError(message:"实际可用窗口至少为 1,000 tokens")}
        let maximumUsableWindow=maximumRawWindow*effectivePercent/100
        guard usableWindow<=maximumUsableWindow else{throw BudgetInputError(message:"当前模型最多可用 \(maximumUsableWindow.formatted()) tokens")}
        let rawWindow=(usableWindow*100+effectivePercent-1)/effectivePercent
        let maximumCompact=rawWindow*90/100
        let maxBasisPoints=min(10000,((maximumCompact+1)*10000-1)/usableWindow)
        guard compactPercent.isFinite,compactPercent>0,compactPercent<=100 else{throw BudgetInputError(message:"压缩比例必须大于 0% 且不超过 100%")}
        guard abs(compactPercent*100-(compactPercent*100).rounded())<0.000001 else{throw BudgetInputError(message:"压缩比例请输入最多两位小数的百分比")}
        let basisPoints=Int((compactPercent*100).rounded())
        guard basisPoints>0,basisPoints<=maxBasisPoints else{throw BudgetInputError(message:"这个窗口最多可设置 \(Double(maxBasisPoints)/100)% 的压缩比例")}
        let compact=usableWindow*basisPoints/10000
        return BudgetPreview(usableWindow:usableWindow,rawWindow:rawWindow,compact:compact,compactPercent:Double(basisPoints)/100,maximumUsableWindow:maximumUsableWindow,maxCompactPercent:Double(maxBasisPoints)/100)
    }
}
