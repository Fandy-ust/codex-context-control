import SwiftUI
import UniformTypeIdentifiers
import AppKit
import ImageIO

struct QueueStage:Codable,Equatable {var minutes:Int;var reserve:Double}
struct QueuePeriod:Codable,Equatable {var reserve:Double;var stages:[QueueStage]}
struct QueueConfig:Codable,Equatable {
    var pool="codex";var resume="auto"
    var fiveHour=QueuePeriod(reserve:20,stages:[])
    var weekly=QueuePeriod(reserve:10,stages:[])
}
struct QueueAttachment:Codable,Equatable,Identifiable {var path:String;var kind:String;var name:String;var id:String{path}}
struct QueueTaskSettings:Codable,Equatable {var quota=QueueConfig();var model="";var effort="";var attachments:[QueueAttachment]=[];var approval:String?=nil}
struct QueueModel:Decodable,Equatable,Identifiable {let id:String;let name:String;let efforts:[String];let defaultEffort:String?}
struct QueueTask:Decodable,Equatable,Identifiable {
    let id:String;let prompt:String;let status:String;let error:String?
    var settings:QueueTaskSettings?=nil
    var archivedAt:Double?=nil
    var pending:Bool{["waiting","running","interrupted","error"].contains(status)}
}
struct ChatTaskQueue:Decodable,Equatable,Identifiable {let id:String;let enabled:Bool;let config:QueueConfig;let tasks:[QueueTask];let revision:Int;let state:String;let message:String?}
struct TaskQueuesState:Decodable,Equatable {var monitoringEnabled:Bool?=nil;let sleepPrevented:Bool;let queues:[ChatTaskQueue]}

