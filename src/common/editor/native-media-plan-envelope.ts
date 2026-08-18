/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `NativeMediaPlanEnvelopeV1` — the closed union of exact canonical export
 * plans a milestone-5B native media consumer may execute.
 *
 * The native tier accelerates the canonical plan; it never reinterprets it. So
 * an envelope carries the plan in its canonical form, the fingerprint both
 * consumers derive independently, and a version-normalized semantic summary
 * that makes Web/native parity checkable field by field. The union contains
 * exactly the canonical static composition graph plan and the keyed V7 RGBA
 * plan — the two the product builds, never their history. Admitting a further
 * version is a deliberate change here — a new adapter, validator, fingerprint
 * rule, and parity golden — never a generic "unknown but plausible" acceptance.
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
import {
	assertVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanV7,
} from './video-keyframe-export-plan-v7.ts';
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
export const NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS = Object.freeze([7, 8] as const);

export type NativeMediaPlanVersion = (typeof NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS)[number];

export const NATIVE_MEDIA_PLAN_STRATEGIES = Object.freeze({
	7: 'framescaper-keyframed-rgba-v1',
	8: 'framescaper-static-composition',
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
 * A rate is reported the way its plan states it. V7 states an exact rational;
 * The graph plan states a decimal it already reduced. Neither is re-derived into the other,
 * because guessing a rational back out of a decimal is exactly the inference
 * the canonical-plan discipline forbids.
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
	readonly compositionIntervalCount: number | null;
	readonly videoEffectCount: number | null;
	readonly activeClipCount: number | null;
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
export function createNativeMediaPlanEnvelopeV1(value: unknown): NativeMediaPlanEnvelopeV1 {
	const planVersion = acceptedPlanVersion(value);
	const fingerprint = fingerprintNativeMediaPlan(value);
	const plan = deepFreeze(JSON.parse(fingerprint.canonical) as Record<string, unknown>);
	const summary = planVersion === CANONICAL_VIDEO_EXPORT_PLAN_VERSION
		? summarizeGraphPlan(admitGraphPlan(plan))
		: summarizeV7(admitV7(plan));
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
): asserts value is NativeMediaPlanEnvelopeV1 {
	const envelope = record(value, 'native media plan envelope');
	const present = Object.keys(envelope);
	if (present.length !== ENVELOPE_KEYS.length || present.some((key) => !ENVELOPE_KEYS.includes(key))) {
		nativeMediaPlanViolation('malformed', 'A native media plan envelope must carry exactly its schema keys.');
	}
	if (envelope.envelopeVersion !== NATIVE_MEDIA_PLAN_ENVELOPE_VERSION) {
		nativeMediaPlanViolation('unsupported-version', 'The native media plan envelope version is unsupported.');
	}
	const derived = createNativeMediaPlanEnvelopeV1(envelope.plan);
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
		compositionIntervalCount: plan.intervals.length,
		videoEffectCount: nativeMediaGraphPlanVideoEffectCount(plan),
		activeClipCount: null,
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
		compositionIntervalCount: null,
		videoEffectCount: null,
		activeClipCount: plan.activeClipIds.length,
	});
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
