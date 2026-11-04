import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData, type VehicleCreationSubmission, type VehicleSelectionResult } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useAccountScope } from "../components/account/useAccountScope";
import { useAppUpdateBlocker } from "../hooks/useAppUpdateBlocker";
import { LOOKUP_MESSAGES, lookupPlate } from "../lib/plateLookup";
import { fetchVehicleSpecs, type VehicleSpecs } from "../lib/vehicleSpecs";
import { NumericText, NumRun } from "../components/Fmt";
import { ChevronEnd } from "../components/icons";
import { PlateStep } from "../components/vehicle-wizard/PlateStep";
import { ConfirmStep } from "../components/vehicle-wizard/ConfirmStep";
import { ExtrasStep } from "../components/vehicle-wizard/ExtrasStep";
import { WizardCreationStatus, WizardRecovery, type VehicleReceiptState } from "../components/vehicle-wizard/WizardRecovery";
import {
  EMPTY_WIZARD_DRAFT, buildWizardVehicle, clearWizardSuggestions, emptyWizardNumbers,
  suggestWizardNumbers, typeWizardNumber, validateWizardDetails, wizardIdentity,
  type WizardDraft, type WizardErrors, type WizardStep,
} from "../components/vehicle-wizard/wizardState";
import "../vehicle-wizard-design.css";

interface WizardRequest { controller: AbortController; generation: number }
interface SpecsRequest extends WizardRequest { key: string; status: "pending" | "complete" | "failed" }

