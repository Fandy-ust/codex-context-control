import Foundation
import CoreGraphics

/// Continuous linear scale captured once from ChartProxy, outside mouse events.
struct TimelineHoverMapping {
    let plot:CGRect
    let viewSize:CGSize
    let scaleStart:CGFloat
    let scaleEnd:CGFloat
    let upperBound:Double
    func position(at point:CGPoint)->Double? {
        guard upperBound>0,scaleEnd>scaleStart,point.y>=0,point.y<=viewSize.height,point.x>=plot.minX,point.x<=plot.maxX else{return nil}
        return max(0,min(upperBound,Double((point.x-scaleStart)/(scaleEnd-scaleStart))*upperBound))
    }
    func x(for position:Double)->CGFloat {scaleStart+CGFloat(position/upperBound)*(scaleEnd-scaleStart)}
}
struct TimelineBucketPresentation:Sendable {
    let speed:String;let speedHeading:String;let input:String;let cache:String;let output:String
    let counts:String;let events:String;let models:String;let minimumCache:String
    let settingsChanges:[String];let speedModes:[String]
    init(_ bucket:TimelineBucket){
        func amount(_ value:Double?)->String{value.map{$0>=1000 ? String(format:"%.1fK",$0/1000):String(format:"%.0f",$0)} ?? "—"}
        speed=bucket.speed.map{String(format:"%.1f t/s",$0)} ?? "—"
        speedHeading=bucket.speed.map{String(format:L("区间 %.1f tokens/s"),$0)} ?? L("无计时")
        input=amount(bucket.inputMean);cache=amount(bucket.cacheMean);output=bucket.outputSamples>0 ? amount(Double(bucket.outputTokens)):"—"
        counts=L("{0} 次响应 · {1} 次计时", bucket.responses, bucket.measured)
        events=L("最终 {0} · 用户输入 {1} · 压缩 {2} · 缓存零值 {3}", bucket.finals, bucket.users, bucket.compactions, bucket.zeroCaches)
        models=bucket.models.map{modelDisplayName($0)}.joined(separator:" · ")
        speedModes=bucket.speedModes.map{$0=="ultrafast" ? "⚡⚡ Ultrafast":"⚡ Fast"}
        settingsChanges=bucket.settingsChanges.map{change in
            let label=change.field=="model" ? L("模型切换"):change.field=="effort" ? L("思考深度"):L("速度模式")
            func value(_ raw:String)->String {
                if change.field=="model"{return modelDisplayName(raw)}
                if change.field=="effort"{return effortDisplayName(raw)}
                if raw=="fast"{return "⚡ Fast"};if raw=="ultrafast"{return "⚡⚡ Ultrafast"}
                return serviceTierDisplayName(raw)
            }
            let prefix=bucket.responses>1 ? "#\(change.responseIndex) ":""
            return prefix+label+"："+value(change.from)+" → "+value(change.to)
        }
        minimumCache=L("区间最低缓存：{0} tokens", bucket.cacheMinimum.map{String($0)} ?? "—")
    }
}
struct PreparedTimeline:Sendable {
    let data:TimelineData
    let labels:[TimelineBucketPresentation]
    init(_ data:TimelineData){self.data=data;labels=data.buckets.map(TimelineBucketPresentation.init)}
}
