import Foundation

struct TimelineEntry:Identifiable,Sendable {
    let id:String;let position:Int;let kind:String;let eventType:String
    let response:ContextStatistics.Response?;let event:ContextStatistics.TimelineEvent?
}
struct TimelinePlotPoint:Identifiable,Sendable {
    let id:Int;let position:Double;let value:Double;let series:Int
}
func timelineSpeedMode(_ raw:String?)->String? {
    switch raw {case "priority","fast":return "fast";case "default","standard":return "standard";default:return raw?.isEmpty == false ? raw:nil}
}
struct TimelineSettingChange:Sendable {
    let responseIndex:Int;let field:String;let from:String;let to:String
}
struct TimelineBucket:Identifiable,Sendable {
    let id:Int;let entryRange:Range<Int>;let startPosition:Int;let endPosition:Int
    var position:Double{Double(startPosition+endPosition)/2}
    let firstResponse:Int?;let lastResponse:Int?;let responses:Int;let measured:Int
    let inputSamples:Int;let cacheSamples:Int;let inputMean:Double?;let cacheMean:Double?;let cacheMinimum:Int?;let speed:Double?
    let outputTokens:Int;let outputSamples:Int;let finals:Int;let users:Int;let compactions:Int;let zeroCaches:Int
    let models:[String];let settingsChanges:[TimelineSettingChange];let speedModes:[String]
    var title:String {
        if let firstResponse,let lastResponse{return firstResponse==lastResponse ? L("响应 #{0}", firstResponse):L("响应 #{0}–#{1}", firstResponse, lastResponse)}
        return L("对话事件")
    }
}
private struct TimelineAccumulator {
    var start:Int;var end:Int
    var firstResponse:Int?;var lastResponse:Int?;var responses=0;var measured=0
    var inputSum=0.0;var inputCount=0;var cacheSum=0.0;var cacheCount=0;var cacheMinimum:Int?
    var generatedTokens=0.0;var duration=0.0;var output=0;var outputSamples=0
    var finals=0;var users=0;var compactions=0;var zeros=0;var models=Set<String>();var settingsChanges:[TimelineSettingChange]=[];var speedModes:[String]=[]
}
private struct TimelineMetric {
    struct Bin {var sum=0.0;var count=0;}
    var bins:[Bin];var state:Double?;var source:Int?
    mutating func reset(){state=nil;source=nil}
    mutating func add(_ value:Double?,source next:Int,bucket:Int,period:Int){
        guard let value,value.isFinite else{reset();return}
        if let source,source != next{reset()};source=next
        let alpha=period<=1 ? 1:2/Double(period+1)
        let smoothed=state.map{$0+alpha*(value-$0)} ?? value;state=smoothed
        bins[bucket].sum+=smoothed;bins[bucket].count+=1
    }
    func points(_ buckets:[TimelineBucket],raw:(TimelineBucket)->Double?,period:Int)->[TimelinePlotPoint]{
        var result:[TimelinePlotPoint]=[],series=0
        for (index,bin) in bins.enumerated(){
            // EMA resets and missing individual samples do not invalidate a
            // measured interval mean. Break only across an entirely empty bin.
            guard bin.count>0 else{series+=1;continue}
            let value=period<=1 ? raw(buckets[index]):bin.sum/Double(bin.count)
            if let value{result.append(TimelinePlotPoint(id:index,position:buckets[index].position,value:value,series:series))}else{series+=1}
        }
        return result
    }
}
struct TimelineData:Sendable {
    let revision:String;let period:Int;let bucketSize:Int
    let entries:[TimelineEntry];let buckets:[TimelineBucket]
    let byID:[String:Int];let entryBuckets:[Int]
    let speed:[TimelinePlotPoint];let input:[TimelinePlotPoint];let cache:[TimelinePlotPoint]
    let measuredCount:Int;let responseCount:Int
    var upperBound:Double{Double(max(2,(entries.last?.position ?? 0)+1))}
    func bucket(at position:Double)->Int? {
        guard !entries.isEmpty else{return nil}
        var low=0,high=entries.count
        while low<high{let mid=(low+high)/2;if Double(entries[mid].position)<position{low=mid+1}else{high=mid}}
        let index=low==0 ? 0:low==entries.count ? entries.count-1:position-Double(entries[low-1].position)<=Double(entries[low].position)-position ? low-1:low
        return entryBuckets[index]
    }
    func entry(_ id:String)->TimelineEntry?{byID[id].map{entries[$0]}}
    func bucket(for id:String)->Int?{byID[id].map{entryBuckets[$0]}}
    func page(bucket:Int,page:Int,size:Int=20)->ArraySlice<TimelineEntry>{
        guard buckets.indices.contains(bucket) else{return entries[0..<0]}
        let range=buckets[bucket].entryRange,start=min(range.upperBound,range.lowerBound+max(0,page)*max(1,size))
        return entries[start..<min(range.upperBound,start+max(1,size))]
    }
    init(responses:[ContextStatistics.Response],events:[ContextStatistics.TimelineEvent],revision:String,period:Int=0,limit:Int=120) throws {
        self.revision=revision;self.period=max(0,period);responseCount=responses.count
        measuredCount=responses.reduce(0){$0+($1.tokensPerSecond == nil ? 0:1)}
        let output=responses.map{TimelineEntry(id:$0.id,position:$0.position,kind:L("响应 #{0} · {1}", $0.index, L($0.kind)),eventType:$0.eventType,response:$0,event:nil)}
        let inputEvents=events.map{TimelineEntry(id:$0.id,position:$0.position,kind:$0.kind,eventType:$0.eventType,response:nil,event:$0)}
        let entries=(output+inputEvents).sorted{$0.position<$1.position};self.entries=entries
        bucketSize=max(1,Int(ceil(Double(max(responses.count,events.isEmpty ? 0:1))/Double(max(1,limit)))))
        let eventBinSize=max(1,Int(ceil(Double(entries.count)/Double(max(1,limit)))))
        let count=responses.isEmpty ? Int(ceil(Double(entries.count)/Double(eventBinSize))):Int(ceil(Double(responses.count)/Double(bucketSize)))
        guard !entries.isEmpty else{buckets=[];byID=[:];entryBuckets=[];speed=[];input=[];cache=[];return}
        var bins=Array(repeating:TimelineAccumulator(start:0,end:0),count:count)
        var speed=TimelineMetric(bins:Array(repeating:.init(),count:count)),input=TimelineMetric(bins:Array(repeating:.init(),count:count)),cache=TimelineMetric(bins:Array(repeating:.init(),count:count))
        var lookup:[String:Int]=[:],mapping:[Int]=[],responseIndex=0,seenBins=Set<Int>(),previousConfig:String?,previousSettings:ContextStatistics.Response.Config?
        for (index,entry) in entries.enumerated(){
            if index%256==0{try Task.checkCancellation()}
            let bucket=min(count-1,responses.isEmpty ? index/eventBinSize:responseIndex/bucketSize)
            lookup[entry.id]=index;mapping.append(bucket)
            if seenBins.insert(bucket).inserted{bins[bucket].start=index};bins[bucket].end=index+1
            if entry.eventType=="compaction",entry.event != nil{bins[bucket].compactions+=1;speed.reset();input.reset();cache.reset()}
            if entry.event != nil && ["user_input","steering"].contains(entry.eventType){bins[bucket].users+=1}
            guard let r=entry.response else{continue}
            responseIndex+=1;bins[bucket].responses+=1
            if bins[bucket].firstResponse==nil{bins[bucket].firstResponse=r.index};bins[bucket].lastResponse=r.index
            if r.eventType=="final"{bins[bucket].finals+=1}
            if r.cacheStatus=="zero_in_log"{bins[bucket].zeros+=1}
            if let model=r.config.model{bins[bucket].models.insert(model)}
            if let before=previousSettings {
                let fields:[(String,String?,String?)]=[("model",before.model,r.config.model),("effort",before.effort,r.config.effort),("serviceTier",timelineSpeedMode(before.serviceTier),timelineSpeedMode(r.config.serviceTier))]
                for (field,from,to) in fields {
                    if let from,let to,!from.isEmpty,!to.isEmpty,from != to{bins[bucket].settingsChanges.append(.init(responseIndex:r.index,field:field,from:from,to:to))}
                }
            }
            previousSettings=r.config
            if let mode=timelineSpeedMode(r.config.serviceTier),["fast","ultrafast"].contains(mode),!bins[bucket].speedModes.contains(mode){bins[bucket].speedModes.append(mode)}
            let config=[r.config.model ?? "",r.config.serviceTier ?? "",r.config.effort ?? ""].joined(separator:"|")
            if let previousConfig,previousConfig != config{speed.reset();input.reset();cache.reset()};previousConfig=config
            if let n=r.inputTokens{bins[bucket].inputSum+=Double(n);bins[bucket].inputCount+=1}
            if let n=r.cachedInputTokens{bins[bucket].cacheSum+=Double(n);bins[bucket].cacheCount+=1;bins[bucket].cacheMinimum=min(bins[bucket].cacheMinimum ?? n,n)}
            if let n=r.outputTokens{bins[bucket].output+=n;bins[bucket].outputSamples+=1}
            if r.tokensPerSecond != nil,let n=r.outputTokens,let ms=r.durationMs,ms>0{bins[bucket].generatedTokens+=Double(n);bins[bucket].duration+=ms;bins[bucket].measured+=1}
            speed.add(r.tokensPerSecond,source:r.segment,bucket:bucket,period:self.period)
            input.add(r.inputTokens.map(Double.init),source:r.inputSegment,bucket:bucket,period:self.period)
            cache.add(r.cachedInputTokens.map(Double.init),source:r.cacheSegment,bucket:bucket,period:self.period)
        }
        let result=bins.enumerated().map{index,b in TimelineBucket(id:index,entryRange:b.start..<b.end,startPosition:entries[b.start].position,endPosition:entries[b.end-1].position,firstResponse:b.firstResponse,lastResponse:b.lastResponse,responses:b.responses,measured:b.measured,inputSamples:b.inputCount,cacheSamples:b.cacheCount,inputMean:b.inputCount>0 ? b.inputSum/Double(b.inputCount):nil,cacheMean:b.cacheCount>0 ? b.cacheSum/Double(b.cacheCount):nil,cacheMinimum:b.cacheMinimum,speed:b.duration>0 ? b.generatedTokens/(b.duration/1000):nil,outputTokens:b.output,outputSamples:b.outputSamples,finals:b.finals,users:b.users,compactions:b.compactions,zeroCaches:b.zeros,models:b.models.sorted(),settingsChanges:b.settingsChanges,speedModes:b.speedModes)}
        buckets=result;byID=lookup;entryBuckets=mapping
        self.speed=speed.points(result,raw:{$0.speed},period:self.period);self.input=input.points(result,raw:{$0.inputMean},period:self.period);self.cache=cache.points(result,raw:{$0.cacheMean},period:self.period)
    }
}