extension Controller {
    func queueHasFiveHour(_ pool:String)->Bool{guard let b=quota?.buckets.first(where:{$0.id==pool}) else{return false};return [b.primary,b.secondary].contains{$0?.windowDurationMins==300}}
    func queueRestartRequired(_ id:String)->Bool{chats.first{$0.id==id}?.queueRestartRequired == true}
    func queueMessage(_ id:String)->String{queueRestartRequired(id) ? "当前 Codex 接入版本不支持任务队列，请完整退出并重新打开 Codex。":taskQueue(id)?.message ?? "未开启监视"}
    func taskQueue(_ id:String)->ChatTaskQueue?{taskQueues?.queues.first{$0.id==id}}
    @discardableResult func queueCommand(_ id:String?=nil,_ action:String,values:[String:Any]=[:]) async -> Bool {
        guard !working else{return false};working=true;defer{working=false}
        var body=values;body["action"]=action
        if let id{body["id"]=id;body["expectedRevision"]=taskQueue(id)?.revision ?? 0}
        do{taskQueues=try JSONDecoder().decode(TaskQueuesState.self,from:await api(ControlAPI.taskQueue,body:body));return true}
        catch{notice=error.localizedDescription;return false}
    }
}
private func queueTaskStatus(_ status:String)->String{L(["waiting":"等待中","running":"执行中","completed":"已完成","interrupted":"已中断","error":"失败"][status] ?? status)}
private func quotaText(_ config:QueueConfig)->String{"5h \(config.fiveHour.reserve.formatted())%   ·   Weekly \(config.weekly.reserve.formatted())%"}
private func stageText(_ config:QueueConfig)->String{
    let items=[("5h",config.fiveHour),("Weekly",config.weekly)].flatMap{label,period in period.stages.prefix(2).enumerated().map{index,stage in "\(label) · \(L("梯度")) \(index+1)  \(stage.minutes)m / \(stage.reserve.formatted())%"}}
    return items.isEmpty ? L("未设置释放梯度"):items.joined(separator:"   ·   ")
}
struct QueueMonitorToggle:View {
    @ObservedObject var model:Controller;let chatID:String
    var body:some View{Toggle(L(model.queueRestartRequired(chatID) ? "需重启 Codex":"监视"),isOn:Binding(get:{model.taskQueue(chatID)?.enabled == true},set:{value in Task{await model.queueCommand(chatID,"enable",values:["enabled":value])}})).toggleStyle(.switch).disabled(model.working || (model.taskQueue(chatID)?.enabled != true && model.queueRestartRequired(chatID)))}
}
struct QueueTaskCard:View {
    @ObservedObject var model:Controller
    let chatID:String;let task:QueueTask;var compact=false;var open:()->Void
    private var config:QueueConfig{task.settings?.quota ?? model.taskQueue(chatID)?.config ?? QueueConfig()}
    var body:some View{
        VStack(alignment:.leading,spacing:10){
            HStack(alignment:.top){
                Button(action:open){VStack(alignment:.leading,spacing:8){
                    HStack{Circle().fill(task.status=="running" ? Color.blue:task.status=="error" ? Color.orange:Color.secondary).frame(width:6,height:6);Text(queueTaskStatus(task.status)).font(.caption);Spacer();Text(task.settings?.model.isEmpty == false ? task.settings!.model:L("跟随聊天")).font(.caption).foregroundStyle(.secondary).lineLimit(1)}
                    Text(task.prompt).font(.system(size:13,weight:.medium)).lineLimit(2).frame(maxWidth:.infinity,alignment:.leading)
                    Text(model.queueHasFiveHour(config.pool) ? quotaText(config):"Weekly \(config.weekly.reserve.formatted())%").font(.caption).foregroundStyle(.secondary)
                    if !compact || !config.fiveHour.stages.isEmpty || !config.weekly.stages.isEmpty{Text(stageText(QueueConfig(pool:config.pool,resume:config.resume,fiveHour:QueuePeriod(reserve:config.fiveHour.reserve,stages:model.queueHasFiveHour(config.pool) ? config.fiveHour.stages:[]),weekly:config.weekly))).font(.caption2).foregroundStyle(.secondary).lineLimit(2)}
                }.contentShape(Rectangle())}.buttonStyle(.plain)
                Button{Task{await model.queueCommand(chatID,"delete",values:["taskId":task.id])}}label:{Image(systemName:"xmark")}.buttonStyle(.bordered).controlSize(.small).help(L("删除任务")).disabled(task.status=="running")
            }
            if let error=task.error{Text(L(error)).font(.caption).foregroundStyle(.orange)}
            if task.status=="running"{Button(L("停止当前任务")){Task{await model.queueCommand(chatID,"stop",values:["taskId":task.id])}}.buttonStyle(.bordered)}
            if ["error","interrupted"].contains(task.status){Button(L("重试")){Task{await model.queueCommand(chatID,"retry",values:["taskId":task.id])}}.buttonStyle(.bordered)}
        }.padding(compact ? 12:16).background(Color.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14)).overlay(RoundedRectangle(cornerRadius:14).strokeBorder(.white.opacity(0.07)))
    }
}
struct TaskQueueStrip:View {
    @ObservedObject var model:Controller;let chatID:String
    var body:some View{
        VStack(alignment:.leading,spacing:12){
            HStack(spacing:16){QueueMonitorToggle(model:model,chatID:chatID);VStack(alignment:.leading,spacing:4){Text(L("任务队列")).font(.headline);Text(L(model.queueMessage(chatID))).font(.caption).foregroundStyle(.secondary)}.frame(maxWidth:.infinity,alignment:.leading);Button(L("详细")){model.queueDetailID=chatID}.buttonStyle(.bordered)}
            ForEach(Array((model.taskQueue(chatID)?.tasks.filter{$0.pending} ?? []).prefix(2))){task in QueueTaskCard(model:model,chatID:chatID,task:task,compact:true){model.queueTaskEditID=task.id;model.queueDetailID=chatID}}
        }.padding(.vertical,16)
    }
}
struct TaskQueueManagerView:View {
    @ObservedObject var model:Controller;var open:(String)->Void
    var body:some View{
        VStack(alignment:.leading,spacing:18){
            Toggle(L("全局额度监视"),isOn:Binding(get:{model.taskQueues?.monitoringEnabled != false},set:{value in Task{await model.queueCommand(nil,"monitoring",values:["enabled":value])}})).toggleStyle(.switch).disabled(model.working)
            Text(L("控制已开启监视的聊天；关闭后保留各聊天的开关和限额。监视持续生效，队列结束后不会自动关闭。")).font(.caption).foregroundStyle(.secondary)
            HStack{Text(L("所有任务队列")).font(.headline);Spacer();Button(L("关闭全部监视")){Task{await model.queueCommand(nil,"disable-all")}}.buttonStyle(.bordered).disabled(model.working)}
            Text(L(model.taskQueues?.sleepPrevented == true ? "有启用的队列，正在防止系统睡眠":"没有启用的队列，允许系统正常睡眠")).font(.caption).foregroundStyle(.secondary)
            ForEach(model.taskQueues?.queues.filter{$0.enabled || $0.tasks.contains{$0.status != "completed"}} ?? []){q in
                HStack{QueueMonitorToggle(model:model,chatID:q.id);VStack(alignment:.leading){Text(model.chats.first{$0.id==q.id}?.title ?? q.id).lineLimit(1);Text(L(model.queueMessage(q.id))).font(.caption).foregroundStyle(.secondary)};Spacer();Button(L("详细")){open(q.id)}.buttonStyle(.bordered)}.padding(16).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
            }
        }.padding(20)
    }
}
struct QueuePeriodEditor:View {
    let title:String;@Binding var period:QueuePeriod
    var body:some View{
        GroupBox(title){VStack(alignment:.leading,spacing:14){
            HStack{Text(L("基础保留"));Spacer();TextField("%",value:$period.reserve,format:.number).frame(width:70);Text("%")}
            ForEach(0..<3,id:\.self){index in stage(index)}
        }.padding(12)}
    }
    private func stage(_ index:Int)->some View{
        HStack{
            Toggle(L("梯度")+" \(index+1)",isOn:Binding(get:{period.stages.count>index},set:{enabled in
                if enabled{while period.stages.count<=index{let n=period.stages.count;period.stages.append(QueueStage(minutes:[30,15,5][n],reserve:min(n==0 ? period.reserve:period.stages[n-1].reserve,[10.0,3.0,1.0][n])))}}
                else if period.stages.count>index{period.stages.removeSubrange(index...)}
            }))
            Spacer()
            if period.stages.count>index{
                Text(L("距重置（分钟）")).font(.caption)
                TextField("",value:Binding(get:{period.stages.indices.contains(index) ? period.stages[index].minutes:5},set:{if period.stages.indices.contains(index){period.stages[index].minutes=$0}}),format:.number).frame(width:60)
                TextField("%",value:Binding(get:{period.stages.indices.contains(index) ? period.stages[index].reserve:0},set:{if period.stages.indices.contains(index){period.stages[index].reserve=$0}}),format:.number).frame(width:60);Text("%")
            }
        }
    }
}
struct QueueQuotaEditor:View {
    @Binding var config:QueueConfig;var showFiveHour=true
    var body:some View{
        VStack(alignment:.leading,spacing:18){
            Picker(L("重置后"),selection:$config.resume){Text(L("自动恢复")).tag("auto");Text(L("手动恢复")).tag("manual")}.pickerStyle(.segmented)
            if showFiveHour{QueuePeriodEditor(title:L("5 小时"),period:$config.fiveHour)}
            QueuePeriodEditor(title:"Weekly",period:$config.weekly)
        }
    }
}
struct TaskQueueDetailView:View {
    @ObservedObject var model:Controller;let chatID:String;var onBack:()->Void
    @State private var config=QueueConfig();@State private var editor:QueueTask?;@State private var expandedEditor:QueueTask?
    private var queue:ChatTaskQueue?{model.taskQueue(chatID)}
    var body:some View{
        Group{if let expandedEditor{QueueTaskEditor(model:model,chatID:chatID,task:expandedEditor,expanded:true,resize:{draft in self.expandedEditor=nil;editor=draft},close:{self.expandedEditor=nil})}else{overview}}
    }
    private var overview:some View{
        VStack(spacing:0){
            HStack{Button(L("返回"),systemImage:"arrow.left",action:onBack).buttonStyle(.bordered);Text(L("任务队列")).font(.title2.bold());Spacer();QueueMonitorToggle(model:model,chatID:chatID)}.padding(24).background(PanelStyle.background)
            ScrollView{VStack(alignment:.leading,spacing:20){
                Text(model.chats.first{$0.id==chatID}?.title ?? chatID).font(.title3)
                Text(L(model.queueMessage(chatID))).foregroundStyle(.secondary)
                HStack{Text(L("任务")).font(.headline);Spacer();Button(L("添加任务"),systemImage:"plus"){editor=QueueTask(id:UUID().uuidString,prompt:"",status:"draft",error:nil,settings:QueueTaskSettings(quota:queue?.config ?? QueueConfig()))}.buttonStyle(.borderedProminent)}
                taskList
                DisclosureGroup(L("当前聊天的默认限额")){
                    VStack(alignment:.leading,spacing:16){Text(L("用于此聊天的持续监视和新任务；已添加任务保留各自的设置。")).font(.caption).foregroundStyle(.secondary);QueueQuotaEditor(config:$config,showFiveHour:model.queueHasFiveHour(config.pool));Button(L("保存默认限额")){Task{if let value=try? JSONSerialization.jsonObject(with:JSONEncoder().encode(config)){await model.queueCommand(chatID,"config",values:["config":value])}}}.buttonStyle(.borderedProminent)}.padding(.top,12)
                }.padding(18).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
                HStack{Button(L("仅暂停当前周期")){Task{await model.queueCommand(chatID,"pause-cycle")}}}.buttonStyle(.bordered)
                Text(model.notice).font(.caption).foregroundStyle(.secondary)
            }.padding(24).frame(maxWidth:900).frame(maxWidth:.infinity).softScrollEdges()}
        }.disabled(model.working).onAppear{config=queue?.config ?? QueueConfig();if let id=model.queueTaskEditID{editor=queue?.tasks.first{$0.id==id};model.queueTaskEditID=nil}}.onChange(of:chatID){_,_ in config=queue?.config ?? QueueConfig()}
        .sheet(item:$editor){task in QueueTaskEditor(model:model,chatID:chatID,task:task,resize:{draft in editor=nil;expandedEditor=draft},close:{editor=nil})}
    }
    @ViewBuilder private var taskList:some View{
        if let all=queue?.tasks,!all.isEmpty{
            let tasks=all.filter{$0.archivedAt==nil}
            List{ForEach(tasks){task in QueueTaskCard(model:model,chatID:chatID,task:task){editor=task}.listRowSeparator(.hidden).listRowBackground(Color.clear)}.onMove{source,destination in var ids=tasks.map{$0.id};ids.move(fromOffsets:source,toOffset:destination);Task{await model.queueCommand(chatID,"reorder",values:["order":ids+all.filter{$0.archivedAt != nil}.map{$0.id}])}}}.listStyle(.plain).scrollContentBackground(.hidden).frame(height:min(540,CGFloat(tasks.count)*180+20))
            if all.contains(where:{$0.archivedAt != nil}){DisclosureGroup(L("归档任务")){ForEach(all.filter{$0.archivedAt != nil}){task in QueueTaskCard(model:model,chatID:chatID,task:task){editor=task}}}}
        }else{Text(L("添加你的第一个任务")).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:100)}
    }
}

