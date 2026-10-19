import { recognizeLine, validateReading, type PixelImage } from './sevenSegment';

/** Classical image processing only: local contrast, connected components and
 * the electrical seven-segment alphabet. No trained weights, OCR or network.
 * Coordinates come from the pixels; there are no camera/display-specific crops.
 * The two photographed rows are suggestions for the existing review form.
 */
export type DisplayKind = 'pump' | 'odometer';
export type DisplayReading = { total: string; liters: string } | { odometer: string };
export type DisplayResult = { status: 'read'; values: DisplayReading } | { status: 'unreadable' };
type Component = { x: number; y: number; w: number; h: number; area: number; cx: number; cy: number };
type Geometry = { cx: number; top: number; width: number; height: number; shear: number };
type Digit = Geometry & { digit: string; score: number };
type Line = { text: string; left: number; right: number; top: number; height: number; digits: Digit[] };

// a,b,c,d,e,f,g. Some segmented LCDs omit the bottom stroke of a nine.
const DIGITS: Record<string,string> = { '1111110':'0','0110000':'1','1101101':'2','1111001':'3','0110011':'4','1011011':'5','1011111':'6','1110000':'7','1111111':'8','1111011':'9','1110011':'9' };
const SEGMENTS = [[.32,.02,.68,.11],[.81,.19,.96,.36],[.81,.64,.96,.81],[.32,.89,.68,.98],[.04,.64,.19,.81],[.04,.19,.19,.36],[.32,.46,.68,.54]];

