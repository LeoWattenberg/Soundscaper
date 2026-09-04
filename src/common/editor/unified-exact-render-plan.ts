/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed authority for dormant V9–V12 plans and the selected V13 finishing branch. */

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
	type NativeMediaPlanFingerprint,
} from './native-media-plan-canonical-form.ts';
import type { NativeMediaV14EncodeProfileId } from './native-media-v14-native-dispatch.ts';
import type { VideoCanvasFit } from './video-canvas-fit.ts';
import type { VideoDeliveryAudioLayout } from './video-delivery-audio-layout.ts';
import type { VideoDeliveryQuality } from './video-delivery-quality.ts';
import { normalizePlan } from './unified-exact-render-plan-normalization.ts';
import {
	deepFreezeExactRenderValue as deepFreeze,
} from './unified-exact-render-plan-primitives.ts';
import {
	type UnifiedExactRenderFormat,
} from './unified-exact-render-plan-format.ts';
import {
	type UnifiedExactRenderCaptionDeliveryV15,
	type UnifiedExactRenderCompanionAudioV15,
} from './unified-exact-render-delivery-v15.ts';
import {
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderClipPictureStateV1,
	type UnifiedExactRenderPlanSource,
	type UnifiedExactRenderTrackAuthorityV1,
	type UnifiedExactRenderTransitionNode,
} from './unified-exact-render-plan-v9.ts';
import {
	type UnifiedExactRenderVisualNode,
	type UnifiedExactVisualPlacementV1,
	type UnifiedExactVisualModelKind,
} from './unified-exact-render-plan-v10.ts';
import {
	type UnifiedExactRenderProfessionalMediaNode,
} from './unified-exact-render-plan-v11.ts';
import {
	type UnifiedExactRenderOpenFxNode,
} from './unified-exact-render-plan-v12.ts';
import {
	type UnifiedExactRenderFinishingNode,
} from './unified-exact-render-plan-v13.ts';
import {
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-timing-authority.ts';
export type {
	UnifiedExactRenderClipNode,
	UnifiedExactRenderClipPictureStateV1,
	UnifiedExactRenderPlanSource,
	UnifiedExactRenderTrackAuthorityV1,
	UnifiedExactRenderTransitionNode,
	UnifiedExactRenderVisualNode,
	UnifiedExactVisualPlacementV1,
	UnifiedExactVisualModelKind,
	UnifiedExactRenderProfessionalMediaNode,
	UnifiedExactRenderOpenFxNode,
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderTimingSidecars,
};

export const UNIFIED_EXACT_RENDER_PLAN_VERSIONS = Object.freeze([9, 10, 11, 12, 13, 14, 15] as const);
export type UnifiedExactRenderPlanVersion = (typeof UNIFIED_EXACT_RENDER_PLAN_VERSIONS)[number];

export type UnifiedExactRenderNode =
	| UnifiedExactRenderClipNode
	| UnifiedExactRenderTransitionNode
	| UnifiedExactRenderVisualNode
	| UnifiedExactRenderProfessionalMediaNode
	| UnifiedExactRenderOpenFxNode
	| UnifiedExactRenderFinishingNode;

export interface UnifiedExactRenderPlan extends Readonly<Record<string, unknown>> {
	readonly version: UnifiedExactRenderPlanVersion;
	readonly strategy: 'framescaper-unified-exact-v1';
	readonly project: Readonly<{ readonly id: string; readonly revision: number }>;
	readonly format: UnifiedExactRenderFormat;
	/** Present only in V14/V15; closes the exact professional encoder/profile tuple. */
	readonly deliveryProfile?: NativeMediaV14EncodeProfileId;
	/** Present only in V15; binds closed caption and image-sequence companion delivery. */
	readonly captionDelivery?: UnifiedExactRenderCaptionDeliveryV15 | null;
	/** Present only in V15; references the separately sealed ordinary audio plan. */
	readonly companionAudio?: UnifiedExactRenderCompanionAudioV15 | null;
	readonly codecs: Readonly<{
		readonly video: string;
		readonly videoEncoder: string;
		readonly audio: string | null;
		readonly audioEncoder: string | null;
		readonly pixelFormat: string;
	}>;
	readonly timebase: Readonly<{
		readonly sampleStart: number;
		readonly sampleDuration: number;
		readonly sampleRate: number;
		readonly sequenceId: string;
		readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	}>;
	readonly output: Readonly<{
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly frameCount: number;
		readonly quality: VideoDeliveryQuality;
		readonly canvas: Readonly<{
			readonly width: number;
			readonly height: number;
			readonly fit: VideoCanvasFit;
			readonly pixelFormat: string;
			readonly backgroundColor: string;
		}>;
		readonly includeAudio: boolean;
		readonly audioLayout: VideoDeliveryAudioLayout | null;
	}>;
	readonly tracks: readonly UnifiedExactRenderTrackAuthorityV1[];
	readonly sources: readonly UnifiedExactRenderPlanSource[];
	readonly nodes: readonly UnifiedExactRenderNode[];
}

export type UnifiedExactRenderPlanV9 = UnifiedExactRenderPlan & Readonly<{ readonly version: 9 }>;
export type UnifiedExactRenderPlanV10 = UnifiedExactRenderPlan & Readonly<{ readonly version: 10 }>;
export type UnifiedExactRenderPlanV11 = UnifiedExactRenderPlan & Readonly<{ readonly version: 11 }>;
export type UnifiedExactRenderPlanV12 = UnifiedExactRenderPlan & Readonly<{ readonly version: 12 }>;
export type UnifiedExactRenderPlanV13 = UnifiedExactRenderPlan & Readonly<{ readonly version: 13 }>;
export type UnifiedExactRenderPlanV14 = UnifiedExactRenderPlan & Readonly<{ readonly version: 14 }>;
export type UnifiedExactRenderPlanV15 = UnifiedExactRenderPlan & Readonly<{
	readonly version: 15; readonly deliveryProfile: NativeMediaV14EncodeProfileId;
	readonly captionDelivery: UnifiedExactRenderCaptionDeliveryV15 | null;
	readonly companionAudio: UnifiedExactRenderCompanionAudioV15 | null;
}>;

/** Normalize, detach, and deeply freeze one exact generation. */
export function createUnifiedExactRenderPlan(value: unknown): UnifiedExactRenderPlan {
	return createPlan(value);
}

/** Normalize a V9–V13 plan while authenticating digest-bound VFR timing bodies. */
export function createUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlan {
	return createPlan(value, timingSidecars);
}

function createPlan(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlan {
	const normalized = normalizePlan(value, timingSidecars);
	const canonical = canonicalizeNativeMediaPlan(normalized);
	const detached = normalizePlan(JSON.parse(canonical) as unknown, timingSidecars);
	return deepFreeze(detached);
}

/** Require an already-normalized canonical V9–V13 wire. */
export function assertUnifiedExactRenderPlan(value: unknown): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A unified exact render plan must use its canonical semantic order and values.');
	}
}

