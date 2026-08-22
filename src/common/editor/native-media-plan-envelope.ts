/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `NativeMediaPlanEnvelopeV1` — the closed union of exact canonical export
 * plans a milestone-5B native media consumer may execute.
 *
 * The native tier accelerates the canonical plan; it never reinterprets it. So
 * an envelope carries the plan in its canonical form, the fingerprint both
 * consumers derive independently, and a version-normalized semantic summary
 * that makes Web/native parity checkable field by field. The union contains
 * exactly the legacy canonical static/keyed plans plus each closed unified
 * V9–V12 generation. Admitting a further version is a deliberate change here
 * — a new adapter, validator, fingerprint rule, and parity golden — never a
 * generic "unknown but plausible" acceptance.
 */

import {
	assertNativeMediaGraphPlan,
	nativeMediaGraphPlanVideoEffectCount,
	type NativeMediaGraphPlan,
} from './native-media-graph-plan-admission.ts';
import {
	canonicalizeNativeMediaSummaryValue,
	fingerprintNativeMediaPlan,
	nativeMediaPlanViolation,
} from './native-media-plan-canonical-form.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from './native-media-plan-video-timing.ts';
import {
	assertVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanV7,
} from './video-keyframe-export-plan-v7.ts';
import {
	assertUnifiedExactRenderPlanV9,
	assertUnifiedExactRenderPlanV10,
	assertUnifiedExactRenderPlanV11,
	assertUnifiedExactRenderPlanV12,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlan,
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-plan.ts';
import { unifiedExactClipUsesRetime } from './unified-exact-render-plan-v9.ts';
import {
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
} from './video-export-plan-version.ts';

export {
	NativeMediaPlanViolationError,
	NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES,
} from './native-media-plan-canonical-form.ts';
export type { NativeMediaPlanViolationCode } from './native-media-plan-canonical-form.ts';

export const NATIVE_MEDIA_PLAN_ENVELOPE_VERSION = 1;

/**
 * The exact canonical plan versions this envelope admits. Closed by design.
 *
 * These are literals because the strategy table is keyed on them, so the module
 * checks at load that they are still the versions the product actually builds:
 * a canonical bump that forgot this list would otherwise leave the native tier
 * refusing every plan the renderer produces, at delivery time rather than here.
 */
export const NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS = Object.freeze([7, 8, 9, 10, 11, 12] as const);

export type NativeMediaPlanVersion = (typeof NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS)[number];

export const NATIVE_MEDIA_PLAN_STRATEGIES = Object.freeze({
	7: 'framescaper-keyframed-rgba-v1',
	8: 'framescaper-static-composition',
	9: 'framescaper-unified-exact-v1',
	10: 'framescaper-unified-exact-v1',
	11: 'framescaper-unified-exact-v1',
	12: 'framescaper-unified-exact-v1',
} as const);

for (const [version, name] of [
	[VIDEO_KEYFRAME_EXPORT_PLAN_VERSION, 'keyframe'],
	[CANONICAL_VIDEO_EXPORT_PLAN_VERSION, 'canonical graph'],
] as const) {
	if (!(NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS as readonly number[]).includes(version)) {
		throw new RangeError(`The native media envelope does not admit the ${name} plan version ${String(version)}.`);
	}
}

export type NativeMediaPlanStrategy =
	(typeof NATIVE_MEDIA_PLAN_STRATEGIES)[NativeMediaPlanVersion];

/**
 * A rate is reported the way its plan states it. V7 and unified V9–V12 state
 * exact rationals; the legacy graph plan states a decimal it already reduced.
 * Neither is re-derived into the other, because guessing a rational back out
 * of a decimal is exactly the inference the canonical-plan discipline forbids.
 */
export type NativeMediaPlanRateV1 =
	| Readonly<{ readonly kind: 'rational'; readonly num: number; readonly den: number }>
	| Readonly<{ readonly kind: 'decimal'; readonly value: number }>;

export type NativeMediaPlanDurationV1 =
	| Readonly<{ readonly kind: 'rational-seconds'; readonly num: number; readonly den: number }>
	| Readonly<{ readonly kind: 'decimal-seconds'; readonly seconds: number }>;

export interface NativeMediaPlanSourceInputV1 {
	readonly inputIndex: number;
	readonly sourceId: string;
	readonly mimeType: string;
	readonly contentSha256: string | null;
}

export interface NativeMediaPlanVideoTimingAssetInputV1 {
	readonly inputIndex: number;
	readonly sourceId: string;
	readonly encoding: 'soundscaper-video-timing-v1';
	readonly storageKey: string;
	readonly sha256: string;
	readonly sourceSha256: string;
	readonly byteLength: number;
	readonly frameCount: number;
	readonly timescale: number;
	readonly finalFrameDurationTicks: string;
}

export interface NativeMediaPlanFeatureNodeCountsV1 {
	readonly transitions: number;
	readonly visuals: number;
	readonly professionalMedia: number;
	readonly openFx: number;
	readonly retimedClips: number;
}

/**
 * The version-normalized semantic projection every consumer compares on. Fields
 * a plan version does not state are `null` — unreported, never inferred.
 */
export interface NativeMediaPlanSummaryV1 {
	readonly planVersion: NativeMediaPlanVersion;
	readonly strategy: NativeMediaPlanStrategy;
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
	readonly compositionIntervalCount: number | null;
	readonly videoEffectCount: number | null;
	readonly activeClipCount: number | null;
	readonly videoTrackCount: number | null;
	readonly featureNodeCounts: NativeMediaPlanFeatureNodeCountsV1 | null;
}

export interface NativeMediaPlanEnvelopeV1 {
	readonly envelopeVersion: typeof NATIVE_MEDIA_PLAN_ENVELOPE_VERSION;
	readonly planVersion: NativeMediaPlanVersion;
	readonly strategy: NativeMediaPlanStrategy;
	readonly fingerprint: string;
	readonly canonicalByteLength: number;
	readonly summary: NativeMediaPlanSummaryV1;
	readonly plan: Readonly<Record<string, unknown>>;
}

const ENVELOPE_KEYS = Object.freeze([
	'envelopeVersion', 'planVersion', 'strategy', 'fingerprint',
	'canonicalByteLength', 'summary', 'plan',
]);

/**
 * Admit one canonical plan and seal it into an envelope. The stored plan is the
 * canonical re-parse, so an envelope's fingerprint always describes exactly the
 * bytes it carries and no later mutation of the caller's object can desync it.
 */
export function createNativeMediaPlanEnvelopeV1(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): NativeMediaPlanEnvelopeV1 {
	const planVersion = acceptedPlanVersion(value);
	const fingerprint = fingerprintNativeMediaPlan(value);
	const plan = deepFreeze(JSON.parse(fingerprint.canonical) as Record<string, unknown>);
	const summary = planVersion === CANONICAL_VIDEO_EXPORT_PLAN_VERSION
		? summarizeGraphPlan(admitGraphPlan(plan))
		: planVersion === VIDEO_KEYFRAME_EXPORT_PLAN_VERSION
			? summarizeV7(admitV7(plan))
			: summarizeUnified(admitUnified(plan, planVersion, timingSidecars));
	return Object.freeze({
		envelopeVersion: NATIVE_MEDIA_PLAN_ENVELOPE_VERSION,
		planVersion,
		strategy: NATIVE_MEDIA_PLAN_STRATEGIES[planVersion],
		fingerprint: fingerprint.sha256,
		canonicalByteLength: fingerprint.byteLength,
		summary,
		plan,
	});
}

/**
 * Admit an independently parsed envelope. Every declared field is re-derived
 * from the carried plan: a peer cannot assert a fingerprint, strategy, or
 * summary its plan does not actually produce.
 */
export function assertNativeMediaPlanEnvelopeV1(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): asserts value is NativeMediaPlanEnvelopeV1 {
	const envelope = record(value, 'native media plan envelope');
	const present = Object.keys(envelope);
	if (present.length !== ENVELOPE_KEYS.length || present.some((key) => !ENVELOPE_KEYS.includes(key))) {
		nativeMediaPlanViolation('malformed', 'A native media plan envelope must carry exactly its schema keys.');
	}
	if (envelope.envelopeVersion !== NATIVE_MEDIA_PLAN_ENVELOPE_VERSION) {
		nativeMediaPlanViolation('unsupported-version', 'The native media plan envelope version is unsupported.');
	}
	const derived = createNativeMediaPlanEnvelopeV1(envelope.plan, timingSidecars);
	if (envelope.planVersion !== derived.planVersion
		|| envelope.strategy !== derived.strategy
		|| envelope.fingerprint !== derived.fingerprint
		|| envelope.canonicalByteLength !== derived.canonicalByteLength) {
		nativeMediaPlanViolation('malformed', 'A native media plan envelope does not describe its own plan.');
	}
	if (divergentNativeMediaPlanSummaryFields(envelope.summary, derived.summary).length > 0) {
		nativeMediaPlanViolation('malformed', 'A native media plan envelope summary does not describe its own plan.');
	}
}

/**
 * List the semantic fields on which two consumers disagree. An empty result is
 * the plan-parity claim milestone 5B's exit gate makes: the same envelope means
 * the same render on the Web and native paths.
 *
 * A field's meaning is compared, not its serialization. The summary is a
 * projection, not a fingerprinted document, and the peer that declared it may
 * emit the fields of a rate or an input in any order it likes.
 */
export function divergentNativeMediaPlanSummaryFields(
	left: unknown,
	right: NativeMediaPlanSummaryV1,
): readonly string[] {
	const candidate = left === null || typeof left !== 'object' || Array.isArray(left)
		? null
		: left as Readonly<Record<string, unknown>>;
	if (!candidate) return Object.freeze(['summary']);
	const divergent: string[] = [];
	for (const key of Object.keys(right) as (keyof NativeMediaPlanSummaryV1)[]) {
		if (!sameSemantics(candidate[key], right[key])) divergent.push(key);
	}
	for (const key of Object.keys(candidate)) {
		if (!Object.hasOwn(right, key)) divergent.push(key);
	}
	return Object.freeze(divergent.sort());
}

/** Compare two independently produced envelopes for the same canonical plan. */
export function divergentNativeMediaPlanEnvelopeFields(
	left: NativeMediaPlanEnvelopeV1,
	right: NativeMediaPlanEnvelopeV1,
): readonly string[] {
	const divergent: string[] = [];
	if (left.planVersion !== right.planVersion) divergent.push('planVersion');
	if (left.strategy !== right.strategy) divergent.push('strategy');
	if (left.fingerprint !== right.fingerprint) divergent.push('fingerprint');
	if (left.canonicalByteLength !== right.canonicalByteLength) divergent.push('canonicalByteLength');
	for (const field of divergentNativeMediaPlanSummaryFields(left.summary, right.summary)) {
		divergent.push(`summary.${field}`);
	}
	return Object.freeze(divergent.sort());
}

function acceptedPlanVersion(value: unknown): NativeMediaPlanVersion {
	const plan = record(value, 'native media plan');
	const descriptor = Object.getOwnPropertyDescriptor(plan, 'version');
	const version = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	if (!(NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS as readonly unknown[]).includes(version)) {
		nativeMediaPlanViolation(
			'unsupported-version',
			'A native media plan envelope admits only the exact canonical plan versions '
			+ `${NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS.join(' and ')}.`,
		);
	}
	return version;
}

function admitGraphPlan(plan: Readonly<Record<string, unknown>>): NativeMediaGraphPlan {
	assertNativeMediaGraphPlan(plan);
	return plan;
}

function admitV7(plan: Readonly<Record<string, unknown>>): VideoKeyframeExportPlanV7 {
	assertVideoKeyframeExportPlanV7(plan);
	return plan;
}

function admitUnified(
	plan: Readonly<Record<string, unknown>>,
	version: Exclude<NativeMediaPlanVersion, 7 | 8>,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlan {
	if (timingSidecars !== undefined) assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingSidecars);
	else if (version === 9) assertUnifiedExactRenderPlanV9(plan);
	else if (version === 10) assertUnifiedExactRenderPlanV10(plan);
	else if (version === 11) assertUnifiedExactRenderPlanV11(plan);
	else assertUnifiedExactRenderPlanV12(plan);
	return plan;
}

function summarizeGraphPlan(plan: NativeMediaGraphPlan): NativeMediaPlanSummaryV1 {
	const audioInput = plan.inputs.find((input) => input.kind === 'staged-audio-mix') ?? null;
	return Object.freeze({
		planVersion: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		strategy: NATIVE_MEDIA_PLAN_STRATEGIES[CANONICAL_VIDEO_EXPORT_PLAN_VERSION],
		container: plan.container,
		extension: plan.extension,
		mimeType: plan.mimeType,
		videoCodec: plan.codecs.video,
		videoEncoder: plan.codecs.videoEncoder,
		audioCodec: plan.codecs.audio,
		audioEncoder: plan.codecs.audioEncoder,
		pixelFormat: plan.codecs.pixelFormat,
		quality: plan.quality,
		width: plan.canvas.width,
		height: plan.canvas.height,
		backgroundColor: plan.canvas.backgroundColor,
		frameRate: Object.freeze({ kind: 'decimal' as const, value: plan.canvas.frameRate }),
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		durationFrames: plan.range.durationFrames,
		outputFrameCount: plan.outputFrameCount,
		duration: Object.freeze({ kind: 'decimal-seconds' as const, seconds: plan.durationSeconds }),
		includesAudio: audioInput !== null,
		projectSampleRate: audioInput === null ? null : audioInput.sampleRate,
		videoSourceInputs: Object.freeze(plan.inputs
			.filter((input) => input.kind === 'video-source')
			.map((input) => Object.freeze({
				inputIndex: input.inputIndex,
				sourceId: input.sourceId,
				mimeType: input.mimeType,
				contentSha256: null,
			}))),
		videoTimingAssetInputs: Object.freeze([]),
		compositionIntervalCount: plan.intervals.length,
		videoEffectCount: nativeMediaGraphPlanVideoEffectCount(plan),
		activeClipCount: null,
		videoTrackCount: null,
		featureNodeCounts: null,
	});
}

function summarizeV7(plan: VideoKeyframeExportPlanV7): NativeMediaPlanSummaryV1 {
	return Object.freeze({
		planVersion: VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
		strategy: NATIVE_MEDIA_PLAN_STRATEGIES[VIDEO_KEYFRAME_EXPORT_PLAN_VERSION],
		container: plan.container,
		extension: plan.extension,
		mimeType: plan.mimeType,
		videoCodec: plan.codecs.video,
		videoEncoder: plan.codecs.videoEncoder,
		audioCodec: plan.codecs.audio,
		audioEncoder: plan.codecs.audioEncoder,
		pixelFormat: plan.codecs.pixelFormat,
		quality: plan.quality,
		width: plan.canvas.width,
		height: plan.canvas.height,
		backgroundColor: plan.canvas.backgroundColor,
		frameRate: Object.freeze({
			kind: 'rational' as const,
			num: plan.canvas.frameRate.num,
			den: plan.canvas.frameRate.den,
		}),
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		durationFrames: plan.range.durationFrames,
		outputFrameCount: plan.outputFrameCount,
		duration: Object.freeze({
			kind: 'rational-seconds' as const,
			num: plan.duration.num,
			den: plan.duration.den,
		}),
		includesAudio: plan.codecs.audio !== null,
		projectSampleRate: plan.sampleRate,
		videoSourceInputs: Object.freeze(plan.inputs
			.filter((input): input is Extract<typeof input, { kind: 'video-source' }> => (
				input.kind === 'video-source'
			))
			.map((input) => Object.freeze({
				inputIndex: input.inputIndex,
				sourceId: input.sourceId,
				mimeType: input.mimeType,
				contentSha256: input.contentSha256,
			}))),
		videoTimingAssetInputs: Object.freeze([]),
		compositionIntervalCount: null,
		videoEffectCount: null,
		activeClipCount: plan.activeClipIds.length,
		videoTrackCount: null,
		featureNodeCounts: null,
	});
}

function summarizeUnified(plan: UnifiedExactRenderPlan): NativeMediaPlanSummaryV1 {
	const clips = plan.nodes.filter((node) => node.kind === 'clip');
	const counts = Object.freeze({
		transitions: plan.nodes.filter((node) => node.kind === 'transition').length,
		visuals: plan.nodes.filter((node) => node.kind === 'visual').length,
		professionalMedia: plan.nodes.filter((node) => node.kind === 'professional-media').length,
		openFx: plan.nodes.filter((node) => node.kind === 'openfx').length,
		retimedClips: clips.filter(unifiedExactClipUsesRetime).length,
	});
	const durationDivisor = greatestCommonDivisor(
		BigInt(plan.timebase.sampleDuration),
		BigInt(plan.timebase.sampleRate),
	);
	return Object.freeze({
		planVersion: plan.version,
		strategy: NATIVE_MEDIA_PLAN_STRATEGIES[plan.version],
		container: plan.format.container,
		extension: plan.format.extension,
		mimeType: plan.format.mimeType,
		videoCodec: plan.codecs.video,
		videoEncoder: plan.codecs.videoEncoder,
		audioCodec: plan.codecs.audio,
		audioEncoder: plan.codecs.audioEncoder,
		pixelFormat: plan.codecs.pixelFormat,
		quality: plan.output.quality,
		width: plan.output.canvas.width,
		height: plan.output.canvas.height,
		backgroundColor: plan.output.canvas.backgroundColor,
		frameRate: Object.freeze({
			kind: 'rational' as const,
			num: plan.output.frameRate.num,
			den: plan.output.frameRate.den,
		}),
		startFrame: plan.timebase.sampleStart,
		endFrame: plan.timebase.sampleStart + plan.timebase.sampleDuration,
		durationFrames: plan.timebase.sampleDuration,
		outputFrameCount: plan.output.frameCount,
		duration: Object.freeze({
			kind: 'rational-seconds' as const,
			num: Number(BigInt(plan.timebase.sampleDuration) / durationDivisor),
			den: Number(BigInt(plan.timebase.sampleRate) / durationDivisor),
		}),
		includesAudio: plan.output.includeAudio,
		projectSampleRate: plan.output.includeAudio ? plan.timebase.sampleRate : null,
		videoSourceInputs: Object.freeze(plan.sources.map((source) => Object.freeze({
			inputIndex: source.inputIndex,
			sourceId: source.sourceId,
			mimeType: source.mimeType,
			contentSha256: source.contentSha256,
		}))),
		videoTimingAssetInputs: nativeMediaPlanVideoTimingAssetInputs(plan),
		compositionIntervalCount: null,
		videoEffectCount: counts.transitions + counts.visuals + counts.openFx,
		activeClipCount: clips.length,
		videoTrackCount: plan.tracks.length,
		featureNodeCounts: counts,
	});
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left;
}

function sameSemantics(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
	const declared = semanticForm(left);
	return declared !== null && declared === semanticForm(right);
}

/** A value no canonical form can describe states nothing, so it agrees with nothing. */
function semanticForm(value: unknown): string | null {
	try {
		return canonicalizeNativeMediaSummaryValue(value);
	} catch {
		return null;
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		nativeMediaPlanViolation('malformed', `A ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function deepFreeze<Value>(value: Value): Value {
	if (value === null || typeof value !== 'object') return value;
	for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
	return Object.freeze(value);
}
