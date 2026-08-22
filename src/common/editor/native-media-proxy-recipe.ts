/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The native proxy recipe: ProRes Proxy in MOV, at most 1280×720, preserving
 * aspect ratio and exact source timing.
 *
 * This completes the existing proxy relationship rather than starting a second
 * one. The generated body still flows through the established content-addressed
 * staging, claim, attachment, cleanup, and reattestation lifecycle, and the
 * attachment still records the generator and recipe identity that make a stale
 * proxy detectable. What is new here is only the recipe itself and the gate in
 * front of it.
 *
 * The gate matters more than the geometry. If the ProRes licensing row is not
 * cleared, proxy generation is *blocked* — it does not quietly fall back to
 * H.264 or VP9. A substituted codec would change decode behaviour, colour
 * handling, and frame boundaries under a user who asked for a proxy and was
 * told they got one.
 *
 * Timing is preserved exactly: a proxy that resamples to a friendlier frame
 * rate stops being a stand-in for its original, and every edit made against it
 * would land somewhere else on the original.
 */

import {
	evaluateNativeMediaProfileAdmission,
	nativeMediaProfile,
	type NativeMediaProfileV1,
} from './native-media-professional-profiles.ts';
import {
	createUnreportedVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from './video-source-professional-characteristics-v25.ts';

export const NATIVE_MEDIA_PROXY_RECIPE_ID = 'framescaper-native-prores-proxy-mov-v1';
export const NATIVE_MEDIA_PROXY_RECIPE_VERSION = 1;
export const NATIVE_MEDIA_PROXY_PROFILE_ID = 'encode-mov-prores-proxy';
export const NATIVE_MEDIA_PROXY_MAXIMUM_WIDTH = 1_280;
export const NATIVE_MEDIA_PROXY_MAXIMUM_HEIGHT = 720;
export const NATIVE_MEDIA_PROXY_MIME_TYPE = 'video/quicktime';
export const NATIVE_MEDIA_PROXY_AUDIO_POLICY = 'ignore-proxy-container-audio-v1';
export const NATIVE_MEDIA_PROXY_TIMING_RULE = 'exact-presentation-boundaries-v1';
/** Encoded outputs restart from zero; a partial proxy is never resumed. */
export const NATIVE_MEDIA_PROXY_RECOVERY_CLASS = 'atomic-restart';

export const NATIVE_MEDIA_PROXY_REFUSALS = Object.freeze([
	'prores-gate-blocked',
	'source-geometry-unreported',
	'source-geometry-unusable',
] as const);

export type NativeMediaProxyRefusal = (typeof NATIVE_MEDIA_PROXY_REFUSALS)[number];

export interface NativeMediaProxyGeometryV1 {
	readonly width: number;
	readonly height: number;
	readonly scaled: boolean;
}

export interface NativeMediaProxyRecipeV1 {
	readonly recipeId: typeof NATIVE_MEDIA_PROXY_RECIPE_ID;
	readonly recipeVersion: typeof NATIVE_MEDIA_PROXY_RECIPE_VERSION;
	readonly profileId: typeof NATIVE_MEDIA_PROXY_PROFILE_ID;
	readonly container: 'mov';
	readonly codec: string;
	readonly mimeType: typeof NATIVE_MEDIA_PROXY_MIME_TYPE;
	readonly geometry: NativeMediaProxyGeometryV1;
	readonly timingRule: typeof NATIVE_MEDIA_PROXY_TIMING_RULE;
	readonly audioPolicy: typeof NATIVE_MEDIA_PROXY_AUDIO_POLICY;
	readonly recoveryClass: typeof NATIVE_MEDIA_PROXY_RECOVERY_CLASS;
}

export interface NativeMediaProxyPlanRequestV1 {
	/** The original's presented geometry, as probing established it. */
	readonly sourceWidth: number | null;
	readonly sourceHeight: number | null;
	readonly sourceCharacteristics?: VideoSourceCharacteristicsV25;
	readonly clearedPolicyRowIds?: readonly string[];
}

export type NativeMediaProxyPlanV1 =
	| Readonly<{ readonly blocked: false; readonly recipe: NativeMediaProxyRecipeV1 }>
	| Readonly<{
		readonly blocked: true;
		readonly refusals: readonly NativeMediaProxyRefusal[];
		readonly blockedPolicyRowIds: readonly string[];
	}>;

export class NativeMediaProxyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeMediaProxyError';
	}
}

/**
 * Fit an original's presented geometry into the proxy ceiling.
 *
 * The proxy never upscales — a proxy larger than its original costs decode time
 * and buys nothing — and both axes stay even so every conforming encoder can
 * take the frame without adjusting it behind the plan's back.
 */