/** One controller owns the draft, async generation and the actual creation attempt. */
export function VehicleWizard({ firstRun = false }: { firstRun?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { addVehicle, activeVehicle, vehicles, outbox, outboxReady, outboxHealth } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(uid);
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState<WizardStep>("plate");
  const [plate, setPlate] = useState("");
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_WIZARD_DRAFT);
  const [editing, setEditing] = useState(false);
  const [numbers, setNumbers] = useState(emptyWizardNumbers);
  const [nickname, setNickname] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [canRetryLookup, setCanRetryLookup] = useState(false);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [specs, setSpecs] = useState<VehicleSpecs | null>(null);
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [errors, setErrors] = useState<WizardErrors>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [differentVehicle, setDifferentVehicle] = useState(false);
  const [creation, setCreation] = useState<VehicleCreationSubmission | null>(null);
  const [creationPhase, setCreationPhase] = useState<VehicleReceiptState>("pending");
  const [selection, setSelection] = useState<VehicleSelectionResult | null>(null);
  const [selectionPhase, setSelectionPhase] = useState<VehicleReceiptState>("pending");
  const generation = useRef(0);
  const lookupRequest = useRef<WizardRequest | null>(null);
  const specsRequest = useRef<SpecsRequest | null>(null);
  const saveLock = useRef(false);
  const creationRef = useRef<VehicleCreationSubmission | null>(null);
  const selectionLock = useRef(false);
  const selectionGeneration = useRef(0);

  useEffect(() => () => {
    generation.current++;
    lookupRequest.current?.controller.abort();
    specsRequest.current?.controller.abort();
  }, []);
  useEffect(() => {
    if (!validationAttempt) return;
    (root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? root.current?.querySelector<HTMLElement>('[data-testid="wizard-correct"]'))?.focus();
  }, [validationAttempt]);

  const dirty = !creation && (step !== "plate" || !!plate || !!nickname || numbers.tank.authored || numbers.declared.authored);
  useAppUpdateBlocker(dirty || saving);
  const canExit = !firstRun || vehicles.length > 0;
  const retained = outbox.filter(operation => operation.uid === uid && operation.kind === "vehicle.add");
  const inventoryReady = outboxReady && outboxHealth.state === "ok";
  const recoveryState = !outboxReady ? "loading" : outboxHealth.state !== "ok" ? "unknown" : "retained";
  const needsRecovery = !creation && !differentVehicle && (!inventoryReady || retained.length > 0);
  const stepIndex = step === "plate" ? 1 : step === "confirm" ? 2 : 3;

  function cancelRequests(clearSuggestions = false) {
    generation.current++;
    lookupRequest.current?.controller.abort();
    specsRequest.current?.controller.abort();
    lookupRequest.current = null;
    specsRequest.current = null;
    setLooking(false);
    setLoadingSpecs(false);
    if (clearSuggestions) { setSpecs(null); setNumbers(clearWizardSuggestions); }
    return generation.current;
  }

  function startSpecs(candidate: WizardDraft, requestGeneration: number, accountCurrent: () => boolean) {
    const key = wizardIdentity(candidate);
    const previous = specsRequest.current;
    if (previous?.key === key && previous.generation === requestGeneration
      && !previous.controller.signal.aborted && previous.status !== "failed") return;
    previous?.controller.abort();
    const request: SpecsRequest = { key, generation: requestGeneration, controller: new AbortController(), status: "pending" };
    specsRequest.current = request;
    const current = () => accountCurrent() && generation.current === requestGeneration
      && specsRequest.current === request && !request.controller.signal.aborted;
    setLoadingSpecs(true);
    void fetchVehicleSpecs({ make: candidate.make, model: candidate.model, year: candidate.year ? Number(candidate.year) : null,
      fuelType: candidate.fuelType, engineCc: candidate.engineCc, tozeretCd: candidate.tozeretCd, degemCd: candidate.degemCd,
    }, request.controller.signal).then(found => {
      if (!current()) return;
      request.status = "complete";
      setSpecs(found);
      setNumbers(value => suggestWizardNumbers(value, found));
    }).catch(() => {
      if (!current()) return;
      request.status = "failed";
    }).finally(() => { if (current()) setLoadingSpecs(false); });
  }

  function changePlate(next: string) {
    if (next === plate) return;
    cancelRequests(true);
    setPlate(next);
    setLookupError(null);
    setCanRetryLookup(false);
  }

  async function runLookup() {
    if (!uid || plate.length < 5 || plate.length > 8 || saveLock.current || creationRef.current) return;
    const accountCurrent = captureScope();
    const nextGeneration = cancelRequests(true);
    const request: WizardRequest = { controller: new AbortController(), generation: nextGeneration };
    lookupRequest.current = request;
    const current = () => accountCurrent() && generation.current === nextGeneration
      && lookupRequest.current === request && !request.controller.signal.aborted;
    setLookupError(null);
    setCanRetryLookup(false);
    setLooking(true);
    try {
      const outcome = await lookupPlate(plate, { uid, signal: request.controller.signal });
      if (!current()) return;
      if (outcome.status === "not-found") {
        setLookupError(LOOKUP_MESSAGES.notFound);
        setLookupNotice(null);
        return;
      }
      if (outcome.status === "unavailable") {
        const message = outcome.cached ? LOOKUP_MESSAGES.cachedFallback : LOOKUP_MESSAGES.unavailable;
        setLookupError(message);
        setCanRetryLookup(true);
        setLookupNotice(outcome.cached ? message : null);
        if (!outcome.cached) return;
      } else setLookupNotice(null);
      const result = outcome.status === "found" ? outcome.vehicle : outcome.cached;
      if (!result) return;
      const next: WizardDraft = {
        make: result.make ?? "", model: result.model ?? "", year: result.year ? String(result.year) : "",
        fuelType: result.fuelType ?? "95", plateNumber: result.plateNumber,
        category: result.category, fromRegistry: true, tozeretCd: result.tozeretCd ?? null,
        degemCd: result.degemCd ?? null, engineCc: result.engineVolume ?? null,
      };
      setDraft(next); setEditing(false); setErrors({}); setStep("confirm");
      startSpecs(next, nextGeneration, accountCurrent);
    } catch (error) {
      if (!current() || (error as Error).name === "AbortError") return;
      setLookupError(LOOKUP_MESSAGES.unavailable); setCanRetryLookup(true);
    } finally { if (current()) setLooking(false); }
  }

  function goManual() {
    cancelRequests(true);
    setLookupNotice(null); setLookupError(null); setErrors({});
    setDraft({ ...EMPTY_WIZARD_DRAFT, plateNumber: plate }); setEditing(true); setStep("confirm");
  }

  function changeIdentity(patch: Partial<WizardDraft>) {
    const next = { ...draft, ...patch };
    if (wizardIdentity(next) !== wizardIdentity(draft) || patch.fromRegistry === false && draft.fromRegistry) {
      cancelRequests(true);
      setLookupNotice(null);
      setDraft({ ...next, fromRegistry: false, tozeretCd: null, degemCd: null, engineCc: null, category: undefined });
    } else setDraft(next);
    setErrors({}); setEditing(true);
  }

  function nextStep() {
    const nextErrors = validateWizardDetails(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setValidationAttempt(value => value + 1); return; }
    setStep("extras");
    startSpecs(draft, generation.current, captureScope());
  }

  function openRetained(submitted: VehicleCreationSubmission) {
    if (submitted.isCurrent()) navigate("/settings/unsynced");
  }

  function trackSelection(submitted: VehicleCreationSubmission, result: VehicleSelectionResult, localCurrent: () => boolean) {
    if (!submitted.isCurrent()) return;
    const version = ++selectionGeneration.current;
    if (localCurrent()) { setSelection(result); setSelectionPhase("pending"); }
    const retryToast = () => {
      if (!submitted.isCurrent() || version !== selectionGeneration.current) return;
      showToast({ tone: "error", title: "בחירת הרכב עוד לא הושלמה",
        undoLabel: "ניסיון נוסף", onUndo: () => retrySelection(submitted, localCurrent) });
    };
    if (result.state === "blocked") {
      // Creation failure already exposes its actual retained operation. A
      // selection retry cannot substitute for recovering that creation.
      if (result.reason === "creation-unconfirmed") return;
      if (result.reason === "vehicle-selection-unverified" || result.reason === "vehicle-selection-ended") {
        showToast({ tone: "error", title: "בחירת הרכב עוד לא הושלמה", detail: result.message,
          undoLabel: "בחירת רכב", onUndo: () => { if (submitted.isCurrent()) navigate("/settings/vehicles"); } });
      } else retryToast();
    }
    if (result.state === "submitted") void result.receipt.settled.then(ok => {
      if (!submitted.isCurrent() || version !== selectionGeneration.current) return;
      if (localCurrent()) setSelectionPhase(ok ? "accepted" : "failed");
      if (!ok) retryToast();
    });
  }

  async function retrySelection(submitted: VehicleCreationSubmission, localCurrent: () => boolean) {
    if (!submitted.isCurrent() || selectionLock.current) return;
    selectionLock.current = true;
    if (localCurrent()) setSaving(true);
    try { trackSelection(submitted, await submitted.retrySelection(), localCurrent); }
    catch {
      if (submitted.isCurrent()) showToast({ tone: "error", title: "הבחירה לא הושלמה",
        undoLabel: "בדיקה", onUndo: () => openRetained(submitted) });
    } finally {
      selectionLock.current = false;
      if (localCurrent()) setSaving(false);
    }
  }

  async function save() {
    if (saveLock.current || creationRef.current) return;
    const result = buildWizardVehicle(draft, numbers, nickname, specs);
    if (!result.ok) {
      setErrors(result.errors);
      setValidationAttempt(value => value + 1);
      if (result.errors.make || result.errors.model || result.errors.year) setStep("confirm");
      return;
    }
    const localCurrent = captureScope();
    cancelRequests();
    saveLock.current = true;
    setSaving(true); setSaveError(null);
    const submittedAttempt = (): VehicleCreationSubmission | null => creationRef.current;
    try {
      await addVehicle(result.vehicle, { onSubmitted: submitted => {
        // Capture the actual operation before the first vehicle can unmount this wizard.
        creationRef.current = submitted;
        if (!submitted.isCurrent()) return;
        if (localCurrent()) { setCreation(submitted); setCreationPhase("pending"); }
        void submitted.creation.receipt.settled.then(ok => {
          if (!submitted.isCurrent()) return;
          if (localCurrent()) setCreationPhase(ok ? "accepted" : "failed");
          if (!ok) showToast({ tone: "error", title: "פרטי הרכב נשמרו במכשיר", detail: "השליחה לענן לא הושלמה.",
            undoLabel: "בדיקה", onUndo: () => openRetained(submitted) });
        });
        void submitted.selection.then(selectionResult => trackSelection(submitted, selectionResult, localCurrent));
      } });
      const submitted = submittedAttempt();
      if (!submitted?.isCurrent()) return;
      showToast({ tone: "info", title: "הרכב נשמר במכשיר" });
      if (localCurrent()) navigate("/", { replace: true });
    } catch (error) {
      const submitted = submittedAttempt();
      if (submitted) {
        // A failure after enqueue belongs to this operation; it is never a new create.
        if (localCurrent()) setSaveError("פרטי הרכב שמורים במכשיר. בדקו את מצב השליחה לענן.");
        if (submitted.isCurrent()) showToast({ tone: "info", title: "פרטי הרכב שמורים במכשיר",
          undoLabel: "בדיקה", onUndo: () => openRetained(submitted) });
      } else if (localCurrent()) {
        setSaveError(error instanceof Error ? error.message : "השמירה לא הושלמה. הפרטים נשארו כאן.");
      }
    } finally {
      saveLock.current = false;
      if (localCurrent()) setSaving(false);
    }
  }

  function back() {
    if (saveLock.current || selectionLock.current) return;
    if (creation) { navigate("/", { replace: true }); return; }
    if (step === "extras") setStep("confirm");
    else if (step === "confirm") { cancelRequests(); setStep("plate"); }
    else if (canExit) navigate(-1);
  }

  return <main ref={root} className="vehicle-wizard" data-testid="vehicle-wizard"
    data-step={needsRecovery ? "recovery" : creation ? "submitted" : step}>
    <header className="wizard-header">
      <div className="wizard-top">
        <button type="button" className="wizard-back" data-testid="wizard-back" aria-label="חזרה" disabled={saving || step === "plate" && !canExit && !creation} onClick={back}>
          <ChevronEnd size={22}/>
        </button>
        {!needsRecovery && !creation ? <span className="wizard-step-count">שלב <NumRun>{stepIndex}</NumRun> מתוך <NumRun>3</NumRun></span> : <span/>}
        <span className="wizard-top-spacer" aria-hidden="true"/>
      </div>
      {!needsRecovery && !creation ? <div className="wizard-progress" role="progressbar" aria-label="הוספת רכב" aria-valuemin={1} aria-valuemax={3} aria-valuenow={stepIndex}>
        {[1, 2, 3].map(number => <span key={number} data-active={number <= stepIndex}/>)}
      </div> : null}
    </header>
    {needsRecovery ? <WizardRecovery state={recoveryState} operations={retained} onDifferentVehicle={() => setDifferentVehicle(true)}/>
      : creation ? <WizardCreationStatus submission={creation} phase={creationPhase} selection={selection} selectionPhase={selectionPhase} selected={activeVehicle?.id === creation.vehicleId}
        busy={saving} error={saveError} onRetrySelection={() => void retrySelection(creation, captureScope())}
        onDone={() => { if (creation.isCurrent()) navigate("/", { replace: true }); }}/>
        : <>
          {saveError ? <p className="wizard-error wizard-save-error" data-testid="wizard-error" role="alert"><NumericText>{saveError}</NumericText></p> : null}
          {step === "plate" ? <PlateStep plate={plate} onPlateChange={changePlate} looking={looking} error={lookupError}
            canRetry={canRetryLookup} onLookup={() => void runLookup()} onManual={goManual}/>
            : step === "confirm" ? <ConfirmStep draft={draft} review={draft.fromRegistry && !editing} notice={lookupNotice} errors={errors}
              onChange={changeIdentity} onCorrect={() => setEditing(true)} onNext={nextStep}/>
              : <ExtrasStep draft={draft} numbers={numbers} nickname={nickname} specs={specs} loadingSpecs={loadingSpecs}
                saving={saving} errors={errors} onTankChange={value => { setNumbers(current => ({ ...current, tank: typeWizardNumber(value) })); setErrors(current => ({ ...current, tank: undefined })); }}
                onDeclaredChange={value => { setNumbers(current => ({ ...current, declared: typeWizardNumber(value) })); setErrors(current => ({ ...current, declared: undefined })); }}
                onNicknameChange={value => { setNickname(value); setErrors(current => ({ ...current, nickname: undefined })); }} onSave={() => void save()}/>}
        </>}
  </main>;
}