function components(mask: Uint8Array, width: number, height: number): Component[] {
  const visited=new Uint8Array(mask.length), queue=new Int32Array(mask.length), result:Component[]=[];
  for(let i=0;i<mask.length;i++) {
    if(!mask[i] || visited[i])continue;
    let head=0,tail=1,left=width,right=0,top=height,bottom=0,sx=0,sy=0;
    queue[0]=i;visited[i]=1;
    while(head<tail) {
      const p=queue[head++],x=p%width,y=Math.floor(p/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);sx+=x;sy+=y;
      for(let direction=0;direction<4;direction++) {
        if((direction===0&&x===0)||(direction===1&&x===width-1))continue;
        const n=direction===0?p-1:direction===1?p+1:direction===2?p-width:p+width;
        if(n>=0&&n<mask.length&&!visited[n]&&mask[n]){visited[n]=1;queue[tail++]=n;}
      }
    }
    if(tail>=3)result.push({x:left,y:top,w:right-left+1,h:bottom-top+1,area:tail,cx:sx/tail,cy:sy/tail});
  }
  return result;
}
function feature(image:PixelImage, gray:Float32Array, integral:Float64Array, threshold:number, mode:'light'|'dark'|'blue') {
  const {width:w,height:h,data}=image, stride=w+1, mask=new Uint8Array(w*h);
  const radius=Math.max(8,Math.round(w*(mode==='blue'?.0125:.01875)));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const i=y*w+x,l=Math.max(0,x-radius),r=Math.min(w,x+radius+1),t=Math.max(0,y-radius),b=Math.min(h,y+radius+1);
    const mean=(integral[b*stride+r]-integral[t*stride+r]-integral[b*stride+l]+integral[t*stride+l])/((r-l)*(b-t));
    mask[i]=mode==='dark'?+(gray[i]<mean-threshold):+(gray[i]>mean+threshold && (mode!=='blue'||data[i*4+2]-data[i*4]>15));
  }
  return mask;
}
function readDigit(mask:Uint8Array,w:number,h:number,box:Geometry):Digit|null {
  const {cx,top,width,height,shear}=box;
  function occupancy([x0,y0,x1,y1]:number[]) {
    let sum=0;
    for(let yi=0;yi<5;yi++)for(let xi=0;xi<5;xi++) {
      const y=y0+(y1-y0)*yi/4,x=x0+(x1-x0)*xi/4;
      const yy=Math.round(top+y*height),xx=Math.round(cx+(x-.5)*width+shear*(y-.5));
      if(xx>=0&&yy>=0&&xx<w&&yy<h)sum+=mask[yy*w+xx];
    }
    return sum/25;
  }
  const levels=SEGMENTS.map(occupancy);
  // Reject uncertain segments rather than choosing a nearest digit.
  if(levels.some(n=>n>.25&&n<.65))return null;
  const digit=DIGITS[levels.map(n=>+(n>.5)).join('')];
  if(digit===undefined || [[-.24,.19,-.02,.36],[-.24,.64,-.02,.81],[1.02,.19,1.24,.36],[1.02,.64,1.24,.81]].some(rect=>occupancy(rect)>.3) || occupancy([.38,.22,.62,.32])>.2 || occupancy([.38,.68,.62,.78])>.2)return null;
  return {...box,digit,score:levels.reduce((s,n)=>s+Math.max(n,1-n),0)/7};
}
function distinctDigits(digits:Digit[], distance=.7):Digit[] {
  const result:Digit[]=[];
  const rank=(d:Digit)=>d.score+(['1','7'].includes(d.digit)?0:.12);
  for(const digit of digits.sort((a,b)=>rank(b)-rank(a))) {
    if(!result.some(b=>Math.abs(digit.cx-b.cx)<Math.min(digit.width,b.width)*distance && Math.abs(digit.top-b.top)<Math.min(digit.height,b.height)*.25))result.push(digit);
  }
  return result;
}
function findLines(mask:Uint8Array,w:number,h:number,blue:boolean,kind:DisplayKind):Line[] {
  // Horizontal opening isolates the bars even when glare joins neighbouring
  // digits. Pairing bars supplies scale, vertical perspective and italic slant.
  const radius=Math.max(2,Math.round(w*(blue?.003125:.0073))), horizontal=new Uint8Array(mask.length);
  for(let y=0;y<h;y++) {
    let sum=0;
    for(let x=0;x<w;x++) {
      sum+=mask[y*w+x];if(x>=radius*2+1)sum-=mask[y*w+x-radius*2-1];
      if(sum===radius*2+1)horizontal[y*w+x-radius]=1;
    }
  }
  const bars=components(horizontal,w,h).map(c=>({...c,w:c.w+radius*2,x:c.x-radius}))
    .filter(c=>c.w>12&&c.w<w*.18&&c.h>2&&c.w/c.h>2&&c.w/c.h<12&&c.area>12);
  // Text-heavy photos have many bars. A bounded workload keeps camera scanning
  // responsive; such an image is safer to reject than partially enumerate.
  if(bars.length>500)return [];
  const candidates:Digit[]=[];
  for(let i=0;i<bars.length;i++)for(let j=i+1;j<bars.length;j++) {
    let a=bars[i],b=bars[j];if(a.cy>b.cy)[a,b]=[b,a];
    const dy=b.cy-a.cy;
    if(dy<10||a.w/b.w<.65||a.w/b.w>1.5||Math.abs(a.cx-b.cx)>Math.max(a.w,b.w)*.28)continue;
    for(const [p,q] of [[.065,.5],[.5,.935],[.065,.935]]) {
      const height=dy/(q-p),width=(a.w+b.w)/2;
      if(height/width<1.3||height/width>3.6||height<22||height>h*.35)continue;
      const top=a.cy-p*height,shear=(b.cx-a.cx)/(q-p),cx=a.cx+(.5-p)*shear;
      for(const scale of [1,1.06,1.12,1.18,1.28,1.38,1.46])for(const dx of [-.025,0,.025])for(const dt of [-.015,0,.015]) {
        if(height/(width*scale)<(blue?1.2:1.8))continue;
        const digit=readDigit(mask,w,h,{cx:cx+dx*height,top:top+dt*height,width:width*scale,height,shear});
        if(digit&&digit.digit!=='1'&&digit.digit!=='7')candidates.push(digit);
      }
    }
  }
  const anchors=distinctDigits(candidates), groups:Digit[][]=[];
  for(const anchor of anchors) {
    if(groups.some(row=>row.includes(anchor)))continue;
    const row=anchors.filter(d=>d.height/anchor.height>.85&&d.height/anchor.height<1.16&&Math.abs(d.top+d.height*.5-anchor.top-anchor.height*.5)<anchor.height*.25&&Math.abs(d.cx-anchor.cx)<anchor.height*8);
    if(row.length>=2)groups.push(row);
  }
  const dots=components(mask,w,h).filter(c=>c.w<=h*.07&&c.h<=h*.07&&c.area/(c.w*c.h)>.45);
  const lines:Line[]=[];
  for(const row of groups) {
    const mean=(key:keyof Geometry)=>row.reduce((s,d)=>s+d[key],0)/row.length;
    const cx=mean('cx'),top=mean('top'),height=mean('height'),width=mean('width'),shear=mean('shear');
    const denominator=row.reduce((s,d)=>s+(d.cx-cx)**2,0);if(!denominator)continue;
    const slope=row.reduce((s,d)=>s+(d.cx-cx)*(d.top-top),0)/denominator;
    if(Math.abs(slope)>.3)continue;
    // A uniform, unobstructed line can use strict projection-based decoding.
    // Its crop is derived from the detected bars, never a fixed photo region.
    const bandHeight=Math.ceil(height*1.2), pixels=new Uint8ClampedArray(w*bandHeight*4);
    let left=w,right=-1;
    for(let by=0;by<bandHeight;by++)for(let x=0;x<w;x++) {
      const y=Math.round(top+(x-cx)*slope-height*.1+by),on=y>=0&&y<h&&mask[y*w+x],i=(by*w+x)*4;
      pixels[i]=pixels[i+1]=pixels[i+2]=on?0:255;pixels[i+3]=255;
      if(on){left=Math.min(left,x);right=Math.max(right,x);}
    }
    const projected=recognizeLine({width:w,height:bandHeight,data:pixels},{kind:kind==='pump'?'total':'odometer',mode:'dark'});
    if(projected.status==='candidate'){lines.push({text:projected.text,left,right,top,height,digits:row});continue;}
    const all=[...row];
    // Search this automatically detected line for digits with only one/no
    // horizontal bar (7 and 1). This also checks the spaces between anchors.
    for(let x=0;x<w;x++)for(const dy of [-.025,0,.025])for(const scale of [1,1.1]) {
      const digit=readDigit(mask,w,h,{cx:x,top:top+(x-cx)*slope+dy*height,width:width*scale,height,shear});
      if(digit)all.push(digit);
    }
    const ordered=distinctDigits(all,.85).sort((a,b)=>a.cx-b.cx),clusters:Digit[][]=[];
    for(const digit of ordered) {
      const last=clusters.at(-1);
      if(!last || digit.cx-last.at(-1)!.cx>width*2.05)clusters.push([digit]);else last.push(digit);
    }
    for(const digits of clusters) {
      if(digits.length<3||digits.length>7)continue;
      const gaps=digits.slice(1).map((d,i)=>d.cx-digits[i].cx);
      const pitch=[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
      if(gaps.some(g=>g<pitch*.7||g>pitch*1.35))continue;
      // A bar at the next character position means the line may be truncated.
      // Do not accept a shorter number just because that last digit is unclear.
      const hasUnresolvedEnd=[digits[0].cx-pitch,digits.at(-1)!.cx+pitch].some(x=>
        [.065,.5,.935].filter(y=>bars.some(b=>Math.abs(b.cx-x)<width*.4 && b.w/width>.6 && b.w/width<1.4 &&
          Math.abs(b.cy-(top+(b.cx-cx)*slope+y*height))<height*.08)).length>=2);
      if(hasUnresolvedEnd)continue;
      let text='';
      for(let i=0;i<digits.length;i++) {
        const d=digits[i];text+=d.digit;const next=digits[i+1];if(!next)continue;
        const points=dots.filter(c=>c.cx>d.cx+d.width*.48&&c.cx<next.cx-next.width*.48&&c.h>=height*.045&&c.h<=height*.18&&c.w>=height*.025&&c.w<=height*.18&&c.cy>top+(c.cx-cx)*slope+height*.84&&c.cy<top+(c.cx-cx)*slope+height*1.03);
        if(points.length===1)text+='.';else if(points.length>1){text='';break;}
      }
      if(text)lines.push({text,left:digits[0].cx-width/2,right:digits.at(-1)!.cx+width/2,top:digits[0].top,height,digits});
    }
  }
return lines;
}
function selectReading(lines:Line[],kind:DisplayKind):DisplayReading|null {
  if(kind==='odometer') {
    const candidates=lines.filter(row=>/^\d{4,7}$/.test(row.text));
    // A second equally plausible display is ambiguous; blue alone does not
    // establish that a value is the lifetime odometer. The final form says so.
    const texts=[...new Set(candidates.map(row=>row.text))];
    return texts.length===1?{odometer:texts[0]}:null;
  }
  const pairs:{values:DisplayReading;size:number}[]=[];
  for(const top of lines)for(const bottom of lines) {
    const dy=bottom.top-top.top,overlap=Math.min(top.right,bottom.right)-Math.max(top.left,bottom.left);
    if(dy<top.height*.75||dy>top.height*2.5||bottom.height/top.height<.6||bottom.height/top.height>1.4||overlap/Math.max(top.right-top.left,bottom.right-bottom.left)<.7)continue;
    if(!validateReading(top.text,'total')||!validateReading(bottom.text,'liters'))continue;
    pairs.push({values:{total:top.text,liters:bottom.text},size:top.height+bottom.height});
  }
  pairs.sort((a,b)=>b.size-a.size);
  if(!pairs.length || pairs.some(p=>p.size>pairs[0].size*.8 && JSON.stringify(p.values)!==JSON.stringify(pairs[0].values)))return null;
  return pairs[0].values;
}
export function recognizeDisplay(image:PixelImage,kind:DisplayKind):DisplayResult {
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<32||h<32||w*h>1_600_000||data.length!==w*h*4)return {status:'unreadable'};
  const gray=new Float32Array(w*h),integral=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++) {
    let sum=0;for(let x=0;x<w;x++) {
      const i=y*w+x;gray[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];sum+=gray[i];
      integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;
    }
  }
  const modes:('light'|'dark'|'blue')[]=kind==='pump'?['light','dark']:['blue','light'];
  for(const mode of modes) {
    const thresholds=mode==='blue'?[7,10]:[10,12,14,16];
    const readings=thresholds.map(threshold=>selectReading(findLines(feature(image,gray,integral,threshold,mode),w,h,mode==='blue',kind),kind)).filter((reading):reading is DisplayReading=>reading!==null);
    if(readings.length>=2 && readings.every(reading=>JSON.stringify(reading)===JSON.stringify(readings[0])))return {status:'read',values:readings[0]};
  }
  return {status:'unreadable'};
}
