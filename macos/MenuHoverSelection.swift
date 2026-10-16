import Foundation

/// A single pointer target for the whole list. Child views may be replaced by
/// sliders without losing tracking or depending on per-row enter/exit order.
@MainActor final class MenuHoverSelection {
    private var frames:[String:CGRect]=[:]
    private var point:CGPoint?
    private(set) var draggingID:String?
    var activeID:String? {
        if let draggingID{return draggingID}
        guard let point else{return nil}
        return frames.first{$0.value.contains(point)}?.key
    }
    func move(to point:CGPoint?){self.point=point}
    func updateFrames(_ frames:[String:CGRect]){
        self.frames=frames
        if let draggingID,frames[draggingID]==nil{self.draggingID=nil}
    }
    func setDragging(_ id:String,active:Bool){
        if active{draggingID=id}
        else if draggingID==id{draggingID=nil}
    }
}
