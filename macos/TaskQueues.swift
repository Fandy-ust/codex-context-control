import SwiftUI

struct QueueStage:Codable,Equatable {var minutes:Int;var reserve:Double}
struct QueuePeriod:Codable,Equatable {var reserve:Double;var stages:[QueueStage]}
struct QueueConfig:Codable,Equatable {
    var pool="codex"
    var resume="auto"
    var fiveHour=QueuePeriod(reserve:20,stages:[])
    var weekly=QueuePeriod(reserve:10,stages:[])
}
struct QueueTask:Decodable,Equatable,Identifiable {let id:String;let prompt:String;let status:String;let error:String?;var pending:Bool{["waiting","running","interrupted"].contains(status)}}
struct ChatTaskQueue:Decodable,Equatable,Identifiable {let id:String;let enabled:Bool;let config:QueueConfig;let tasks:[QueueTask];let revision:Int;let state:String;let message:String?}
struct TaskQueuesState:Decodable,Equatable {let sleepPrevented:Bool;let queues:[ChatTaskQueue]}

extension Controller {
    func taskQueue(_ id:String)->ChatTaskQueue?{taskQueues?.queues.first{$0.id==id}}
    func queueCommand(_ id:String?=nil,_ action:String,values:[String:Any]=[:]) async {
        guard !working else{return};working=true;defer{working=false}
        var body=values;body["action"]=action
        if let id{body["id"]=id;body["expectedRevision"]=taskQueue(id)?.revision ?? 0}
        do{taskQueues=try JSONDecoder().decode(TaskQueuesState.self,from:await api(ControlAPI.taskQueue,body:body))}
        catch{notice=error.localizedDescription}
    }
}
private func queueTaskStatus(_ status:String)->String{L(["waiting":"等待中","running":"执行中","completed":"已完成","interrupted":"已中断","error":"失败"][status] ?? status)}

struct TaskQueueStrip:View {
    @ObservedObject var model:Controller
    let chatID:String
    var body:some View {
        let q=model.taskQueue(chatID)
        HStack(spacing:16){
            Button(L(q?.enabled == true ? "关闭监视":"开启监视")){Task{await model.queueCommand(chatID,"enable",values:["enabled":q?.enabled != true])}}.buttonStyle(.bordered).disabled(model.working)
            VStack(alignment:.leading,spacing:4){Text(L("任务队列")).font(.headline);Text(L(q?.message ?? "未开启监视")).font(.caption).foregroundStyle(.secondary)
                ForEach(Array((q?.tasks.filter{$0.pending} ?? []).prefix(2))){task in Text(queueTaskStatus(task.status)+" · "+L(task.prompt)).font(.caption).lineLimit(1)}
            }.frame(maxWidth:.infinity,alignment:.leading)
            Button(L("详细")){model.queueDetailID=chatID}.buttonStyle(.bordered)
        }.padding(16).background(Color.white.opacity(0.04),in:RoundedRectangle(cornerRadius:12))
    }
}

struct TaskQueueManagerView:View {
    @ObservedObject var model:Controller
    var open:(String)->Void
    var body:some View {
        VStack(alignment:.leading,spacing:18){
            HStack{Text(L("所有任务队列")).font(.headline);Spacer();Button(L("关闭全部监视")){Task{await model.queueCommand(nil,"disable-all")}}.buttonStyle(.bordered).disabled(model.working)}
            Text(L(model.taskQueues?.sleepPrevented == true ? "有启用的队列，正在防止系统睡眠":"没有启用的队列，允许系统正常睡眠")).font(.caption).foregroundStyle(.secondary)
            ForEach(model.taskQueues?.queues.filter{$0.enabled || $0.tasks.contains{$0.status != "completed"}} ?? []){q in
                HStack{VStack(alignment:.leading){Text(model.chats.first{$0.id==q.id}?.title ?? q.id).lineLimit(1);Text(L(q.message ?? "")).font(.caption).foregroundStyle(.secondary)};Spacer();Button(L(q.enabled ? "关闭监视":"开启监视")){Task{await model.queueCommand(q.id,"enable",values:["enabled":!q.enabled])}}.buttonStyle(.bordered);Button(L("详细")){open(q.id)}.buttonStyle(.bordered)}.padding(12).background(Color.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10))
            }
        }.padding(20)
    }
}

struct QueuePeriodEditor:View {
    let title:String
    @Binding var period:QueuePeriod
    var body:some View {
        GroupBox(title){
            VStack(alignment:.leading,spacing:12){
                HStack{Text(L("最低保留额度 (%)"));TextField("%",value:$period.reserve,format:.number).frame(width:80)}
                ForEach(0..<2,id:\.self){index in
                    HStack{
                        Toggle(L("释放梯度")+" \(index+1)",isOn:Binding(get:{period.stages.count>index},set:{enabled in
                            if enabled{while period.stages.count<=index{period.stages.append(QueueStage(minutes:period.stages.isEmpty ? 30:15,reserve:period.stages.isEmpty ? min(period.reserve,10):min(period.stages[0].reserve,3)))}}
                            else if period.stages.count>index{period.stages.removeSubrange(index...)}
                        }))
                        if period.stages.count>index{
                            Text(L("距重置 (分钟)"));TextField("",value:Binding(get:{period.stages.indices.contains(index) ? period.stages[index].minutes:15},set:{if period.stages.indices.contains(index){period.stages[index].minutes=$0}}),format:.number).frame(width:65)
                            Text(L("保留 (%)"));TextField("",value:Binding(get:{period.stages.indices.contains(index) ? period.stages[index].reserve:0},set:{if period.stages.indices.contains(index){period.stages[index].reserve=$0}}),format:.number).frame(width:65)
                        }
                    }
                }
            }.padding(10)
        }
    }
}

