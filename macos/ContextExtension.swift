import SwiftUI
struct ContextExtensionControl:View {
    @ObservedObject var model:Controller
    var body:some View {
        VStack(alignment:.leading,spacing:7){
            Toggle(L("拓展上下文"),isOn:Binding(get:{model.contextExtension?.enabled ?? false},set:{value in Task{await model.setContextExtension(value)}}))
                .toggleStyle(.switch).controlSize(.small)
                .disabled(!model.serviceAvailable || model.changingContextExtension || model.contextExtension==nil || (!(model.contextExtension?.enabled ?? false) && (!(model.contextExtension?.compatible ?? false) || !(model.contextExtension?.available ?? false))))
            Text(L(model.serviceAvailable ? (model.contextExtension?.message ?? L("正在读取设置…")):L("控制服务未连接")))
                .font(.caption2).foregroundStyle(model.serviceAvailable && model.contextExtension?.effective == true ? Color.green:Color.secondary).fixedSize(horizontal:false,vertical:true)
            DisclosureGroup(L("拓展说明")){
                VStack(alignment:.leading,spacing:7){
                    Text(L("开启后可用上限拓展至 920K，最晚 904K 压缩。关闭后按 Codex 各模型的原生上限限制，超额预算会降低。切换后需重开 Codex。"))
                    Text(L("没有 Codex 连接时仅保存开关，不代表已生效。"))
                    Link(L("GitHub 项目说明"),destination:URL(string:"https://github.com/Fandy-ust/codex-context-control/blob/main/\(Localization.language == .en ? "docs/en/CONTEXT_EXTENSION.md":"docs/CONTEXT_EXTENSION.md")")!)
                }.font(.caption2).foregroundStyle(.secondary).padding(.top,4)
            }.font(.caption2)
        }.padding(12).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
}
