import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import sharp from 'sharp';
import { recognizeLine } from '../src/lib/scan/sevenSegment.ts';

const file=resolve(process.argv[2]??'.care-device/field-manifest.json');
const manifest=JSON.parse(await readFile(file,'utf8'));
if(manifest.version!==1 || !Array.isArray(manifest.samples))throw new Error('Expected field manifest version 1');
const sessions=new Map(),displays=new Map(),ids=new Set();
for(const row of manifest.samples){
  if(!row.id || ids.has(row.id) || !row.session || !row.display || !row.displayClass || !['tuning','evaluation'].includes(row.split) || row.source!=='real' || row.groundTruthVerified!==true || !['total','liters','odometer'].includes(row.kind) || !/^\d+(\.\d+)?$/.test(row.expected) || !row.crop)throw new Error('Each real sample needs unique id, verified ground truth, display/session/split and explicit crop');
  if(row.entryTimeMs!==undefined && (!Number.isFinite(row.entryTimeMs)||row.entryTimeMs<=0))throw new Error('Entry time must be measured, positive milliseconds');
  for(const [map,key] of [[sessions,row.session],[displays,row.display]]){if(map.has(key)&&map.get(key)!==row.split)throw new Error('Capture session/display cannot cross tuning and evaluation splits');map.set(key,row.split);}
  ids.add(row.id);
}
const results=[];
for(const row of manifest.samples){
  const image=await sharp(resolve(dirname(file),row.file),{limitInputPixels:60000000}).rotate().resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).extract(row.crop).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const started=performance.now();const read=recognizeLine({data:image.data,width:image.info.width,height:image.info.height},{kind:row.kind,mode:row.mode??'auto'});
  results.push({id:row.id,split:row.split,displayClass:row.displayClass,accepted:read.status==='candidate',acceptedError:read.status==='candidate' && Number(read.text)!==Number(row.expected),processingMs:performance.now()-started,entryTimeMs:row.entryTimeMs??null});
}
const summarize=rows=>({samples:rows.length,acceptedErrors:rows.filter(r=>r.acceptedError).length,rejectionRate:rows.length?rows.filter(r=>!r.accepted).length/rows.length:null,processingMs:rows.length?rows.reduce((s,r)=>s+r.processingMs,0)/rows.length:null,meanEntryTimeMs:rows.some(r=>r.entryTimeMs!==null)?rows.filter(r=>r.entryTimeMs!==null).reduce((s,r)=>s+r.entryTimeMs,0)/rows.filter(r=>r.entryTimeMs!==null).length:null,entryTimeSamples:rows.filter(r=>r.entryTimeMs!==null).length});
const evaluation=results.filter(r=>r.split==='evaluation');
const report={format:'tank-maleh-field-v1',at:new Date().toISOString(),status:results.length?'measured-real-samples':'pending-no-samples',tuning:summarize(results.filter(r=>r.split==='tuning')),evaluation:summarize(evaluation),displayCoverage:Object.fromEntries([...new Set(evaluation.map(r=>r.displayClass))].map(name=>[name,summarize(evaluation.filter(r=>r.displayClass===name))])),results};
await writeFile(resolve(process.argv[3]??'.care-device/field-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,evaluation:report.evaluation}));
