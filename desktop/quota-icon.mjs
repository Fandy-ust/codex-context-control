// Windows notification icons are square, so use the same hollowing bars as
// macOS with the percentage beneath them. No fonts or external assets needed.
const glyphs={0:['111','101','101','101','111'],1:['010','110','010','010','111'],2:['111','001','111','100','111'],3:['111','001','111','001','111'],4:['101','101','111','001','001'],5:['111','100','111','001','111'],6:['111','100','111','101','111'],7:['111','001','010','010','010'],8:['111','101','111','101','111'],9:['111','101','111','001','111'],'%':['101','001','010','100','101'],'—':['000','000','111','000','000']};
export function quotaIconBitmap(remaining,{dark=true,stale=false}={}){
  const width=32,bitmap=Buffer.alloc(width*width*4),shade=dark?238:35,opacity=remaining==null ? .75 : stale ? .65 : 1;
  const pixel=(x,y,alpha=1)=>{if(x<0||y<0||x>=width||y>=width)return;const at=(y*width+x)*4;bitmap[at]=bitmap[at+1]=bitmap[at+2]=shade;bitmap[at+3]=Math.round(255*alpha*opacity);};
  const fraction=remaining==null?0:Math.max(0,Math.min(1,remaining/100));
  for(const [index,height]of [9,15,20,15,9].entries()){
    const left=2+index*6,top=21-height;
    for(let y=top;y<21;y++)for(let x=left;x<left+4;x++){
      const border=x===left||x===left+3||y===top||y===20;
      if(fraction>0&&y>=21-height*fraction)pixel(x,y);else if(border)pixel(x,y,remaining==null?.9:.45);
    }
  }
  const label=remaining==null?'—':Math.round(remaining)+'%',start=Math.floor((width-(label.length*4-1))/2);
  for(const [index,char]of [...label].entries())for(const [y,row]of (glyphs[char]||glyphs['—']).entries())for(let x=0;x<row.length;x++)if(row[x]==='1')pixel(start+index*4+x,25+y);
  return {bitmap,width,height:width};
}
