/** Lab test results from ADEME/UTAC, hosted locally: no keys, Functions or CORS. */
export type DeclaredRow = [number, string, string, string, number, number, number, number];
interface Catalog { rows: DeclaredRow[]; source: string }
let loading: Promise<Catalog | null> | null = null;
const MAKES: Record<string, string> = {
  'יונדאי':'HYUNDAI', 'קיה':'KIA', 'קיא':'KIA', 'מזדה':'MAZDA', 'מאזדה':'MAZDA',
  'טויוטה':'TOYOTA', 'ניסאן':'NISSAN', 'ניסן':'NISSAN', 'סוזוקי':'SUZUKI', 'הונדה':'HONDA',
  'סובארו':'SUBARU', 'מיצובישי':'MITSUBISHI', 'סקודה':'SKODA', 'סיאט':'SEAT',
  'פולקסווגן':'VOLKSWAGEN', 'פולקסוגן':'VOLKSWAGEN', 'אאודי':'AUDI', 'אודי':'AUDI',
  'רנו':'RENAULT', 'פיגו':'PEUGEOT', "פיג'ו":'PEUGEOT', 'סיטרואן':'CITROEN',
  'פורד':'FORD', 'שברולט':'CHEVROLET', 'פיאט':'FIAT', 'דאציה':'DACIA', 'לקסוס':'LEXUS',
  'מרצדס':'MERCEDES-BENZ', 'במוו':'BMW', 'ב.מ.וו':'BMW', 'וולוו':'VOLVO',
};
const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function matchDeclared(rows: DeclaredRow[], params: { make: string; model: string; year: number; co2: number; automatic: number; powerKw: number; fuel: string }) {
  const make = clean(MAKES[params.make.split(' ')[0]] ?? params.make);
  const model = clean(params.model);
  const candidates = rows.filter(r => r[0] === params.year && clean(r[1]) === make && r[2] === model && r[3] === params.fuel && r[4] === params.automatic && r[5] === params.co2 && Math.abs(r[6] - params.powerKw) <= 1.5);
  const figures = [...new Set(candidates.map(r => r[7]))];
  // Matching emissions alone is insufficient; different power/transmission
  // variants must agree on one declared result before it can be used.
  return figures.length === 1 ? Math.round(1000 / figures[0]) / 10 : null;
}
export async function lookupDeclared(row: Record<string, unknown>, signal?: AbortSignal) {
  const year = Number(row.shnat_yitzur);
  if (year < 2012 || year > 2015 || !row.kinuy_mishari || !row.kamut_CO2 || !row.koah_sus || ![0, 1].includes(Number(row.automatic_ind))) return null;
  if (!loading) loading = fetch('/consumption-catalog.json', { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null).catch(() => null);
  const catalog = await loading;
  if (!catalog?.rows) { loading = null; return null; }
  if (signal?.aborted) return null;
  const kmPerLiter = matchDeclared(catalog.rows, {
    make: String(row.tozar || row.tozeret_nm), model: String(row.kinuy_mishari), year,
    co2: Number(row.kamut_CO2), powerKw: Number(row.koah_sus) * 0.73549875,
    automatic: Number(row.automatic_ind), fuel: /סולר/.test(String(row.delek_nm)) ? 'GO' : /בנזין/.test(String(row.delek_nm)) ? 'ES' : '',
  });
  return kmPerLiter ? { kmPerLiter, url: catalog.source } : null;
}
