import Foundation

struct MenuBudgetDraft {
    let chatID:String
    let model:String?
    let revision:Int
    let effectivePercent:Int
    let maximumRawWindow:Int
    let reserve:Int
    let retainedFloor:Int
    private let originalWindow:Int
    private let originalCompact:Int
    private let wasEnabled:Bool
    private(set) var windowK:Double
    private(set) var compactK:Double
    private var ratioNumerator:Int
    private var ratioDenominator:Int

    init(chat:Chat) throws {
        guard let percent=chat.modelMetadata?.effective_context_window_percent,
              let maximum=chat.modelMetadata?.max_context_window,(1...100).contains(percent),maximum>=2000,maximum<Int.max/20000 else{throw BudgetInputError(message:"等待模型信息后即可调整")}
        chatID=chat.id;model=chat.model;revision=chat.policy?.revision ?? 0
        effectivePercent=percent;maximumRawWindow=maximum
        reserve=chat.policy?.reserve ?? 16000;retainedFloor=chat.policy?.retainedFloor ?? 0
        let maxK=maximum*percent/100/1000
        let w=max(2,min(maxK,chat.policy.map{$0.window*percent/100/1000} ?? 400))
        let maxCompact=try BudgetMath.maximumSliderCompactK(windowK:w,effectivePercent:percent,maximumRawWindow:maximum)
        let c=max(1,min(maxCompact,chat.policy.map{min($0.compact,$0.window*90/100)/1000} ?? w*90/100))
        windowK=Double(w);compactK=Double(c);originalWindow=w;originalCompact=c;wasEnabled=chat.policy?.enabled != false && chat.policy != nil
        ratioNumerator=c;ratioDenominator=w
    }
    var maximumWindowK:Int {maximumRawWindow*effectivePercent/100/1000}
    var maximumCompactK:Int {(try? BudgetMath.maximumSliderCompactK(windowK:Int(windowK),effectivePercent:effectivePercent,maximumRawWindow:maximumRawWindow)) ?? 1}
    var changed:Bool {Int(windowK) != originalWindow || Int(compactK) != originalCompact || !wasEnabled}
    mutating func setWindow(_ value:Double){
        windowK=max(2,min(Double(maximumWindowK),value.rounded()))
        compactK=Double(BudgetMath.linkedSliderCompactK(windowK:Int(windowK),ratioNumerator:ratioNumerator,ratioDenominator:ratioDenominator,maximumK:maximumCompactK))
    }
    mutating func setCompact(_ value:Double){
        compactK=max(1,min(Double(maximumCompactK),value.rounded()))
        ratioNumerator=Int(compactK);ratioDenominator=Int(windowK)
    }
    func policy() throws -> [String:Any] {
        let preview=try BudgetMath.sliderPreview(windowK:Int(windowK),compactK:Int(compactK),effectivePercent:effectivePercent,maximumRawWindow:maximumRawWindow)
        return ["window":preview.rawWindow,"compact":preview.compact,"reserve":reserve,"retainedFloor":retainedFloor,"scope":"total"]
    }
}
