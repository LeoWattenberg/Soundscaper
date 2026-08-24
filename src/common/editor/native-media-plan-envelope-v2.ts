/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed V13 migration custody and selected V14 native-execution envelope. */

import {
	canonicalizeNativeMediaSummaryValue,
	fingerprintNativeMediaPlan,
	nativeMediaPlanViolation,
} from './native-media-plan-canonical-form.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from './native-media-plan-video-timing.ts';
import type {
	NativeMediaPlanDurationV1,
	NativeMediaPlanFeatureNodeCountsV1,
	NativeMediaPlanRateV1,
	NativeMediaPlanSourceInputV1,
	NativeMediaPlanVideoTimingAssetInputV1,
} from './native-media-plan-envelope.ts';
import {
	assertUnifiedExactRenderPlanV13,
	assertUnifiedExactRenderPlanV14,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV13,
	type UnifiedExactRenderPlanV14,
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-plan.ts';
import { unifiedExactClipUsesRetime } from './unified-exact-render-plan-v9.ts';

export const NATIVE_MEDIA_PLAN_ENVELOPE_V2_VERSION = 2 as const;
export const NATIVE_MEDIA_PLAN_V2_ACCEPTED_VERSIONS = Object.freeze([13, 14] as const);
export type NativeMediaPlanVersionV2 = (typeof NATIVE_MEDIA_PLAN_V2_ACCEPTED_VERSIONS)[number];
export const NATIVE_MEDIA_PLAN_V2_STRATEGIES = Object.freeze({
	13: 'framescaper-unified-exact-v13-custody',
	14: 'framescaper-unified-exact-v14-native',
} as const);
export type NativeMediaPlanStrategyV2 = (typeof NATIVE_MEDIA_PLAN_V2_STRATEGIES)[NativeMediaPlanVersionV2];

export interface NativeMediaPlanSummaryV2 {
	readonly planVersion: NativeMediaPlanVersionV2;
	readonly strategy: NativeMediaPlanStrategyV2;
	readonly container: string;
	readonly extension: string;
	readonly mimeType: string;
	readonly videoCodec: string;
	readonly videoEncoder: string;
	readonly audioCodec: string | null;
	readonly audioEncoder: string | null;
	readonly pixelFormat: string;
	readonly quality: 'draft' | 'balanced' | 'high';
	readonly width: number;
	readonly height: number;
	readonly backgroundColor: string;
	readonly frameRate: NativeMediaPlanRateV1;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
	readonly outputFrameCount: number;
	readonly duration: NativeMediaPlanDurationV1;
	readonly includesAudio: boolean;
	readonly projectSampleRate: number | null;
	readonly videoSourceInputs: readonly NativeMediaPlanSourceInputV1[];
	readonly videoTimingAssetInputs: readonly NativeMediaPlanVideoTimingAssetInputV1[];
	readonly videoTrackCount: number;
	readonly featureNodeCounts: NativeMediaPlanFeatureNodeCountsV1;
}

export interface NativeMediaPlanEnvelopeV2 {
	readonly envelopeVersion: typeof NATIVE_MEDIA_PLAN_ENVELOPE_V2_VERSION;
	readonly planVersion: NativeMediaPlanVersionV2;
	readonly strategy: NativeMediaPlanStrategyV2;
	readonly fingerprint: string;
	readonly canonicalByteLength: number;
	readonly summary: NativeMediaPlanSummaryV2;
	readonly plan: UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV14;
}

const FIELDS = Object.freeze([
	'envelopeVersion', 'planVersion', 'strategy', 'fingerprint', 'canonicalByteLength', 'summary', 'plan',
]);

export function createNativeMediaPlanEnvelopeV2(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): NativeMediaPlanEnvelopeV2 {
	const version = planVersion(value);
	if (timingSidecars === undefined) {
		if (version === 13) assertUnifiedExactRenderPlanV13(value);
		else assertUnifiedExactRenderPlanV14(value);
	} else assertUnifiedExactRenderPlanWithTimingSidecars(value, timingSidecars);
	const fingerprint = fingerprintNativeMediaPlan(value);
	const plan = deepFreeze(JSON.parse(fingerprint.canonical)) as UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV14;
	return Object.freeze({
		envelopeVersion: NATIVE_MEDIA_PLAN_ENVELOPE_V2_VERSION,
		planVersion: version,
		strategy: NATIVE_MEDIA_PLAN_V2_STRATEGIES[version],
		fingerprint: fingerprint.sha256,
		canonicalByteLength: fingerprint.byteLength,
		summary: summarize(plan),
		plan,
	});
}

export function assertNativeMediaPlanEnvelopeV2(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): asserts value is NativeMediaPlanEnvelopeV2 {
	const candidate = record(value, 'native media plan envelope V2');
	const keys = Reflect.ownKeys(candidate);
	if (keys.length !== FIELDS.length || keys.some((key) => typeof key !== 'string' || !FIELDS.includes(key))) {
		nativeMediaPlanViolation('malformed', 'A native media plan envelope V2 must carry exactly its schema keys.');
	}
	if (candidate.envelopeVersion !== NATIVE_MEDIA_PLAN_ENVELOPE_V2_VERSION) {
		nativeMediaPlanViolation('unsupported-version', 'The native media plan envelope V2 version is unsupported.');
	}
	const derived = createNativeMediaPlanEnvelopeV2(candidate.plan, timingSidecars);
	for (const field of ['planVersion', 'strategy', 'fingerprint', 'canonicalByteLength'] as const) {
		if (candidate[field] !== derived[field]) nativeMediaPlanViolation('malformed', `Envelope V2 ${field} is not derived.`);
	}
	if (semantic(candidate.summary) !== semantic(derived.summary)) {
		nativeMediaPlanViolation('malformed', 'Envelope V2 summary does not describe its own plan.');
	}
}

export function divergentNativeMediaPlanEnvelopeV2Fields(
	left: NativeMediaPlanEnvelopeV2,
	right: NativeMediaPlanEnvelopeV2,
): readonly string[] {
	const fields: string[] = [];
	for (const field of ['planVersion', 'strategy', 'fingerprint', 'canonicalByteLength'] as const) {
		if (left[field] !== right[field]) fields.push(field);
	}
	if (semantic(left.summary) !== semantic(right.summary)) fields.push('summary');
	return Object.freeze(fields);
}

function summarize(plan: UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV14): NativeMediaPlanSummaryV2 {
	const clips = plan.nodes.filter((node) => node.kind === 'clip');
	const divisor = greatestCommonDivisor(BigInt(plan.timebase.sampleDuration), BigInt(plan.timebase.sampleRate));
	const counts = Object.freeze({
		transitions: plan.nodes.filter(({ kind }) => kind === 'transition').length,
		visuals: plan.nodes.filter(({ kind }) => kind === 'visual').length,
		professionalMedia: plan.nodes.filter(({ kind }) => kind === 'professional-media').length,
		openFx: plan.nodes.filter(({ kind }) => kind === 'openfx').length,
		retimedClips: clips.filter(unifiedExactClipUsesRetime).length,
	});
	return Object.freeze({
		planVersion: plan.version,
		strategy: NATIVE_MEDIA_PLAN_V2_STRATEGIES[plan.version],
		container: plan.format.container, extension: plan.format.extension, mimeType: plan.format.mimeType,
		videoCodec: plan.codecs.video, videoEncoder: plan.codecs.videoEncoder,
		audioCodec: plan.codecs.audio, audioEncoder: plan.codecs.audioEncoder,
		pixelFormat: plan.codecs.pixelFormat, quality: plan.output.quality,
		width: plan.output.canvas.width, height: plan.output.canvas.height,
		backgroundColor: plan.output.canvas.backgroundColor,
		frameRate: Object.freeze({ kind: 'rational', ...plan.output.frameRate }),
		startFrame: plan.timebase.sampleStart,
		endFrame: plan.timebase.sampleStart + plan.timebase.sampleDuration,
		durationFrames: plan.timebase.sampleDuration,
		outputFrameCount: plan.output.frameCount,
		duration: Object.freeze({
			kind: 'rational-seconds',
			num: Number(BigInt(plan.timebase.sampleDuration) / divisor),
			den: Number(BigInt(plan.timebase.sampleRate) / divisor),
		}),
		includesAudio: plan.output.includeAudio,
		projectSampleRate: plan.output.includeAudio ? plan.timebase.sampleRate : null,
		videoSourceInputs: Object.freeze(plan.sources.map((source) => Object.freeze({
			inputIndex: source.inputIndex, sourceId: source.sourceId,
			mimeType: source.mimeType, contentSha256: source.contentSha256,
		}))),
		videoTimingAssetInputs: nativeMediaPlanVideoTimingAssetInputs(plan),
		videoTrackCount: plan.tracks.length,
		featureNodeCounts: counts,
	});
}

function planVersion(value: unknown): NativeMediaPlanVersionV2 {
	const version = record(value, 'native media plan').version;
	if (!(NATIVE_MEDIA_PLAN_V2_ACCEPTED_VERSIONS as readonly unknown[]).includes(version)) {
		nativeMediaPlanViolation('unsupported-version', 'Envelope V2 admits only exact V13 and V14 plans.');
	}
	return version as NativeMediaPlanVersionV2;
}
function semantic(value: unknown): string | null {
	try { return canonicalizeNativeMediaSummaryValue(value); } catch { return null; }
}
function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left;
}
function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) nativeMediaPlanViolation('malformed', `${label} must be an object.`);
	return value as Record<string, unknown>;
}
function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}
