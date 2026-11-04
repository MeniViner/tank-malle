import { recognizeLine, type PixelImage } from './sevenSegment';
import { resolveOdometer, resolvePump, type IdentityReason, type LabelToken, type NumericLine } from './identity';

/** Classical image processing only: local contrast, connected components and
 * the electrical seven-segment alphabet. No trained weights, OCR or network.
 * Coordinates come from the pixels; there are no camera/display-specific crops.
 * The two photographed rows are suggestions for the existing review form.
 */
export type DisplayKind = 'pump' | 'odometer';
export type DisplayReading = { total: string; liters: string } | { odometer: string };
export type RejectReason = IdentityReason | 'invalid-image' | 'unstable' | 'conflict';
export type DisplayResult = { status: 'read'; values: DisplayReading; evidence: string[] } | { status: 'unreadable'; reason?: RejectReason };
/** Light: emissive digits (luminance). Value: emissive digits of any colour
 * (brightest channel — red/amber/green LEDs have little luminance). Blue: the
 * blue-tinted LCD backlight. Dark: reflective LCD, dark segments on light. */
export type Polarity = 'light' | 'value' | 'blue' | 'dark';
/** One line, merged over the thresholds of one polarity that found it. */
export type StableLine = NumericLine & { polarity: Polarity; support: number };
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
function feature(image:PixelImage, gray:Float32Array, integral:Float64Array, threshold:number, mode:Polarity) {
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
function findLines(mask:Uint8Array,channel:Float32Array,w:number,h:number,blue:boolean,dark:boolean,kind:DisplayKind):Line[] {
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
  // Ones and sevens have fewer than two horizontal bars, so a row made only of
  // them has no bar anchors. Their two stacked vertical strokes (b over c)
  // supply the height and slant instead. Such a digit must still pass the full
  // segment check, including empty space on both sides.
  const vertical=new Uint8Array(mask.length);
  for(let x=0;x<w;x++) {
    let sum=0;
    for(let y=0;y<h;y++) {
      sum+=mask[y*w+x];if(y>=radius*2+1)sum-=mask[(y-radius*2-1)*w+x];
      if(sum===radius*2+1)vertical[(y-radius)*w+x]=1;
    }
  }
  const posts=components(vertical,w,h).map(c=>({...c,h:c.h+radius*2,y:c.y-radius}))
    .filter(c=>c.h>10&&c.h<h*.2&&c.w>1&&c.h/c.w>2&&c.h/c.w<14&&c.area>10);
  if(posts.length<=500)for(let i=0;i<posts.length;i++)for(let j=0;j<posts.length;j++) {
    const a=posts[i],b=posts[j],gap=b.y-(a.y+a.h),span=b.y+b.h-a.y;
    if(i===j||gap<-span*.04||gap>span*.16||a.h/b.h<.7||a.h/b.h>1.4||Math.abs(a.cx-b.cx)>span*.2)continue;
    const height=span/.84,top=a.y-height*.08,shear=(a.cx-b.cx)/(.28-.72),postX=(a.cx+b.cx)/2;
    if(height<22||height>h*.35)continue;
    for(const ratio of blue?[1.4,1.8,2.2]:[1.9,2.2,2.6])for(const dt of [-.015,0,.015]) {
      const width=height/ratio;
      // The strokes are the right column of a one/seven cell.
      const digit=readDigit(mask,w,h,{cx:postX-.385*width,top:top+dt*height,width,height,shear});
      if(digit&&(digit.digit==='1'||digit.digit==='7'))candidates.push({...digit,score:digit.score-.04});
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
      if(digits.length<(kind==='pump'?3:2)||digits.length>7)continue;
      const gaps=digits.slice(1).map((d,i)=>d.cx-digits[i].cx);
      const pitch=[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
      if(gaps.some(g=>g<pitch*.7||g>pitch*1.35))continue;
      // A bar at the next character position means the line may be truncated.
      // Do not accept a shorter number just because that last digit is unclear.
      // So does a digit-height vertical stroke there (a 4, or a 1 or 7 that was
      // not decoded), which has fewer than two bars.
      const hasUnresolvedEnd=[digits[0].cx-pitch,digits.at(-1)!.cx+pitch].some(x=>
        [.065,.5,.935].filter(y=>bars.some(b=>Math.abs(b.cx-x)<width*.4 && b.w/width>.6 && b.w/width<1.4 &&
          Math.abs(b.cy-(top+(b.cx-cx)*slope+y*height))<height*.08)).length>=2 ||
        posts.some(p=>Math.abs(p.cx-x)<width*.6 && p.h>=height*.3 && p.y>=top+(p.cx-cx)*slope-height*.1 && p.y+p.h<=top+(p.cx-cx)*slope+height*1.1));
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
  // Segments cover well under half of their own row, and are clearly brighter
  // (or darker) than the row's background. A "row" failing either is the
  // background read in the opposite polarity: the gaps between bright segments.
  return lines.filter(line=>{
    let on=0,ink=0;const background:number[]=[];
    for(let y=Math.max(0,Math.round(line.top));y<Math.min(h,Math.round(line.top+line.height));y++)for(let x=Math.max(0,Math.round(line.left));x<Math.min(w,Math.round(line.right));x++){
      const i=y*w+x;if(mask[i]){on++;ink+=channel[i];}else background.push(channel[i]);
    }
    if(!on||on/(on+background.length)>=.5)return false;
    background.sort((a,b)=>a-b);const median=background[background.length>>1]??0;
    return dark?median-ink/on>20:ink/on-median>20;
  });
}
const overlapX=(a:NumericLine,b:NumericLine)=>Math.min(a.right,b.right)-Math.max(a.left,b.left);
function sameLine(a:NumericLine,b:NumericLine) {
  return Math.abs(a.top+a.height/2-b.top-b.height/2)<Math.min(a.height,b.height)*.35 && a.height/b.height>.75 && a.height/b.height<1.33 && overlapX(a,b)>Math.min(a.right-a.left,b.right-b.left)*.5;
}
/** Thresholds of one polarity vote per line. A line is stable when at least
 * two thresholds read it and none reads it differently. */
function mergeThresholds(perThreshold:Line[][],polarity:Polarity) {
  const merged:{line:Line;texts:Map<string,number>}[]=[];
  for(const lines of perThreshold)for(const line of lines) {
    let entry=merged.find(m=>sameLine(m.line,line));
    if(!entry){entry={line,texts:new Map()};merged.push(entry);}
    entry.texts.set(line.text,(entry.texts.get(line.text)??0)+1);
  }
  const stable:StableLine[]=[],conflicts:NumericLine[]=[];
  for(const {line,texts} of merged) {
    const box={left:line.left,right:line.right,top:line.top,height:line.height};
    if(texts.size>1)conflicts.push({...box,text:[...texts.keys()].join('|')});
    else {const [[text,support]]=[...texts];if(support>=2)stable.push({...box,text,polarity,support});}
  }
  return {polarity,stable,conflicts};
}
export type PolarityLines = ReturnType<typeof mergeThresholds>;
/** Stacked rows of one display panel. Another panel elsewhere in the frame is
 * a second display, not more evidence. */
function panels(lines:NumericLine[]) {
  const parent=lines.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
  lines.forEach((a,i)=>lines.forEach((b,j)=>{
    if(j<=i)return;const size=Math.max(a.height,b.height),ratio=a.height/b.height;
    const gap=Math.max(a.top,b.top)-Math.min(a.top+a.height,b.top+b.height),dx=-overlapX(a,b);
    if(ratio>.4&&ratio<2.5&&gap<size*2.5&&dx<size)parent[find(i)]=find(j);
  }));
  const groups=new Map<number,NumericLine[]>();
  lines.forEach((line,i)=>groups.set(find(i),[...(groups.get(find(i))??[]),line]));
  return [...groups.values()];
}
const SEVERITY:RejectReason[]=['no-reading','unstable','format','unit-miles','trip-meter','identity-ambiguous','foreign-currency','conflict'];
/** The light and value channels see the same bright digits on a dark
 * panel; a camera's colour subsampling (4:2:0 video) can leave each with only
 * some of a pump's rows (gray: the volume, value: the amount). Their rows
 * together are one more candidate, when they agree wherever they overlap. */
function bothChannels(polarities:PolarityLines[]):PolarityLines[] {
  const light=polarities.find(p=>p.polarity==='light'),value=polarities.find(p=>p.polarity==='value');
  if(!light?.stable.length||!value?.stable.length)return [];
  const same=(a:NumericLine,b:NumericLine)=>Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top)>.5*Math.min(a.height,b.height)&&overlapX(a,b)>0;
  if(value.stable.some(v=>light.stable.some(l=>same(l,v)&&l.text!==v.text)))return [];
  const extra=value.stable.filter(v=>!light.stable.some(l=>same(l,v)));
  return extra.length?[{polarity:'light',stable:[...light.stable,...extra],conflicts:[...light.conflicts,...value.conflicts]}]:[];
}
/** Decide from the lines of every polarity plus any recognised labels. A
 * different reading in a second polarity is a conflict, not a fallback. */
export function decideDisplay(polarities:PolarityLines[],kind:DisplayKind,labels:LabelToken[]=[]):DisplayResult {
  const outcomes:{values:DisplayReading;evidence:string[]}[]=[];let reason:RejectReason='no-reading';
  const worse=(next:RejectReason)=>{if(SEVERITY.indexOf(next)>SEVERITY.indexOf(reason))reason=next;};
  for(const {polarity,stable,conflicts} of kind==='pump'?[...polarities,...bothChannels(polarities)]:polarities) {
    if(kind==='pump') {
      const groups=panels(stable.filter(line=>line.text.includes('.'))).filter(group=>group.length>=2);
      if(!groups.length){if(stable.length)worse('format');continue;}
      if(groups.length>1){worse('identity-ambiguous');continue;}
      const [group]=groups;
      if(conflicts.some(c=>panels([...group,c]).length===1)){worse('conflict');continue;}
      // A decimal row left out of the panel but in its column (a row cut by
      // the crop, a misread amount) is unexplained: the panel may be missing
      // the amount, and a 2-place volume beside a 3-place price would then
      // look like an amount and a volume.
      const size=Math.max(...group.map(l=>l.height)),left=Math.min(...group.map(l=>l.left)),right=Math.max(...group.map(l=>l.right)),top=Math.min(...group.map(l=>l.top)),bottom=Math.max(...group.map(l=>l.top+l.height));
      if(stable.some(l=>l.text.includes('.')&&!group.includes(l)&&Math.min(l.right,right)-Math.max(l.left,left)>.3*(l.right-l.left)&&l.top<bottom+size*3&&l.top+l.height>top-size*3)){worse('identity-ambiguous');continue;}
      const identity=resolvePump(group,labels);
      if(identity.status==='resolved')outcomes.push({values:{total:identity.values.total,liters:identity.values.liters},evidence:[...identity.evidence,...(identity.values.unitPrice?[`observed-unit-price:${identity.values.unitPrice}`]:[]),`polarity:${polarity}`]});
      else worse(identity.reason);
    } else {
      if(conflicts.some(c=>/^\d+(\|\d+)+$/.test(c.text))){worse('conflict');continue;}
      if(!stable.length)continue;
      const identity=resolveOdometer(stable,labels);
      if(identity.status==='resolved')outcomes.push({values:identity.values,evidence:[...identity.evidence,`unit:${identity.unit}`,`polarity:${polarity}`]});
      else worse(identity.reason);
    }
  }
  if(new Set(outcomes.map(o=>JSON.stringify(o.values))).size>1)return {status:'unreadable',reason:'conflict'};
  if(outcomes.length)return {status:'read',values:outcomes[0].values,evidence:[...new Set(outcomes.flatMap(o=>o.evidence))]};
  return {status:'unreadable',reason};
}
const POLARITIES:Record<DisplayKind,Polarity[]>={pump:['light','value','dark'],odometer:['blue','light','value','dark']};
/** Lines of every supported polarity, before any field is assigned. */
export function analyzeDisplay(image:PixelImage,kind:DisplayKind,polarities=POLARITIES[kind]):PolarityLines[]|null {
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<32||h<32||w*h>1_600_000||data.length!==w*h*4)return null;
  const channels={gray:new Float32Array(w*h),value:new Float32Array(w*h)};
  const integrals={gray:new Float64Array((w+1)*(h+1)),value:new Float64Array((w+1)*(h+1))};
  for(let y=0;y<h;y++) {
    let sum=0,sumValue=0;for(let x=0;x<w;x++) {
      const i=y*w+x,r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      channels.gray[i]=.299*r+.587*g+.114*b;channels.value[i]=Math.max(r,g,b);sum+=channels.gray[i];sumValue+=channels.value[i];
      integrals.gray[(y+1)*(w+1)+x+1]=integrals.gray[y*(w+1)+x+1]+sum;
      integrals.value[(y+1)*(w+1)+x+1]=integrals.value[y*(w+1)+x+1]+sumValue;
    }
  }
  return polarities.map(polarity=>{
    const channel=polarity==='value'?'value':'gray',thresholds=polarity==='blue'?[7,10]:[10,12,14,16];
    return mergeThresholds(thresholds.map(threshold=>findLines(feature(image,channels[channel],integrals[channel],threshold,polarity),channels[channel],w,h,polarity==='blue',polarity==='dark',kind)),polarity);
  });
}
export function recognizeDisplay(image:PixelImage,kind:DisplayKind,labels:LabelToken[]=[]):DisplayResult {
  const polarities=analyzeDisplay(image,kind);
  return polarities?decideDisplay(polarities,kind,labels):{status:'unreadable',reason:'invalid-image'};
}
