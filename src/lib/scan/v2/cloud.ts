/**
 * Cloud fallback SEAM — not implemented, OFF.
 *
 * Nothing here sends anything anywhere: there is no endpoint, no key and no
 * network call in the app. This file fixes the contract a future fallback
 * must keep so it cannot quietly widen what leaves the device:
 *   - payload is the guide-box crop only (never the full photo, location,
 *     vehicle or account data);
 *   - the prompt is structured and asks for JSON matching `CLOUD_SCHEMA`;
 *   - it is consulted only when on-device confidence is low AND the person
 *     turned it on; its answer still goes to the verification screen.
 */
import type { ScanKind } from './guide';

export const CLOUD_FALLBACK_ENABLED = false as const;
/** Below this on-device confidence a fallback MAY be offered (if enabled). */
export const CLOUD_CONFIDENCE_THRESHOLD = .6;

export type CloudFallbackRequest = {
  kind: ScanKind;
  /** PNG of the crop only, base64 without a data: prefix. */
  cropPng: string;
  cropSize: { width: number; height: number };
  prompt: string;
  schema: typeof CLOUD_SCHEMA[ScanKind];
};
export type CloudFallbackResponse =
  | { kind: 'pump'; total: string | null; liters: string | null; price: string | null }
  | { kind: 'odometer'; odometer: string | null };
export interface CloudFallback {
  read(request: CloudFallbackRequest, signal?: AbortSignal): Promise<CloudFallbackResponse>;
}

export const CLOUD_SCHEMA = {
  pump: {
    type: 'object', additionalProperties: false, required: ['total', 'liters', 'price'],
    properties: {
      total: { type: ['string', 'null'], pattern: '^\\d{1,5}\\.\\d{2}$' },
      liters: { type: ['string', 'null'], pattern: '^\\d{1,3}\\.\\d{2,3}$' },
      price: { type: ['string', 'null'], pattern: '^\\d{1,2}\\.\\d{2,3}$' },
    },
  },
  odometer: {
    type: 'object', additionalProperties: false, required: ['odometer'],
    properties: { odometer: { type: ['string', 'null'], pattern: '^\\d{1,7}$' } },
  },
} as const;

const PROMPTS: Record<ScanKind, string> = {
  pump: [
    'The image is a crop of a fuel pump display in Israel (amounts in shekels).',
    'Read exactly the digits shown. Rows, top to bottom: amount to pay, litres, price per litre.',
    'Copy decimal points as displayed. If a digit is not fully legible, return null for that field.',
    'Never compute or infer a value from the other rows. Respond with JSON only.',
  ].join('\n'),
  odometer: [
    'The image is a crop of a car dashboard. Read the total distance (odometer) in km.',
    'Ignore trip meters (often with a decimal), clocks, temperature and range.',
    'If the odometer is not fully legible, return null. Respond with JSON only.',
  ].join('\n'),
};

export function buildCloudRequest(kind: ScanKind, cropPng: string, cropSize: { width: number; height: number }): CloudFallbackRequest {
  return { kind, cropPng, cropSize, prompt: PROMPTS[kind], schema: CLOUD_SCHEMA[kind] };
}

/** Whether a fallback may be offered. Always false while the seam is unimplemented. */
export function shouldOfferCloud(confidence: number | null, userOptIn: boolean, enabled: boolean = CLOUD_FALLBACK_ENABLED): boolean {
  return enabled && userOptIn && (confidence == null || confidence < CLOUD_CONFIDENCE_THRESHOLD);
}
