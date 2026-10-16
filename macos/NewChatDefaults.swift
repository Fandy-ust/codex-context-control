import SwiftUI

struct NewChatDefaultsView:View {
    @ObservedObject var model:Controller
    @Environment(\.dismiss) private var dismiss
    @State private var windowK=920.0
    @State private var compactK=904.0
    @State private var ratioNumerator=904
    @State private var ratioDenominator=920
    @State private var revision=0
    @State private var edited=false
    @State private var saving=false
    @State private var notice:String?
    @State private var failed=false
    @State private var selection:BudgetThumb = .window
    private var maximumCompactK:Int {max(17,Int(windowK)-16)}
    var body:some View {
        VStack(alignment:.leading,spacing:22){
            HStack{VStack(alignment:.leading,spacing:6){Text("新对话默认设置").font(.title2.weight(.semibold));Text("新建聊天自动沿用；fork 继承父聊天。已有聊天不受影响。").font(.callout).foregroundStyle(.secondary)};Spacer()}
            VStack(spacing:18){
                HStack{metric("压缩触发",Int(compactK),.blue);Spacer();metric("预留",Int(windowK-compactK),.secondary);Spacer();metric("上下文窗口",Int(windowK),.primary)}
                BudgetRangeSlider(window:Binding(get:{windowK},set:{setWindow($0)}),compact:Binding(get:{compactK},set:{setCompact($0)}),selection:$selection,maximumWindow:920,maximumCompact:maximumCompactK)
                HStack{Text("每步 1K");Spacer();Text("最大 920K · 至少预留 16K")}.font(.caption).foregroundStyle(.secondary)
                HStack{ForEach([200,400,800,920],id:\.self){value in Button("\(value)K"){setWindow(Double(value))}};Spacer();Button("使用当前聊天设置"){copySelected()}.disabled(model.selected?.policy==nil)}.buttonStyle(.bordered)
            }.padding(22).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:20))
            if model.newChatDefaultsPending {Label("首次接入需完整退出并重开 Codex；之后改默认值无需重启。",systemImage:"arrow.clockwise").font(.caption).foregroundStyle(.orange)}
            if let notice {Text(notice).font(.callout).foregroundStyle(failed ? .orange:.secondary)}
            HStack{Button("关闭"){dismiss()}.keyboardShortcut(.cancelAction);Spacer();if saving{ProgressView().controlSize(.small)};Button("保存默认"){Task{await save()}}.buttonStyle(.borderedProminent).disabled(!edited || saving || !model.serviceAvailable).keyboardShortcut(.defaultAction)}
        }.padding(28).frame(width:650).background(Color(white:0.095)).preferredColorScheme(.dark)
            .onAppear{load()}.onChange(of:model.newChatDefaults?.revision){_,_ in if !edited{load()}}
    }
    private func metric(_ title:String,_ value:Int,_ color:Color)->some View {VStack(alignment:.leading,spacing:5){Text("\(value)K").font(.system(size:28,weight:.medium,design:.rounded)).monospacedDigit().foregroundStyle(color);Text(title).font(.caption).foregroundStyle(.secondary)}}
    private func load(){let value=model.newChatDefaults;windowK=Double((value?.usableWindow ?? 920000)/1000);compactK=Double((value?.compact ?? 904000)/1000);revision=value?.revision ?? 0;ratioNumerator=Int(compactK);ratioDenominator=Int(windowK);edited=false}
    private func setWindow(_ value:Double){windowK=max(34,min(920,value.rounded()));compactK=Double(max(17,BudgetMath.linkedSliderCompactK(windowK:Int(windowK),ratioNumerator:ratioNumerator,ratioDenominator:ratioDenominator,maximumK:maximumCompactK)));edited=true;notice=nil}
    private func setCompact(_ value:Double){compactK=max(17,min(Double(maximumCompactK),value.rounded()));ratioNumerator=Int(compactK);ratioDenominator=Int(windowK);edited=true;notice=nil}
    private func copySelected(){guard let chat=model.selected,let policy=chat.policy,let percent=chat.modelMetadata?.effective_context_window_percent else{return};setWindow(Double(policy.window*percent/100/1000));setCompact(Double(min(policy.compact,policy.window*90/100)/1000))}
    private func save() async {saving=true;defer{saving=false};do{let data=try await model.api("/new-chat-defaults",body:["usableWindow":Int(windowK)*1000,"compact":Int(compactK)*1000,"expectedRevision":revision]);let saved=try JSONDecoder().decode(NewChatDefaultsState.self,from:data);model.newChatDefaults=saved;revision=saved.revision;edited=false;failed=false;notice="已保存，之后新建的聊天将沿用这组设置。"}catch{failed=true;notice=error.localizedDescription}}
}
