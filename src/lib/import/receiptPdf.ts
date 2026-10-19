/** Local text extraction only. No URL input, rendering, OCR, attachments or PDF actions. */
export async function extractReceiptPdf(file: File, signal?: AbortSignal): Promise<string> {
  if (file.size>5_000_000 || !/\.pdf$/i.test(file.name)) throw new Error('בחרו PDF עד 5 MB.');
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  if (signal?.aborted) throw new Error('הקריאה בוטלה');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(signal?.aborted)throw new Error('הקריאה בוטלה');
  const task = pdfjs.getDocument({ data:bytes,
    useWasm:false, useWorkerFetch:false, disableFontFace:true, useSystemFonts:false, stopAtErrors:true, verbosity:0 });
  let timer:ReturnType<typeof setTimeout>;
  const stop=()=>{void task.destroy();};
  signal?.addEventListener('abort',stop,{once:true});
  const timeout = new Promise<never>((_,reject)=>{timer=setTimeout(()=>{stop();reject(new Error('הקריאה ארכה מדי. אפשר להדביק טקסט או להזין ידנית.'));},15000);});
  try {
    return await Promise.race([timeout,(async()=>{
      const pdf=await task.promise;
      if (pdf.numPages>10) throw new Error('אפשר לקרוא עד 10 עמודים. בחרו קבלה אחת.');
      let text='';
      for(let i=1;i<=pdf.numPages;i++) {
        if(signal?.aborted) throw new Error('הקריאה בוטלה');
        const page=await pdf.getPage(i), content=await page.getTextContent();
        text+=content.items.map(item=>'str' in item ? item.str+(item.hasEOL?'\n':' ') : '').join('')+'\n';
        page.cleanup();
        if(text.length>100000) throw new Error('המסמך מכיל יותר מדי טקסט. בחרו קבלה אחת.');
      }
      if (!text.trim()) throw new Error('אין בקובץ טקסט שניתן לחילוץ. אפשר להזין ידנית; תמונות אינן מפוענחות כאן.');
      return text;
    })()]);
  } catch(error) {
    if((error as Error).name==='PasswordException')throw new Error('ה־PDF מוגן בסיסמה. אפשר להדביק את הטקסט או להזין ידנית.');
    if((error as Error).name==='InvalidPDFException')throw new Error('לא ניתן לקרוא את ה־PDF. בחרו מסמך תקין או הדביקו טקסט.');
    throw error;
  } finally { clearTimeout(timer!); signal?.removeEventListener('abort',stop); await task.destroy(); }
}