/** Require a canonical V9–V13 wire and authenticate each referenced VFR body. */
export function assertUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value, timingSidecars);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A unified exact render plan must use its canonical semantic order and values.');
	}
}

/** Durable queue rows retain references only; execution must re-run with authenticated SCTI tokens. */
export function assertUnifiedExactRenderPlanWithDeferredTimingReferences(
	value: unknown,
): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value, undefined, true);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A deferred-timing unified render plan must retain canonical structure.');
	}
}

export function assertUnifiedExactRenderPlanV9(value: unknown): asserts value is UnifiedExactRenderPlanV9 {
	assertGeneration(value, 9);
}

export function assertUnifiedExactRenderPlanV10(value: unknown): asserts value is UnifiedExactRenderPlanV10 {
	assertGeneration(value, 10);
}

export function assertUnifiedExactRenderPlanV11(value: unknown): asserts value is UnifiedExactRenderPlanV11 {
	assertGeneration(value, 11);
}

export function assertUnifiedExactRenderPlanV12(value: unknown): asserts value is UnifiedExactRenderPlanV12 {
	assertGeneration(value, 12);
}

export function assertUnifiedExactRenderPlanV13(value: unknown): asserts value is UnifiedExactRenderPlanV13 {
	assertGeneration(value, 13);
}
export function assertUnifiedExactRenderPlanV14(
	value: unknown,
): asserts value is UnifiedExactRenderPlanV14 {
	assertGeneration(value, 14);
}
export function assertUnifiedExactRenderPlanV15(value: unknown): asserts value is UnifiedExactRenderPlanV15 {
	assertGeneration(value, 15);
}
export function canonicalizeUnifiedExactRenderPlan(value: unknown): string {
	assertUnifiedExactRenderPlan(value);
	return canonicalizeNativeMediaPlan(value);
}

export function canonicalizeUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): string {
	assertUnifiedExactRenderPlanWithTimingSidecars(value, timingSidecars);
	return canonicalizeNativeMediaPlan(value);
}

export function fingerprintUnifiedExactRenderPlan(value: unknown): NativeMediaPlanFingerprint {
	assertUnifiedExactRenderPlan(value);
	return fingerprintNativeMediaPlan(value);
}

export function fingerprintUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): NativeMediaPlanFingerprint {
	assertUnifiedExactRenderPlanWithTimingSidecars(value, timingSidecars);
	return fingerprintNativeMediaPlan(value);
}

function assertGeneration(value: unknown, version: UnifiedExactRenderPlanVersion): void {
	assertUnifiedExactRenderPlan(value);
	if (value.version !== version) throw new RangeError(`Expected unified exact render plan V${String(version)}.`);
}

