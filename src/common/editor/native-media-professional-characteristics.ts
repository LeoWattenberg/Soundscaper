/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Compatibility names for the pre-V25 professional-media substrate.
 *
 * The persisted model now lives in the versioned extension of the existing
 * source-characteristics record. This module accepts the old flat probe shape
 * at its boundary, but returns that single integrated record; it owns no second
 * characteristics type or storage field.
 */

import {
	createUnreportedVideoSourceCharacteristicsV25,
	normalizeVideoSourceCharacteristicsV25,
	resolveVideoSourceHdrClaimV25,
	videoSourceCharacteristicsV25AreReported,
	VIDEO_SOURCE_V25_ALPHA_INTERPRETATIONS,
	VIDEO_SOURCE_V25_ALPHA_MODES,
	VIDEO_SOURCE_V25_BIT_DEPTHS,
	VIDEO_SOURCE_V25_CHROMA_FORMATS,
	VIDEO_SOURCE_V25_HLG_TRANSFER,
	VIDEO_SOURCE_V25_PQ_TRANSFER,
	VIDEO_SOURCE_V25_SDR_TRANSFERS,
	type VideoSourceCharacteristicsV25,
	type VideoSourceV25Chromaticity,
	type VideoSourceV25ContentLight,
	type VideoSourceV25HdrClaim,
	type VideoSourceV25HdrTransferClaim,
	type VideoSourceV25MasteringDisplay,
	type VideoSourceV25Rational,
} from './video-source-professional-characteristics-v25.ts';

export {
	VideoSourceProfessionalCharacteristicsV25Error as NativeMediaCharacteristicsError,
} from './video-source-professional-characteristics-v25.ts';

export const NATIVE_MEDIA_BIT_DEPTHS = VIDEO_SOURCE_V25_BIT_DEPTHS;
export const NATIVE_MEDIA_CHROMA_FORMATS = VIDEO_SOURCE_V25_CHROMA_FORMATS;
export const NATIVE_MEDIA_COLOUR_RANGES = Object.freeze(['limited', 'full']);
export const NATIVE_MEDIA_ALPHA_MODES = VIDEO_SOURCE_V25_ALPHA_MODES;
export const NATIVE_MEDIA_ALPHA_INTERPRETATIONS = VIDEO_SOURCE_V25_ALPHA_INTERPRETATIONS;
export const NATIVE_MEDIA_PQ_TRANSFER = VIDEO_SOURCE_V25_PQ_TRANSFER;
export const NATIVE_MEDIA_HLG_TRANSFER = VIDEO_SOURCE_V25_HLG_TRANSFER;
export const NATIVE_MEDIA_SDR_TRANSFERS = VIDEO_SOURCE_V25_SDR_TRANSFERS;

export type NativeMediaProfessionalCharacteristicsV1 = VideoSourceCharacteristicsV25;
export type NativeMediaChromaticityV1 = VideoSourceV25Chromaticity;
export type NativeMediaRationalV1 = VideoSourceV25Rational;
export type NativeMediaMasteringDisplayV1 = VideoSourceV25MasteringDisplay;
export type NativeMediaContentLightV1 = VideoSourceV25ContentLight;
export type NativeMediaHdrTransferClaim = VideoSourceV25HdrTransferClaim;
export type NativeMediaHdrClaimV1 = VideoSourceV25HdrClaim;

const LEGACY_KEYS = Object.freeze([
	'bitDepth', 'pixelFormat', 'chromaFormat', 'colourRange', 'colourPrimaries',
	'colourTransfer', 'colourMatrix', 'masteringDisplay', 'contentLight',
	'hasAlpha', 'alphaMode', 'alphaInterpretation',
]);

export function createUnreportedNativeMediaProfessionalCharacteristics(
): NativeMediaProfessionalCharacteristicsV1 {
	return createUnreportedVideoSourceCharacteristicsV25();
}

/** Accept the former flat probe DTO, then immediately join it to the source record. */
export function normalizeNativeMediaProfessionalCharacteristics(
	value: unknown,
): NativeMediaProfessionalCharacteristicsV1 {
	if (value == null) return createUnreportedVideoSourceCharacteristicsV25();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return normalizeVideoSourceCharacteristicsV25(value);
	}
	const candidate = value as Record<string, unknown>;
	for (const key of Object.keys(candidate)) {
		if (!LEGACY_KEYS.includes(key)) {
			throw new TypeError(`Professional source characteristics carry unsupported key ${key}.`);
		}
	}
	const colour: Record<string, unknown> = {};
	copy(candidate, colour, 'colourRange', 'range');
	copy(candidate, colour, 'colourPrimaries', 'primaries');
	copy(candidate, colour, 'colourTransfer', 'transfer');
	copy(candidate, colour, 'colourMatrix', 'matrix');
	copy(candidate, colour, 'masteringDisplay', 'masteringDisplay');
	copy(candidate, colour, 'contentLight', 'contentLight');
	const integrated: Record<string, unknown> = {};
	for (const key of [
		'bitDepth', 'pixelFormat', 'chromaFormat', 'hasAlpha', 'alphaMode', 'alphaInterpretation',
	]) {
		if (Object.hasOwn(candidate, key)) integrated[key] = candidate[key];
	}
	if (Object.keys(colour).length > 0) integrated.colour = colour;
	return normalizeVideoSourceCharacteristicsV25(integrated);
}

export function nativeMediaProfessionalCharacteristicsAreReported(value: unknown): boolean {
	return videoSourceCharacteristicsV25AreReported(value);
}

export function resolveNativeMediaHdrClaim(
	characteristics: NativeMediaProfessionalCharacteristicsV1,
): NativeMediaHdrClaimV1 {
	return resolveVideoSourceHdrClaimV25(characteristics);
}

function copy(
	from: Record<string, unknown>,
	to: Record<string, unknown>,
	fromKey: string,
	toKey: string,
): void {
	if (Object.hasOwn(from, fromKey)) to[toKey] = from[fromKey];
}
