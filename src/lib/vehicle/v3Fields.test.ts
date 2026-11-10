import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWizardVehicle, EMPTY_WIZARD_DRAFT, emptyWizardNumbers } from '../../components/vehicle-wizard/wizardState';
import { manufacturerBattery } from '../manufacturerSpecs';
import { lookupPlate, lookupTuning } from '../plateLookup';
import { fetchVehicleSpecs } from '../vehicleSpecs';
import {
  bizPatch, evFieldsForCreation, evRefreshPatch, horsepowerToKw, isEv, powertrainFromRegistry,
  readBattery, readBiz, readMotorKw, readPowertrain, wltpKmPerKwh,
} from './v3Fields';

/**
 * Registry rows shaped exactly like data.gov.il answers (checked 2026-11-10):
 * the plate register (053cea08…) gives `sug_delek_nm: "חשמל"`; the WLTP model
 * register (142afde2…) gives `delek_nm`, `technologiat_hanaa_nm`, `koah_sus`
 * (metric hp) and `dg_metach_solela` (battery voltage — NOT capacity). Neither
 * carries battery kWh or WLTP range. Synthetic plate; real model codes.
 */
const EV_PLATE = '99000001';
const EV_PLATE_ROW = { mispar_rechev: 99000001, tozeret_nm: 'בי ווי די סין', kinuy_mishari: 'ATTO 3', shnat_yitzur: 2024, sug_delek_nm: 'חשמל', tozeret_cd: 1014, degem_cd: 3 };
const EV_WLTP_ROW = { tozeret_cd: 1014, degem_cd: 3, shnat_yitzur: 2024, tozar: 'בי ווי די', kinuy_mishari: 'ATTO 3', delek_nm: 'חשמל', technologiat_hanaa_nm: 'רכב חשמלי',
  koah_sus: 204, dg_metach_solela: 403.2, nefah_manoa: 0, CO2_WLTP: null, kamut_CO2: null, merkav: 'פנאי-שטח' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('biz', () => {
  it('reads a bounded map and refuses anything else', () => {
    expect(readBiz({ company: 'א.ב. בע״מ', driver: 'דנה', usagePct: 80 })).toEqual({ company: 'א.ב. בע״מ', driver: 'דנה', usagePct: 80 });
    expect(readBiz({})).toEqual({});
    for (const bad of [null, 'x', [], { usagePct: 101 }, { usagePct: -1 }, { usagePct: NaN }, { company: 5 }, { company: 'x'.repeat(121) }, { vat: '1' }]) expect(readBiz(bad)).toBeNull();
  });
  it('normalises a form: trims, drops empties, clears when empty, throws on invalid', () => {
    expect(bizPatch({ company: '  חברה  ', driver: '', usagePct: 60 })).toEqual({ company: 'חברה', usagePct: 60 });
    expect(bizPatch({ company: ' ', driver: null, usagePct: null })).toBeNull();
    expect(() => bizPatch({ usagePct: 140 })).toThrow();
  });
});

describe('EV fields', () => {
  it('maps registry labels to a powertrain without guessing hybrids', () => {
    expect(powertrainFromRegistry('חשמל')).toBe('ev');
    expect(powertrainFromRegistry('חשמל', 'רכב חשמלי')).toBe('ev');
    expect(powertrainFromRegistry('חשמל/בנזין', 'PLUG IN')).toBe('phev');
    expect(powertrainFromRegistry('חשמל/דיזל')).toBe('phev');
    expect(powertrainFromRegistry('בנזין', 'הנעה רגילה')).toBeNull();
    expect(powertrainFromRegistry(undefined)).toBeNull();
  });
  it('isEv needs an explicit powertrain; legacy fuelType "other" is not electric', () => {
    expect(isEv({ powertrain: 'ev' })).toBe(true);
    expect(isEv({ powertrain: 'phev' })).toBe(false);
    expect(isEv({ fuelType: 'other' })).toBe(false);
    expect(isEv(null)).toBe(false);
  });
  it('bounded readers', () => {
    expect(readPowertrain('hydrogen')).toBeNull();
    expect(readBattery({ kwh: 60.5, wltp: 420 })).toEqual({ kwh: 60.5, wltp: 420 });
    expect(readBattery({ kwh: 60 })).toEqual({ kwh: 60, wltp: null });
    for (const bad of [{}, { kwh: 0 }, { kwh: 900 }, { wltp: 5000 }, { kwh: 60, chem: 'LFP' }, 60]) expect(readBattery(bad)).toBeNull();
    expect(readMotorKw(150)).toBe(150);
    expect(readMotorKw(0)).toBeNull();
    expect(horsepowerToKw(204)).toBe(150);
    expect(horsepowerToKw('204')).toBe(150);
    expect(horsepowerToKw(null)).toBeNull();
    expect(wltpKmPerKwh({ kwh: 60, wltp: 420 })).toBe(7);
  });
  it('creation stores only what was found', () => {
    expect(evFieldsForCreation({ powertrain: 'ev', motorKw: 150, battery: { kwh: 60, wltp: 420 } })).toEqual({ powertrain: 'ev', motorKw: 150, battery: { kwh: 60, wltp: 420 } });
    expect(evFieldsForCreation({ powertrain: null, motorKw: 96 })).toEqual({ motorKw: 96 });
    expect(evFieldsForCreation({ powertrain: 'phev', battery: { kwh: 10 } })).toEqual({ powertrain: 'phev' });
    expect(evFieldsForCreation(null)).toEqual({});
  });
  it('refresh replaces registry-owned fields and only fills a missing battery figure', () => {
    expect(evRefreshPatch({}, { powertrain: 'ev', motorKw: 150 })).toEqual({ powertrain: 'ev', motorKw: 150 });
    expect(evRefreshPatch({ powertrain: 'ev', motorKw: 150 }, { powertrain: 'ev', motorKw: 150 })).toEqual({});
    expect(evRefreshPatch({ powertrain: 'ev', battery: { kwh: 58, wltp: null } }, { powertrain: 'ev', battery: { kwh: 60, wltp: 420 } }))
      .toEqual({ battery: { kwh: 58, wltp: 420 } });
    expect(evRefreshPatch({ powertrain: 'ev', battery: { kwh: 58, wltp: 400 } }, { battery: { kwh: 60, wltp: 420 } })).toEqual({});
  });
  it('battery supplement matches a sourced entry by make, model and year', () => {
    const table = [{ make: /^(byd|בי ווי די)/i, model: /^atto\s?3/i, from: 2023, to: 2024, kwh: 60.48, wltp: 420, url: 'https://example.test/source' }];
    expect(manufacturerBattery('בי ווי די', 'ATTO 3', 2024, table)).toEqual({ kwh: 60.48, wltp: 420, url: 'https://example.test/source' });
    expect(manufacturerBattery('בי ווי די', 'ATTO 3', 2022, table)).toBeNull();
    expect(manufacturerBattery('בי ווי די', 'ATTO 3', 2024)).toBeNull();
  });
});

describe('EV from the plate', () => {
  it('the plate lookup reports powertrain "ev", fuel "other" and no engine volume', async () => {
    lookupTuning.retryDelayMs = 0;
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, result: { records: [{ ...EV_PLATE_ROW, nefch_manoa: 0 }] } })));
    const outcome = await lookupPlate(EV_PLATE);
    expect(outcome.status).toBe('found');
    if (outcome.status !== 'found') return;
    expect(outcome.vehicle).toMatchObject({ powertrain: 'ev', fuelType: 'other', engineVolume: null, tozeretCd: 1014, degemCd: 3 });
  });
  it('a petrol result carries no powertrain key at all', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, result: { records: [{ ...EV_PLATE_ROW, sug_delek_nm: 'בנזין' }] } })));
    const outcome = await lookupPlate(EV_PLATE);
    expect(outcome.status === 'found' && 'powertrain' in outcome.vehicle).toBe(false);
  });
  it('the WLTP spec join yields motor kW and suppresses tank, engine and km/L for an EV', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, result: { records: [EV_WLTP_ROW] } })));
    const specs = await fetchVehicleSpecs({ make: 'בי ווי די', model: 'ATTO 3', year: 2024, fuelType: 'other', tozeretCd: 1014, degemCd: 3, powertrain: 'ev' });
    expect(specs).toMatchObject({ powertrain: 'ev', motorKw: 150, battery: null, suggestedTankLiters: null, trustedTankLiters: null, engineCc: null, declaredKmPerLiter: null, declaredSource: null });
  });
  it('the wizard creates an EV with its fields and without a litre-tank estimate', () => {
    const draft = { ...EMPTY_WIZARD_DRAFT, make: 'בי ווי די', model: 'ATTO 3', year: '2024', fuelType: 'other' as const, plateNumber: EV_PLATE, fromRegistry: true, powertrain: 'ev' as const };
    const specs = { declaredKmPerLiter: null, declaredSource: null, matchedYear: 2024, suggestedTankLiters: 58, bodyType: 'פנאי-שטח', engineCc: null,
      co2WltpGramsPerKm: null, consumptionIsOfficial: false, powertrain: 'ev' as const, motorKw: 150, battery: { kwh: 60, wltp: 420 } };
    const result = buildWizardVehicle(draft, emptyWizardNumbers(), '', specs);
    expect(result).toMatchObject({ ok: true, vehicle: { powertrain: 'ev', motorKw: 150, battery: { kwh: 60, wltp: 420 }, tankLiters: null, tankLitersSource: null } });
    const petrol = buildWizardVehicle({ ...draft, fuelType: '95', powertrain: null }, emptyWizardNumbers(), '', { ...specs, powertrain: null, battery: null, motorKw: 96 });
    expect(petrol).toMatchObject({ ok: true, vehicle: { tankLiters: 58, tankLitersSource: 'estimate', motorKw: 96 } });
    expect(petrol.ok && 'powertrain' in petrol.vehicle).toBe(false);
  });
});
