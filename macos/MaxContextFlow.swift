import SwiftUI

/// Self-contained Canvas updates keep the rest of the panel out of the animation loop.
struct MaxContextFlow:View {
    var vivid=false
    var paused=false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible=false
    var body:some View {
        TimelineView(.animation(minimumInterval:1.0/24,paused:paused || reduceMotion || !visible)){timeline in
            let time=reduceMotion ? 0:timeline.date.timeIntervalSinceReferenceDate
            Canvas {context,size in
                let rect=CGRect(origin:.zero,size:size)
                let drift=CGFloat(sin(time/7))*size.width*0.25
                let colors=vivid ? [Color(red:0.25,green:0.20,blue:0.75),Color(red:0.59,green:0.32,blue:0.90),Color(red:0.35,green:0.18,blue:0.68)] : [Color(red:0.065,green:0.055,blue:0.11),Color(red:0.13,green:0.075,blue:0.20),Color(red:0.075,green:0.055,blue:0.13)]
                context.fill(Path(rect),with:.linearGradient(Gradient(colors:colors),startPoint:CGPoint(x:drift-size.width*0.2,y:0),endPoint:CGPoint(x:size.width+drift,y:size.height)))
                for index in 0..<3 {
                    let phase=time/9+Double(index)*2.1
                    let center=CGPoint(x:size.width*(0.5+CGFloat(sin(phase))*0.43),y:size.height*(0.5+CGFloat(cos(phase*0.7))*0.4))
                    context.fill(Path(rect),with:.radialGradient(Gradient(colors:[Color(red:0.65,green:0.35,blue:1).opacity(vivid ? 0.30:0.12),.clear]),center:center,startRadius:0,endRadius:max(size.width,size.height)*0.65))
                }
                if !reduceMotion {
                    for index in 0..<(vivid ? 16:24) {
                        let seed=Double(index)*0.61803398875
                        let x=(time/22+seed).truncatingRemainder(dividingBy:1)
                        let y=0.12+(seed*2.7).truncatingRemainder(dividingBy:1)*0.76
                        let radius:CGFloat=vivid ? 1.4:1.1
                        context.fill(Path(ellipseIn:CGRect(x:CGFloat(x)*size.width,y:CGFloat(y)*size.height,width:radius*2,height:radius*2)),with:.color(.white.opacity((vivid ? 0.35:0.10)*sin(x*Double.pi))))
                    }
                }
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
            .onAppear{visible=true}.onDisappear{visible=false}
    }
}
