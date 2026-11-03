import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sheet } from "../Sheet";
import { Spinner } from "../Button";
import { NumericText, NumRun } from "../Fmt";
import { ChevronEnd, SearchIcon } from "../icons";

interface CatalogEntry { make: string; models: { model: string; from: number | null; to: number | null }[] }
let catalogCache: CatalogEntry[] | null = null;

export function CatalogPicker({ onClose, onPick }: {
  onClose: () => void; onPick: (make: string, model: string, year: number | null) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(catalogCache);
  const [loading, setLoading] = useState(() => !catalogCache);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [make, setMake] = useState<CatalogEntry | null>(null);
  const [model, setModel] = useState<CatalogEntry["models"][number] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [make, model]);
  useEffect(() => {
    if (catalog) return;
    let current = true;
    const controller = new AbortController();
    void fetch("/vehicle-catalog.json", { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Catalog unavailable"); return response.json(); })
      .then((payload: { makes?: CatalogEntry[] }) => {
        if (!Array.isArray(payload.makes) || !payload.makes.every(entry => typeof entry.make === "string" && Array.isArray(entry.models))) throw new Error("Invalid catalog");
        if (!current) return;
        catalogCache = payload.makes; setCatalog(payload.makes); setLoading(false);
      }).catch(() => { if (current) { setFailed(true); setLoading(false); } });
    return () => { current = false; controller.abort(); };
  }, [catalog, attempt]);

  const makes = useMemo(() => (catalog ?? []).filter(entry => !query.trim() || entry.make.includes(query.trim())), [catalog, query]);
  const models = useMemo(() => (make?.models ?? []).filter(entry => !query.trim() || entry.model.toLowerCase().includes(query.trim().toLowerCase())), [make, query]);
  const years = useMemo(() => {
    if (!model?.from || !model.to) return [];
    const result: number[] = [];
    for (let year = model.to; year >= model.from; year--) result.push(year);
    return result;
  }, [model]);
  const title = model ? "בחירת שנה" : make ? "בחירת דגם" : "בחירת יצרן";
  return <Sheet open onClose={onClose} title={<h2 ref={heading} tabIndex={-1} data-testid="wizard-catalog-title">{title}</h2>}>
    <div className="wizard-catalog">
      {make ? <button type="button" className="wizard-catalog-back" onClick={() => { if (model) setModel(null); else setMake(null); setQuery(""); }}><ChevronEnd size={20}/>חזרה</button> : null}
      {!model ? <label className="wizard-catalog-search">
        <SearchIcon size={20}/><span className="sr-only">{make ? "חיפוש דגם" : "חיפוש יצרן"}</span>
        <input data-testid="wizard-catalog-search" dir="auto" value={query} onChange={event => setQuery(event.currentTarget.value)}
          placeholder={make ? "חיפוש דגם…" : "חיפוש יצרן…"}/>
      </label> : null}
      {loading ? <div role="status" className="wizard-catalog-loading"><Spinner/><span>טוענים דגמים…</span></div>
        : failed ? <div className="wizard-catalog-empty"><p>רשימת הדגמים לא זמינה. אפשר להזין את הפרטים ידנית.</p>
          <button type="button" className="wizard-text-action" onClick={() => { setFailed(false); setLoading(true); setAttempt(value => value + 1); }}>ניסיון נוסף</button></div>
          : <div className="wizard-catalog-list">
            {!make ? makes.map(entry => <PickerRow key={entry.make} label={entry.make}
              meta={entry.models.length === 1 ? 'דגם אחד' : <><NumRun>{entry.models.length}</NumRun> דגמים</>}
              onClick={() => { setMake(entry); setQuery(""); }}/>)
              : !model ? models.map(entry => <PickerRow key={entry.model} label={entry.model}
                meta={entry.from ? <NumRun>{entry.from}{entry.to && entry.to !== entry.from ? "–" + entry.to : ""}</NumRun> : undefined}
                onClick={() => { if (entry.from && entry.to && entry.from !== entry.to) setModel(entry); else onPick(make.make, entry.model, entry.from); }}/>)
                : years.map(year => <PickerRow key={year} label={String(year)} onClick={() => onPick(make.make, model.model, year)}/>)}
            {!make && !makes.length || make && !model && !models.length ? <p className="wizard-catalog-empty">לא נמצאו תוצאות</p> : null}
          </div>}
    </div>
  </Sheet>;
}
function PickerRow({ label, meta, onClick }: { label: string; meta?: ReactNode; onClick: () => void }) {
  return <button type="button" className="wizard-catalog-row" data-testid="wizard-catalog-option" onClick={onClick}>
    <span><NumericText>{label}</NumericText></span>{meta ? <small>{meta}</small> : null}
  </button>;
}
