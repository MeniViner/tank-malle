// Synthetic text/PDF fixtures; no provider export or private sample.
export const receipt='Issuer: PRIVATE-ISSUER\nSeries: A\nBranch: 002\nDocument: 0045\nDate: 2026-10-01\nTime: 14:30\nFuel total: 280\nLiters: 40\nShop: 20\nDiscount: 3\nService fee: 5\nTotal: 302';
export function textPdf(lines:string[]) {
  const stream='BT /F1 12 Tf 40 780 Td '+lines.map((line,i)=>(i?'0 -18 Td ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let data='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(data);data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(data);
}
