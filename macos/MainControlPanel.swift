import SwiftUI

struct MainControlPanelView:View {
    @ObservedObject var model:Controller
    var close:()->Void = {}
    @State private var defaults=false
    @State private var feedback:String?
    var body:some View {
        VStack(alignment:.leading,spacing:0) {
            if defaults {
                NewChatDefaultsView(model:model,onClose:{defaults=false},compact:true)
            } else {
                VStack(alignment:.leading,spacing:14){
                    HStack{Text(L("主控制面板")).font(.system(size:16,weight:.semibold));Spacer();Button(action:close){Image(systemName:"xmark").foregroundStyle(.secondary)}.buttonStyle(.plain).help(L("关闭"))}
                    Divider()
                    Picker(L("语言"),selection:Binding(get:{model.languageSelection},set:{model.setLanguage($0)})){
                        Text(L("自动（按时区）")).tag(LanguageChoice.auto)
                        Text("中文").tag(LanguageChoice.zh)
                        Text("English").tag(LanguageChoice.en)
                    }.pickerStyle(.menu).accessibilityIdentifier("language-picker")
                    action(L("全局默认"),icon:"slider.horizontal.3",navigate:true){defaults=true}
                    ContextExtensionControl(model:model)
                    Divider()
                    action(L("同步本地聊天"),icon:"arrow.clockwise"){Task{await model.scanChats();feedback=model.notice}}.disabled(model.working)
                    if model.updateState?.phase=="downloading" || model.updateState?.phase=="installing" {
                        HStack{ProgressView().controlSize(.small);Text(L("正在更新…"))}.font(.callout)
                    } else {
                        action(model.updateState?.available == true ? L("安装更新 {0}",model.updateState?.version ?? ""):L("检查更新"),icon:"arrow.down.circle"){Task{await model.updateApp(install:model.updateState?.available == true);feedback=model.notice}}.disabled(model.checkingUpdates)
                    }
                    action(L("打开 Codex"),icon:"arrow.up.forward.app"){close();model.launchCodex()}
                    if let feedback{Text(L(feedback)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)}
                }.padding(20).frame(width:360).fixedSize(horizontal:false,vertical:true).background(Color(white:0.095))
            }
        }.preferredColorScheme(.dark).environment(\.locale,Localization.locale)
    }
    private func action(_ title:String,icon:String,navigate:Bool=false,perform:@escaping ()->Void)->some View {
        Button(action:perform){HStack(spacing:10){Image(systemName:icon).frame(width:18).foregroundStyle(.secondary);Text(title);Spacer();if navigate{Image(systemName:"chevron.right").font(.system(size:10,weight:.semibold)).foregroundStyle(.tertiary)}}
            .font(.system(size:13)).padding(.horizontal,12).padding(.vertical,10).frame(maxWidth:.infinity).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:9)).contentShape(Rectangle())}.buttonStyle(.plain)
    }
}