export function resolveNativeMediaProxyGeometry(
	width: number,
	height: number,
): NativeMediaProxyGeometryV1 {
	const sourceWidth = positiveInteger(width, 'width');
	const sourceHeight = positiveInteger(height, 'height');
	const scale = Math.min(
		1,
		NATIVE_MEDIA_PROXY_MAXIMUM_WIDTH / sourceWidth,
		NATIVE_MEDIA_PROXY_MAXIMUM_HEIGHT / sourceHeight,
	);
	const scaledWidth = evenFloor(sourceWidth * scale);
	const scaledHeight = evenFloor(sourceHeight * scale);
	if (scaledWidth < 2 || scaledHeight < 2) {
		throw new NativeMediaProxyError('A proxy cannot preserve this aspect ratio at an even frame size.');
	}
	return Object.freeze({
		width: scaledWidth,
		height: scaledHeight,
		scaled: scaledWidth !== sourceWidth || scaledHeight !== sourceHeight,
	});
}

/**
 * Plan one proxy, or state exactly why generation is blocked.
 *
 * A blocked plan is a refusal, never a substitution: the only proxy this tier
 * knows how to make is the documented one.
 */
export function planNativeMediaProxy(
	request: NativeMediaProxyPlanRequestV1,
): NativeMediaProxyPlanV1 {
	const profile = nativeMediaProfile(NATIVE_MEDIA_PROXY_PROFILE_ID);
	if (!profile) {
		throw new NativeMediaProxyError('The proxy profile is missing from the professional baseline.');
	}
	const admission = evaluateNativeMediaProfileAdmission({
		profileId: NATIVE_MEDIA_PROXY_PROFILE_ID,
		source: request.sourceCharacteristics
			?? createUnreportedVideoSourceCharacteristicsV25(),
		clearedPolicyRowIds: request.clearedPolicyRowIds ?? [],
	});
	const refusals: NativeMediaProxyRefusal[] = [];
	if (admission.blockedPolicyRowIds.length > 0) refusals.push('prores-gate-blocked');
	if (request.sourceWidth === null || request.sourceHeight === null) {
		refusals.push('source-geometry-unreported');
		return blocked(refusals, admission.blockedPolicyRowIds);
	}
	let geometry: NativeMediaProxyGeometryV1;
	try {
		geometry = resolveNativeMediaProxyGeometry(request.sourceWidth, request.sourceHeight);
	} catch {
		refusals.push('source-geometry-unusable');
		return blocked(refusals, admission.blockedPolicyRowIds);
	}
	if (refusals.length > 0) return blocked(refusals, admission.blockedPolicyRowIds);
	return Object.freeze({ blocked: false, recipe: recipe(profile, geometry) });
}

/**
 * The original is always the export authority. A proxy accelerates preview and
 * editing; consuming one as the export source would ship the downscaled,
 * re-encoded stand-in as if it were the master.
 */
export function assertNativeMediaExportSourceIsOriginal(role: unknown): void {
	if (role !== 'original') {
		throw new NativeMediaProxyError('An export consumes the original source; a proxy is never its authority.');
	}
}

function recipe(
	profile: NativeMediaProfileV1,
	geometry: NativeMediaProxyGeometryV1,
): NativeMediaProxyRecipeV1 {
	return Object.freeze({
		recipeId: NATIVE_MEDIA_PROXY_RECIPE_ID,
		recipeVersion: NATIVE_MEDIA_PROXY_RECIPE_VERSION,
		profileId: NATIVE_MEDIA_PROXY_PROFILE_ID,
		container: 'mov',
		codec: profile.codec,
		mimeType: NATIVE_MEDIA_PROXY_MIME_TYPE,
		geometry,
		timingRule: NATIVE_MEDIA_PROXY_TIMING_RULE,
		audioPolicy: NATIVE_MEDIA_PROXY_AUDIO_POLICY,
		recoveryClass: NATIVE_MEDIA_PROXY_RECOVERY_CLASS,
	});
}

function blocked(
	refusals: readonly NativeMediaProxyRefusal[],
	blockedPolicyRowIds: readonly string[],
): NativeMediaProxyPlanV1 {
	return Object.freeze({
		blocked: true,
		refusals: Object.freeze([...refusals]),
		blockedPolicyRowIds: Object.freeze([...blockedPolicyRowIds]),
	});
}

function evenFloor(value: number): number {
	return Math.max(0, Math.floor(value / 2) * 2);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new NativeMediaProxyError(`A proxy source ${label} must be a positive safe integer.`);
	}
	return value as number;
}