private func queueEffortName(_ value:String)->String{["none":"None","minimal":"Minimal","low":"Low","medium":"Medium","high":"High","xhigh":"Extra high","max":"Max","ultra":"Ultra"][value] ?? "Default"}
struct QueueTaskEditor:View {
    @ObservedObject var model:Controller;let chatID:String;let task:QueueTask;var expanded:Bool;var resize:(QueueTask)->Void;var close:()->Void
    @State private var prompt:String;@State private var settings:QueueTaskSettings
    @State private var tab="prompt";@State private var showImporter=false;@State private var imagesOnly=false;@State private var showModel=false;@State private var showAccess=false
    init(model:Controller,chatID:String,task:QueueTask,expanded:Bool=false,resize:@escaping(QueueTask)->Void,close:@escaping ()->Void){self.model=model;self.chatID=chatID;self.task=task;self.expanded=expanded;self.resize=resize;self.close=close;_prompt=State(initialValue:task.prompt);_settings=State(initialValue:task.settings ?? QueueTaskSettings(quota:model.taskQueue(chatID)?.config ?? QueueConfig()))}
    private var currentModel:QueueModel?{let id=settings.model.isEmpty ? model.chats.first{$0.id==chatID}?.model:settings.model;return model.queueModels.first{$0.id==id}}
    private var efforts:[String]{currentModel?.efforts ?? []}
    private var effort:String{settings.effort.isEmpty ? currentModel?.defaultEffort ?? efforts.first ?? "":settings.effort}
    private var snapshot:QueueTask{QueueTask(id:task.id,prompt:prompt,status:task.status,error:task.error,settings:settings)}
    var body:some View{
        VStack(alignment:.leading,spacing:16){
            HStack{Button(L("返回"),systemImage:"arrow.left",action:close).buttonStyle(.bordered);Text(L(task.status=="draft" ? "添加任务":"任务设置")).font(.title2.bold());Spacer();if tab=="quota"{Button(L(task.status=="draft" ? "添加到队列":"保存任务")){Task{await save()}}.buttonStyle(.borderedProminent).disabled(prompt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || model.working)}}
            if !expanded{Picker(L("任务设置"),selection:$tab){Text(L("任务内容")).tag("prompt");Text(L("额度设置")).tag("quota")}.pickerStyle(.segmented)}
            if expanded{promptEditor}else{ScrollView{Group{if tab=="quota"{QueueQuotaEditor(config:$settings.quota,showFiveHour:model.queueHasFiveHour(settings.quota.pool)).padding(.vertical,8)}else{promptEditor}}.softScrollEdges()}}
        }.padding(24).frame(width:expanded ? nil:760,height:expanded ? nil:700).frame(maxWidth:expanded ? .infinity:nil,maxHeight:expanded ? .infinity:nil).background(PanelStyle.background).preferredColorScheme(.dark)
        .fileImporter(isPresented:$showImporter,allowedContentTypes:imagesOnly ? [.image]:[.item],allowsMultipleSelection:true){result in if case .success(let urls)=result{addURLs(urls)}}
        .onChange(of:settings.model){_,_ in settings.effort=""}
    }
    private var approvalName:String{["inherit":"沿用当前","ask":"Ask for approval","auto":"Approve for me","full":"Full access"][settings.approval ?? "inherit"] ?? "沿用当前"}
    private var promptEditor:some View{
        VStack(alignment:.leading,spacing:12){
            if !settings.attachments.isEmpty{LazyVGrid(columns:[GridItem(.adaptive(minimum:108,maximum:120))],alignment:.leading,spacing:12){ForEach(settings.attachments){file in QueueAttachmentTile(file:file){settings.attachments.removeAll{$0.path==file.path}}}}.frame(maxHeight:expanded ? 124:nil).clipped()}
            QueuePromptTextView(text:$prompt,pasteAttachments:pasteAttachments).frame(minHeight:expanded ? 120:300,maxHeight:expanded ? .infinity:460).overlay(alignment:.topLeading){if prompt.isEmpty{Text(L("描述要完成的工作与验收条件…")).foregroundStyle(.secondary).padding(.leading,5).padding(.top,2).allowsHitTesting(false)}}.accessibilityLabel(L("完整任务提示词"))

            HStack(spacing:10){
                if prompt.trimmingCharacters(in:.whitespacesAndNewlines).lowercased() != "/compact"{
                    Menu{Button(L("插入图片"),systemImage:"photo"){imagesOnly=true;showImporter=true};Button(L("插入文件"),systemImage:"doc"){imagesOnly=false;showImporter=true}}label:{Image(systemName:"plus").font(.title3)}.menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width:30,height:36).help(L("添加附件"))
                    Button{showAccess.toggle()}label:{Label(L(approvalName),systemImage:"exclamationmark.shield").font(.callout).foregroundStyle(settings.approval=="full" ? Color.orange:Color.secondary).frame(height:36)}.buttonStyle(.plain).popover(isPresented:$showAccess,arrowEdge:.bottom){approvalPanel}
                }
                Spacer()
                if prompt.trimmingCharacters(in:.whitespacesAndNewlines).lowercased() != "/compact"{
                    Button{showModel.toggle()}label:{HStack(spacing:4){Text(currentModel?.name ?? L("跟随聊天"));Text(efforts.isEmpty ? L("模型默认"):queueEffortName(effort)).foregroundStyle(.secondary)}}.font(.callout).frame(height:36).buttonStyle(.plain).popover(isPresented:$showModel,arrowEdge:.bottom){modelPanel.padding(4)}
                }
                Button{Task{await save()}}label:{Image(systemName:"arrow.up").font(.system(size:19,weight:.medium)).foregroundStyle(.white).frame(width:34,height:34).background(prompt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty ? Color.gray:Color.blue,in:Circle())}.buttonStyle(.plain).disabled(prompt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || model.working).help(L(task.status=="draft" ? "添加到队列":"保存任务")).accessibilityLabel(L(task.status=="draft" ? "添加到队列":"保存任务")).keyboardShortcut(.return,modifiers:.command)
            }.frame(height:36)
        }.padding(18).frame(maxWidth:.infinity,maxHeight:expanded ? .infinity:nil,alignment:.topLeading).background(.white.opacity(0.09),in:RoundedRectangle(cornerRadius:24)).overlay(RoundedRectangle(cornerRadius:24).strokeBorder(.white.opacity(0.1))).disabled(task.status=="running")
    }
    private var approvalPanel:some View{
        VStack(alignment:.leading,spacing:4){
            Text(L("操作如何获得批准？")).font(.caption).foregroundStyle(.secondary).padding(.bottom,8)
            ForEach(["inherit","ask","auto","full"],id:\.self){mode in
                Button{settings.approval=mode;showAccess=false}label:{
                    HStack(alignment:.top,spacing:10){
                        Image(systemName:mode=="ask" ? "hand.raised":mode=="auto" ? "checkmark.shield":"exclamationmark.shield").frame(width:20)
                        VStack(alignment:.leading,spacing:3){Text(L(["inherit":"沿用当前","ask":"Ask for approval","auto":"Approve for me","full":"Full access"][mode] ?? mode));Text(L(["inherit":"沿用当前聊天权限","ask":"编辑外部文件和访问网络时请求批准","auto":"仅为潜在风险操作请求确认","full":"可访问网络及电脑上的文件"][mode] ?? "")).font(.caption).foregroundStyle(.secondary)}
                        Spacer();if (settings.approval ?? "inherit")==mode{Image(systemName:"checkmark")}
                    }.foregroundStyle(mode=="full" ? Color.orange:Color.primary).padding(.vertical,7).contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }.padding(16).frame(width:340)
    }
    private var modelPanel:some View{
        VStack(spacing:6){
            HStack{Image(systemName:"bolt").foregroundStyle(.secondary);Spacer();Text(efforts.isEmpty ? L("模型默认"):queueEffortName(effort)).foregroundStyle(.blue).font(.headline);Spacer();Button{settings.effort=""}label:{Image(systemName:"arrow.counterclockwise")}.buttonStyle(.borderless).help(L("恢复模型默认思考程度"))}
            Menu{Button(L("跟随聊天")){settings.model=""};ForEach(model.queueModels){m in Button(m.name){settings.model=m.id}}}label:{Text((currentModel?.name ?? L("跟随聊天"))+" ›").font(.caption).foregroundStyle(.secondary)}.menuStyle(.borderlessButton).fixedSize()
            ZStack{HStack{ForEach(Array(efforts.enumerated()),id:\.offset){index,_ in Circle().fill(.secondary.opacity(0.5)).frame(width:4,height:4);if index<efforts.count-1{Spacer()}}}.padding(.horizontal,8);Slider(value:Binding(get:{Double(efforts.firstIndex(of:effort) ?? 0)},set:{value in let index=Int(value);if efforts.indices.contains(index){settings.effort=efforts[index]}}),in:0...Double(max(1,efforts.count-1)),step:1).labelsHidden().disabled(efforts.count<2)}.accessibilityLabel(L("思考程度"))
        }.padding(14).frame(width:286).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:22)).overlay(RoundedRectangle(cornerRadius:22).strokeBorder(.white.opacity(0.14)))
    }
    private func addURLs(_ urls:[URL]){for url in urls where !settings.attachments.contains(where:{$0.path==url.path}) && settings.attachments.count<20{settings.attachments.append(QueueAttachment(path:url.path,kind:["png","jpg","jpeg","webp","gif","bmp"].contains(url.pathExtension.lowercased()) ? "image":"file",name:url.lastPathComponent))}}
    private func pasteAttachments(_ board:NSPasteboard)->Bool{
        let urls=(board.readObjects(forClasses:[NSURL.self],options:[.urlReadingFileURLsOnly:true]) as? [URL]) ?? []
        if !urls.isEmpty{addURLs(urls);return true}
        guard let image=NSImage(pasteboard:board),let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let data=bitmap.representation(using:.png,properties:[:]) else{return false}
        do{guard data.count<=32*1024*1024 else{model.notice=L("图片过大，请插入小于 32 MB 的图片");return true};let folder=model.home.appendingPathComponent("queue-attachments");try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true);let url=folder.appendingPathComponent(UUID().uuidString+".png");try data.write(to:url,options:.atomic);addURLs([url])}catch{model.notice=error.localizedDescription}
        return true
    }
    private func save() async{
        do{let value=try JSONSerialization.jsonObject(with:JSONEncoder().encode(settings));let quota=try JSONSerialization.jsonObject(with:JSONEncoder().encode(settings.quota));let action=task.status=="running" ? "task-config":task.status=="draft" ? "add":"edit";if await model.queueCommand(chatID,action,values:["taskId":task.id,"prompt":prompt,"settings":value,"config":quota]){close()}}catch{model.notice=error.localizedDescription}
    }
}
private struct QueueAttachmentTile:View{
    let file:QueueAttachment;var remove:()->Void
    @State private var thumbnail:NSImage?
    var body:some View{
        ZStack(alignment:.bottom){
            if let thumbnail{Image(nsImage:thumbnail).resizable().scaledToFill().frame(width:112,height:112).clipped()}
            else{VStack(spacing:8){Image(systemName:file.kind=="image" ? "photo":"doc").font(.largeTitle).foregroundStyle(.secondary);Text(file.name).font(.caption2).lineLimit(2).multilineTextAlignment(.center)}.padding(10).frame(width:112,height:112)}
        }.frame(width:112,height:112).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:10)).clipShape(RoundedRectangle(cornerRadius:10)).overlay(RoundedRectangle(cornerRadius:10).strokeBorder(.white.opacity(0.12))).overlay(alignment:.topTrailing){Button(action:remove){Image(systemName:"xmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.white,.gray).font(.system(size:17))}.buttonStyle(.plain).padding(4).help(L("移除附件"))}.help(file.name).task(id:file.path){
            guard file.kind=="image",let source=CGImageSourceCreateWithURL(URL(fileURLWithPath:file.path) as CFURL,nil),let image=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:160,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary) else{return};thumbnail=NSImage(cgImage:image,size:.zero)
        }
    }
}
private struct QueuePromptTextView:NSViewRepresentable{
    @Binding var text:String;var pasteAttachments:(NSPasteboard)->Bool
    func makeCoordinator()->Coordinator{Coordinator(self)}
    func makeNSView(context:Context)->NSScrollView{
        let scroll=NSScrollView();scroll.hasVerticalScroller=true;scroll.drawsBackground=false
        let editor=QueuePasteTextView();editor.registerForDraggedTypes([.fileURL,.tiff,.png]);editor.minSize=NSSize(width:0,height:0);editor.maxSize=NSSize(width:CGFloat.greatestFiniteMagnitude,height:CGFloat.greatestFiniteMagnitude);editor.frame=NSRect(origin:.zero,size:scroll.contentSize);editor.isRichText=false;editor.drawsBackground=false;editor.textColor = .labelColor;editor.font = .systemFont(ofSize:15);editor.isVerticallyResizable=true;editor.isHorizontallyResizable=false;editor.autoresizingMask=[.width];editor.textContainer?.widthTracksTextView=true;editor.delegate=context.coordinator;editor.pasteAttachments=pasteAttachments;scroll.documentView=editor;editor.string=text;return scroll
    }
    func updateNSView(_ scroll:NSScrollView,context:Context){context.coordinator.parent=self;guard let editor=scroll.documentView as? QueuePasteTextView else{return};editor.pasteAttachments=pasteAttachments;if editor.string != text{let selection=editor.selectedRange();editor.string=text;editor.setSelectedRange(NSRange(location:min(selection.location,(text as NSString).length),length:0))};editor.isEditable=context.environment.isEnabled}
    class Coordinator:NSObject,NSTextViewDelegate{var parent:QueuePromptTextView;init(_ parent:QueuePromptTextView){self.parent=parent};func textDidChange(_ notification:Notification){if let editor=notification.object as? NSTextView{parent.text=editor.string}}}
}
private class QueuePasteTextView:NSTextView{
    var pasteAttachments:((NSPasteboard)->Bool)?
    override func draggingEntered(_ sender:NSDraggingInfo)->NSDragOperation{if isEditable && sender.draggingPasteboard.canReadObject(forClasses:[NSURL.self,NSImage.self],options:nil){return .copy};return super.draggingEntered(sender)}
    override func performDragOperation(_ sender:NSDraggingInfo)->Bool{if isEditable && pasteAttachments?(sender.draggingPasteboard)==true{return true};return super.performDragOperation(sender)}
    override func paste(_ sender:Any?){guard isEditable else{return};if pasteAttachments?(NSPasteboard.general)==true{return};super.paste(sender)}
}
