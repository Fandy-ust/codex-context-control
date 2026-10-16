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
    init(_ bucket:TimelineBucket){
        func amount(_ value:Double?)->String{value.map{$0>=1000 ? String(format:"%.1fK",$0/1000):String(format:"%.0f",$0)} ?? "—"}
        speed=bucket.speed.map{String(format:"%.1f t/s",$0)} ?? "—"
        speedHeading=bucket.speed.map{String(format:"区间 %.1f tokens/s",$0)} ?? "无计时"
        input=amount(bucket.inputMean);cache=amount(bucket.cacheMean);output=bucket.outputSamples>0 ? amount(Double(bucket.outputTokens)):"—"
        counts="\(bucket.responses) 次响应 · \(bucket.measured) 次计时"
        events="最终 \(bucket.finals) · 用户输入 \(bucket.users) · 压缩 \(bucket.compactions) · 缓存零值 \(bucket.zeroCaches)"
        models=bucket.models.map{modelDisplayName($0)}.joined(separator:" · ")
        minimumCache="区间最低缓存：\(bucket.cacheMinimum.map{String($0)} ?? "—") tokens"
    }
}
struct PreparedTimeline:Sendable {
    let data:TimelineData
    let labels:[TimelineBucketPresentation]
    init(_ data:TimelineData){self.data=data;labels=data.buckets.map(TimelineBucketPresentation.init)}
}
