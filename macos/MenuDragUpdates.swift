import Foundation

/// Merge high-frequency pointer events into display-rate updates. The final
/// pointer value is flushed synchronously so K precision is never lost.
@MainActor final class MenuDragUpdates {
    private let interval:TimeInterval
    private let clock:()->TimeInterval
    private var lastEmission:TimeInterval?
    private var pending:(()->Void)?
    private var scheduled=false
    private var generation=0
    init(maxFPS:Double=60,clock:@escaping()->TimeInterval={ProcessInfo.processInfo.systemUptime}){
        interval=1/max(1,maxFPS);self.clock=clock
    }
    func submit(_ update:@escaping()->Void){
        pending=update
        let remaining=lastEmission.map{interval-(clock()-$0)} ?? 0
        if remaining<=0{flush();return}
        guard !scheduled else{return};scheduled=true
        let token=generation
        DispatchQueue.main.asyncAfter(deadline:.now()+remaining){[weak self] in
            guard let self,self.generation==token else{return}
            self.flush()
        }
    }
    func finish(_ update:()->Void){cancel();lastEmission=clock();update()}
    func reset(){cancel();lastEmission=nil}
    func cancel(){generation+=1;pending=nil;scheduled=false}
    private func flush(){
        let update=pending;cancel()
        if let update{lastEmission=clock();update()}
    }
}
