/* SPDX-License-Identifier: AGPL-3.0-only */

/** V13/V14 custody plus the selected V15 delivery envelope. */

import {
	canonicalizeNativeMediaSummaryValue,
	fingerprintNativeMediaPlan,
	nativeMediaPlanViolation,
} from './native-media-plan-canonical-form.ts';
import {
	createNativeMediaPlanEnvelopeV2,
	type NativeMediaPlanSummaryV2,
} from './native-media-plan-envelope-v2.ts';
import type {
	UnifiedExactRenderCaptionDeliveryV15,
	UnifiedExactRenderCompanionAudioV15,
} from './unified-exact-render-delivery-v15.ts';
import {
	assertUnifiedExactRenderPlanV13,
	assertUnifiedExactRenderPlanV14,
	assertUnifiedExactRenderPlanV15,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV13,
	type UnifiedExactRenderPlanV14,
	type UnifiedExactRenderPlanV15,
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-plan.ts';

export const NATIVE_MEDIA_PLAN_ENVELOPE_V3_VERSION = 3 as const;
export const NATIVE_MEDIA_PLAN_V3_ACCEPTED_VERSIONS = Object.freeze([13, 14, 15] as const);
export type NativeMediaPlanVersionV3 = (typeof NATIVE_MEDIA_PLAN_V3_ACCEPTED_VERSIONS)[number];
export const NATIVE_MEDIA_PLAN_V3_STRATEGIES = Object.freeze({
	13: 'framescaper-unified-exact-v13-custody',
	14: 'framescaper-unified-exact-v14-native',
	15: 'framescaper-unified-exact-v15-delivery',
} as const);
export type NativeMediaPlanStrategyV3 =
	(typeof NATIVE_MEDIA_PLAN_V3_STRATEGIES)[NativeMediaPlanVersionV3];

export interface NativeMediaPlanSummaryV3 extends Omit<
	NativeMediaPlanSummaryV2,
	'planVersion' | 'strategy'
> {
	readonly planVersion: NativeMediaPlanVersionV3;
	readonly strategy: NativeMediaPlanStrategyV3;
	readonly captionDelivery: UnifiedExactRenderCaptionDeliveryV15 | null;
	readonly companionAudio: UnifiedExactRenderCompanionAudioV15 | null;
}

export interface NativeMediaPlanEnvelopeV3 {
	readonly envelopeVersion: typeof NATIVE_MEDIA_PLAN_ENVELOPE_V3_VERSION;
	readonly planVersion: NativeMediaPlanVersionV3;
	readonly strategy: NativeMediaPlanStrategyV3;
	readonly fingerprint: string;
	readonly canonicalByteLength: number;
	readonly summary: NativeMediaPlanSummaryV3;
	readonly plan: UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV14 | UnifiedExactRenderPlanV15;
}

const FIELDS = Object.freeze([
	'envelopeVersion', 'planVersion', 'strategy', 'fingerprint', 'canonicalByteLength', 'summary', 'plan',
]);

export function createNativeMediaPlanEnvelopeV3(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): NativeMediaPlanEnvelopeV3 {
	const version = planVersion(value);
	if (timingSidecars === undefined) {
		if (version === 13) assertUnifiedExactRenderPlanV13(value);
		else if (version === 14) assertUnifiedExactRenderPlanV14(value);
		else assertUnifiedExactRenderPlanV15(value);
	} else assertUnifiedExactRenderPlanWithTimingSidecars(value, timingSidecars);
	const fingerprint = fingerprintNativeMediaPlan(value);
	const plan = deepFreeze(JSON.parse(fingerprint.canonical)) as NativeMediaPlanEnvelopeV3['plan'];
	return Object.freeze({
		envelopeVersion: NATIVE_MEDIA_PLAN_ENVELOPE_V3_VERSION,
		planVersion: version,
		strategy: NATIVE_MEDIA_PLAN_V3_STRATEGIES[version],
		fingerprint: fingerprint.sha256,
		canonicalByteLength: fingerprint.byteLength,
		summary: summarize(plan, timingSidecars),
		plan,
	});
}

export function assertNativeMediaPlanEnvelopeV3(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): asserts value is NativeMediaPlanEnvelopeV3 {
	const candidate = record(value, 'native media plan envelope V3');
	const keys = Reflect.ownKeys(candidate);
	if (keys.length !== FIELDS.length
		|| keys.some((key) => typeof key !== 'string' || !FIELDS.includes(key))) {
		nativeMediaPlanViolation('malformed', 'A native media plan envelope V3 must carry exactly its schema keys.');
	}
	if (candidate.envelopeVersion !== NATIVE_MEDIA_PLAN_ENVELOPE_V3_VERSION) {
		nativeMediaPlanViolation('unsupported-version', 'The native media plan envelope V3 version is unsupported.');
	}
	const derived = createNativeMediaPlanEnvelopeV3(candidate.plan, timingSidecars);
	for (const field of ['planVersion', 'strategy', 'fingerprint', 'canonicalByteLength'] as const) {
		if (candidate[field] !== derived[field]) {
			nativeMediaPlanViolation('malformed', `Envelope V3 ${field} is not derived.`);
		}
	}
	if (semantic(candidate.summary) !== semantic(derived.summary)) {
		nativeMediaPlanViolation('malformed', 'Envelope V3 summary does not describe its own plan.');
	}
}

export function divergentNativeMediaPlanEnvelopeV3Fields(
	left: NativeMediaPlanEnvelopeV3,
	right: NativeMediaPlanEnvelopeV3,
): readonly string[] {
	const fields: string[] = [];
	for (const field of ['planVersion', 'strategy', 'fingerprint', 'canonicalByteLength'] as const) {
		if (left[field] !== right[field]) fields.push(field);
	}
	if (semantic(left.summary) !== semantic(right.summary)) fields.push('summary');
	return Object.freeze(fields);
}

function summarize(
	plan: NativeMediaPlanEnvelopeV3['plan'],
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): NativeMediaPlanSummaryV3 {
	const foundation = plan.version === 15 ? v14Foundation(plan) : plan;
	const summary = createNativeMediaPlanEnvelopeV2(foundation, timingSidecars).summary;
	return Object.freeze({
		...summary,
		planVersion: plan.version,
		strategy: NATIVE_MEDIA_PLAN_V3_STRATEGIES[plan.version],
		captionDelivery: plan.version === 15 ? plan.captionDelivery : null,
		companionAudio: plan.version === 15 ? plan.companionAudio : null,
	});
}

function v14Foundation(plan: UnifiedExactRenderPlanV15): UnifiedExactRenderPlanV14 {
	const candidate = structuredClone(plan) as unknown as Record<string, unknown>;
	candidate.version = 14;
	delete candidate.captionDelivery;
	delete candidate.companionAudio;
	return candidate as unknown as UnifiedExactRenderPlanV14;
}

function planVersion(value: unknown): NativeMediaPlanVersionV3 {
	const version = record(value, 'native media plan').version;
	if (!(NATIVE_MEDIA_PLAN_V3_ACCEPTED_VERSIONS as readonly unknown[]).includes(version)) {
		nativeMediaPlanViolation('unsupported-version', 'Envelope V3 admits only exact V13, V14, and V15 plans.');
	}
	return version as NativeMediaPlanVersionV3;
}

function semantic(value: unknown): string | null {
	try { return canonicalizeNativeMediaSummaryValue(value); } catch { return null; }
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		nativeMediaPlanViolation('malformed', `${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}