struct TaskQueueDetailView:View {
    @ObservedObject var model:Controller
    let chatID:String
    var onBack:()->Void
    @State private var prompt=""
    @State private var editingTask:String?
    @State private var config=QueueConfig()
    @State private var feedback=""
    private var queue:ChatTaskQueue?{model.taskQueue(chatID)}
    var body:some View {
        VStack(spacing:0){
            HStack{Button(L("返回"),systemImage:"arrow.left",action:onBack).buttonStyle(.bordered);Text(L("任务队列")).font(.title2.bold());Spacer();Button(L(queue?.enabled == true ? "关闭监视":"开启监视")){Task{await model.queueCommand(chatID,"enable",values:["enabled":queue?.enabled != true])}}.buttonStyle(.bordered)}.padding(24).background(PanelStyle.background)
            ScrollView{
                VStack(alignment:.leading,spacing:20){
                    Text(model.chats.first{$0.id==chatID}?.title ?? chatID).font(.title3)
                    Text(L(queue?.message ?? "未开启监视")).foregroundStyle(.secondary)
                    if queue?.state=="paused"{Button(L("继续队列")){Task{await model.queueCommand(chatID,"enable",values:["enabled":true])}}.buttonStyle(.borderedProminent)}
                    Text(L("开启时会将当前执行中的任务加入队首；每项正常结束后才发送下一项完整提示词。队列完成后自动关闭监视。")).font(.caption).foregroundStyle(.secondary)
                    GroupBox(L(editingTask == nil ? "新增任务：完整提示词":"编辑任务提示词")){
                        VStack(alignment:.leading){TextEditor(text:$prompt).font(.body).frame(minHeight:110).padding(6)
                            HStack{Button(L(editingTask == nil ? "添加到队列":"保存")){Task{var values:[String:Any]=["prompt":prompt];if let editingTask{values["taskId"]=editingTask};await model.queueCommand(chatID,editingTask == nil ? "add":"edit",values:values);if model.taskQueue(chatID)?.tasks.contains(where:{$0.prompt==prompt}) == true{prompt="";editingTask=nil}}}.buttonStyle(.borderedProminent).disabled(prompt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty);if editingTask != nil{Button(L("取消")){editingTask=nil;prompt=""}.buttonStyle(.bordered)}}
                        }.padding(8)
                    }
                    if let tasks=queue?.tasks,!tasks.isEmpty{
                        Text(L("拖动排序任务")).font(.caption).foregroundStyle(.secondary)
                        List{
                            ForEach(tasks){task in
                                VStack(alignment:.leading,spacing:8){
                                    HStack{Text(queueTaskStatus(task.status)).font(.headline);Spacer()
                                        Button(L("编辑")){editingTask=task.id;prompt=task.prompt}.disabled(task.status=="running")
                                        Button(L("删除")){Task{await model.queueCommand(chatID,"delete",values:["taskId":task.id])}}.disabled(task.status=="running")
                                        if task.status=="running"{Button(L("停止当前任务")){Task{await model.queueCommand(chatID,"stop",values:["taskId":task.id])}}}
                                        if ["error","interrupted"].contains(task.status){Button(L("重试")){Task{await model.queueCommand(chatID,"retry",values:["taskId":task.id])}}}
                                    }.buttonStyle(.bordered)
                                    Text(L(task.prompt)).lineLimit(4).textSelection(.enabled)
                                    if let error=task.error{Text(L(error)).font(.caption).foregroundStyle(.orange)}
                                }.padding(.vertical,8)
                            }.onMove{source,destination in var order=tasks.map{$0.id};order.move(fromOffsets:source,toOffset:destination);Task{await model.queueCommand(chatID,"reorder",values:["order":order])}}
                        }.frame(height:min(400,CGFloat(tasks.count)*130+20)).listStyle(.inset)
                    }else{Text(L("暂无任务，监视不会启动")).foregroundStyle(.secondary)}
                    GroupBox(L("额度保护与自动恢复")){
                        VStack(alignment:.leading,spacing:16){
                            HStack{Text(L("额度类型"));TextField("codex",text:$config.pool)}
                            Picker(L("重置后"),selection:$config.resume){Text(L("自动恢复")).tag("auto");Text(L("手动恢复")).tag("manual")}.pickerStyle(.segmented)
                            Button(L("仅暂停当前周期")){Task{await model.queueCommand(chatID,"pause-cycle")}}.buttonStyle(.bordered)
                            QueuePeriodEditor(title:L("5 小时"),period:$config.fiveHour)
                            QueuePeriodEditor(title:"Weekly",period:$config.weekly)
                            Text(L("任一额度触线后等待当前轮次结束；低于保留线 2 个百分点或额度为 0 时立即中断。重置后恢复基础保留比例。")).font(.caption).foregroundStyle(.secondary)
                            Button(L("保存队列设置")){Task{do{let value=try JSONSerialization.jsonObject(with:JSONEncoder().encode(config));await model.queueCommand(chatID,"config",values:["config":value])}catch{feedback=error.localizedDescription}}}.buttonStyle(.borderedProminent)
                        }.padding(12)
                    }
                    if !feedback.isEmpty{Text(feedback).foregroundStyle(.orange)}
                    Text(model.notice).font(.caption).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth:900).frame(maxWidth:.infinity)
            }
        }.disabled(model.working).onAppear{config=queue?.config ?? QueueConfig()}.onChange(of:chatID){_,_ in config=queue?.config ?? QueueConfig();prompt="";editingTask=nil}
    }
}
