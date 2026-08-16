/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The professional-tier extension of probed source characteristics: bit depth,
 * pixel and chroma format, range, colour primaries/transfer/matrix,
 * mastering-display and content-light metadata, and alpha presence, mode, and
 * interpretation.
 *
 * The existing exact-or-unreported discipline carries over without exception.
 * An unreported transfer function is not SDR, an unreported bit depth is not
 * eight, an unreported alpha channel is not absent, and a PQ transfer without
 * ST 2086 metadata is not HDR10. Every one of those inferences would be a
 * plausible guess presented as source truth, and colour decisions made from a
 * guess are exactly the class of error that silently ruins a delivery.
 *
 * Luminance and chromaticity are kept as exact rationals rather than decimals,
 * because that is how the standards and the probe report them; rounding them
 * into floats here would make the round trip lossy for no benefit.
 */

/** Integer depths plus the two OpenEXR float depths, half (16) and full (32). */
export const NATIVE_MEDIA_BIT_DEPTHS: readonly number[] = Object.freeze([8, 10, 12, 16, 32]);

export const NATIVE_MEDIA_CHROMA_FORMATS: readonly string[] = Object.freeze([
	'4:0:0', '4:2:0', '4:2:2', '4:4:4',
]);

export const NATIVE_MEDIA_COLOUR_RANGES: readonly string[] = Object.freeze(['limited', 'full']);

export const NATIVE_MEDIA_ALPHA_MODES: readonly string[] = Object.freeze([
	'straight', 'premultiplied',
]);

export const NATIVE_MEDIA_ALPHA_INTERPRETATIONS: readonly string[] = Object.freeze([
	'transparency', 'matte', 'unused',
]);

/** Transfer tags whose meaning this tier is willing to claim. */
export const NATIVE_MEDIA_PQ_TRANSFER = 'smpte2084';
export const NATIVE_MEDIA_HLG_TRANSFER = 'arib-std-b67';
export const NATIVE_MEDIA_SDR_TRANSFERS: readonly string[] = Object.freeze([
	'bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'linear',
	'iec61966-2-1', 'iec61966-2-4', 'bt1361e', 'bt2020-10', 'bt2020-12',
]);

export type NativeMediaHdrTransferClaim = 'sdr' | 'pq' | 'hlg' | 'unreported';

export interface NativeMediaChromaticityV1 {
	readonly x: NativeMediaRationalV1;
	readonly y: NativeMediaRationalV1;
}

export interface NativeMediaRationalV1 {
	readonly num: number;
	readonly den: number;
}

export interface NativeMediaMasteringDisplayV1 {
	readonly redPrimary: NativeMediaChromaticityV1;
	readonly greenPrimary: NativeMediaChromaticityV1;
	readonly bluePrimary: NativeMediaChromaticityV1;
	readonly whitePoint: NativeMediaChromaticityV1;
	readonly minimumLuminance: NativeMediaRationalV1;
	readonly maximumLuminance: NativeMediaRationalV1;
}

export interface NativeMediaContentLightV1 {
	readonly maximumContentLightLevel: number;
	readonly maximumFrameAverageLightLevel: number;
}

export interface NativeMediaProfessionalCharacteristicsV1 {
	readonly bitDepth: number | null;
	readonly pixelFormat: string | null;
	readonly chromaFormat: string | null;
	readonly colourRange: string | null;
	readonly colourPrimaries: string | null;
	readonly colourTransfer: string | null;
	readonly colourMatrix: string | null;
	readonly masteringDisplay: NativeMediaMasteringDisplayV1 | null;
	readonly contentLight: NativeMediaContentLightV1 | null;
	readonly hasAlpha: boolean | null;
	readonly alphaMode: string | null;
	readonly alphaInterpretation: string | null;
}

export interface NativeMediaHdrClaimV1 {
	readonly transfer: NativeMediaHdrTransferClaim;
	/** ST 2086 mastering display and CTA-861.3 content light are both present. */
	readonly hdr10Metadata: boolean;
	/** True only when probing established a wide-gamut, PQ or HLG signal. */
	readonly wideGamut: boolean;
}

export class NativeMediaCharacteristicsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeMediaCharacteristicsError';
	}
}

const CHARACTERISTIC_KEYS: readonly string[] = Object.freeze([
	'bitDepth', 'pixelFormat', 'chromaFormat', 'colourRange', 'colourPrimaries',
	'colourTransfer', 'colourMatrix', 'masteringDisplay', 'contentLight',
	'hasAlpha', 'alphaMode', 'alphaInterpretation',
]);
const MASTERING_DISPLAY_KEYS: readonly string[] = Object.freeze([
	'redPrimary', 'greenPrimary', 'bluePrimary', 'whitePoint',
	'minimumLuminance', 'maximumLuminance',
]);
const CONTENT_LIGHT_KEYS: readonly string[] = Object.freeze([
	'maximumContentLightLevel', 'maximumFrameAverageLightLevel',
]);
const CHROMATICITY_KEYS: readonly string[] = Object.freeze(['x', 'y']);
const RATIONAL_KEYS: readonly string[] = Object.freeze(['num', 'den']);
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const MAXIMUM_RATIONAL_TERM = 1_000_000_000;
const MAXIMUM_LIGHT_LEVEL = 100_000;
const WIDE_GAMUT_PRIMARIES: ReadonlySet<string> = new Set(['bt2020', 'smpte431', 'smpte432']);

/** The record a source carries when no backend reported any of these facts. */
export function createUnreportedNativeMediaProfessionalCharacteristics(
): NativeMediaProfessionalCharacteristicsV1 {
	return Object.freeze({
		bitDepth: null,
		pixelFormat: null,
		chromaFormat: null,
		colourRange: null,
		colourPrimaries: null,
		colourTransfer: null,
		colourMatrix: null,
		masteringDisplay: null,
		contentLight: null,
		hasAlpha: null,
		alphaMode: null,
		alphaInterpretation: null,
	});
}

/** Validate probed professional characteristics into their canonical form. */
export function normalizeNativeMediaProfessionalCharacteristics(
	value: unknown,
): NativeMediaProfessionalCharacteristicsV1 {
	if (value == null) return createUnreportedNativeMediaProfessionalCharacteristics();
	const candidate = record(value, 'professional source characteristics');
	rejectUnknownKeys(candidate, CHARACTERISTIC_KEYS, 'professional source characteristics');
	const hasAlpha = optionalBoolean(candidate.hasAlpha, 'hasAlpha');
	const alphaMode = optionalMember(candidate.alphaMode, NATIVE_MEDIA_ALPHA_MODES, 'alphaMode') as string | null;
	const alphaInterpretation = optionalMember(
		candidate.alphaInterpretation, NATIVE_MEDIA_ALPHA_INTERPRETATIONS, 'alphaInterpretation',
	) as string | null;
	if (hasAlpha === false && (alphaMode !== null || alphaInterpretation !== null)) {
		throw new NativeMediaCharacteristicsError(
			'A source reported without an alpha channel cannot also report an alpha mode or interpretation.',
		);
	}
	return Object.freeze({
		bitDepth: optionalMember(candidate.bitDepth, NATIVE_MEDIA_BIT_DEPTHS, 'bitDepth') as number | null,
		pixelFormat: optionalTag(candidate.pixelFormat, 'pixelFormat'),
		chromaFormat: optionalMember(candidate.chromaFormat, NATIVE_MEDIA_CHROMA_FORMATS, 'chromaFormat') as string | null,
		colourRange: optionalMember(candidate.colourRange, NATIVE_MEDIA_COLOUR_RANGES, 'colourRange') as string | null,
		colourPrimaries: optionalTag(candidate.colourPrimaries, 'colourPrimaries'),
		colourTransfer: optionalTag(candidate.colourTransfer, 'colourTransfer'),
		colourMatrix: optionalTag(candidate.colourMatrix, 'colourMatrix'),
		masteringDisplay: normalizeMasteringDisplay(candidate.masteringDisplay),
		contentLight: normalizeContentLight(candidate.contentLight),
		hasAlpha,
		alphaMode,
		alphaInterpretation,
	});
}

/** True when probing established anything at all about this source's colour. */
export function nativeMediaProfessionalCharacteristicsAreReported(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return CHARACTERISTIC_KEYS.some((key) => candidate[key] != null);
}

/**
 * State what probing established about the signal's dynamic range — and only
 * that. An unreported or unrecognized transfer tag stays `unreported` rather
 * than falling back to SDR, because "we do not know" and "it is SDR" lead to
 * different, non-recoverable decisions downstream.
 */
export function resolveNativeMediaHdrClaim(
	characteristics: NativeMediaProfessionalCharacteristicsV1,
): NativeMediaHdrClaimV1 {
	const transfer = hdrTransferClaim(characteristics.colourTransfer);
	const wideGamut = (transfer === 'pq' || transfer === 'hlg')
		&& characteristics.colourPrimaries !== null
		&& WIDE_GAMUT_PRIMARIES.has(characteristics.colourPrimaries);
	return Object.freeze({
		transfer,
		hdr10Metadata: characteristics.masteringDisplay !== null && characteristics.contentLight !== null,
		wideGamut,
	});
}

function hdrTransferClaim(value: string | null): NativeMediaHdrTransferClaim {
	if (value === null) return 'unreported';
	if (value === NATIVE_MEDIA_PQ_TRANSFER) return 'pq';
	if (value === NATIVE_MEDIA_HLG_TRANSFER) return 'hlg';
	return NATIVE_MEDIA_SDR_TRANSFERS.includes(value) ? 'sdr' : 'unreported';
}

function normalizeMasteringDisplay(value: unknown): NativeMediaMasteringDisplayV1 | null {
	if (value == null) return null;
	const candidate = record(value, 'masteringDisplay');
	rejectUnknownKeys(candidate, MASTERING_DISPLAY_KEYS, 'masteringDisplay');
	for (const key of MASTERING_DISPLAY_KEYS) {
		if (candidate[key] == null) {
			throw new NativeMediaCharacteristicsError(
				'Mastering-display metadata is reported whole or not at all; a partial record is not ST 2086.',
			);
		}
	}
	const minimumLuminance = rational(candidate.minimumLuminance, 'masteringDisplay.minimumLuminance');
	const maximumLuminance = rational(candidate.maximumLuminance, 'masteringDisplay.maximumLuminance');
	if (rationalExceeds(minimumLuminance, maximumLuminance)) {
		throw new NativeMediaCharacteristicsError('Mastering-display minimum luminance exceeds its maximum.');
	}
	return Object.freeze({
		redPrimary: chromaticity(candidate.redPrimary, 'masteringDisplay.redPrimary'),
		greenPrimary: chromaticity(candidate.greenPrimary, 'masteringDisplay.greenPrimary'),
		bluePrimary: chromaticity(candidate.bluePrimary, 'masteringDisplay.bluePrimary'),
		whitePoint: chromaticity(candidate.whitePoint, 'masteringDisplay.whitePoint'),
		minimumLuminance,
		maximumLuminance,
	});
}

function normalizeContentLight(value: unknown): NativeMediaContentLightV1 | null {
	if (value == null) return null;
	const candidate = record(value, 'contentLight');
	rejectUnknownKeys(candidate, CONTENT_LIGHT_KEYS, 'contentLight');
	const maximumContentLightLevel = lightLevel(
		candidate.maximumContentLightLevel, 'contentLight.maximumContentLightLevel',
	);
	const maximumFrameAverageLightLevel = lightLevel(
		candidate.maximumFrameAverageLightLevel, 'contentLight.maximumFrameAverageLightLevel',
	);
	if (maximumFrameAverageLightLevel > maximumContentLightLevel) {
		throw new NativeMediaCharacteristicsError(
			'Frame-average light level cannot exceed the maximum content light level.',
		);
	}
	return Object.freeze({ maximumContentLightLevel, maximumFrameAverageLightLevel });
}

function chromaticity(value: unknown, label: string): NativeMediaChromaticityV1 {
	const candidate = record(value, label);
	rejectUnknownKeys(candidate, CHROMATICITY_KEYS, label);
	return Object.freeze({
		x: rational(candidate.x, `${label}.x`),
		y: rational(candidate.y, `${label}.y`),
	});
}

function rational(value: unknown, label: string): NativeMediaRationalV1 {
	const candidate = record(value, label);
	rejectUnknownKeys(candidate, RATIONAL_KEYS, label);
	const num = candidate.num;
	const den = candidate.den;
	if (!Number.isSafeInteger(num) || (num as number) < 0 || (num as number) > MAXIMUM_RATIONAL_TERM
		|| !Number.isSafeInteger(den) || (den as number) <= 0 || (den as number) > MAXIMUM_RATIONAL_TERM) {
		throw new NativeMediaCharacteristicsError(`${label} must be a bounded non-negative rational.`);
	}
	return Object.freeze({ num: num as number, den: den as number });
}

/** Cross-multiplied in BigInt: bounded terms still square past the safe range. */
function rationalExceeds(left: NativeMediaRationalV1, right: NativeMediaRationalV1): boolean {
	return BigInt(left.num) * BigInt(right.den) > BigInt(right.num) * BigInt(left.den);
}

function lightLevel(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAXIMUM_LIGHT_LEVEL) {
		throw new NativeMediaCharacteristicsError(`${label} must be a bounded non-negative integer in cd/m².`);
	}
	return value as number;
}

function optionalTag(value: unknown, label: string): string | null {
	if (value == null) return null;
	if (typeof value !== 'string' || !TAG_PATTERN.test(value)) {
		throw new NativeMediaCharacteristicsError(`characteristics.${label} must be a bounded probe tag.`);
	}
	return value;
}

function optionalBoolean(value: unknown, label: string): boolean | null {
	if (value == null) return null;
	if (typeof value !== 'boolean') {
		throw new NativeMediaCharacteristicsError(`characteristics.${label} must be a boolean or null.`);
	}
	return value;
}

function optionalMember(
	value: unknown,
	members: readonly (number | string)[],
	label: string,
): number | string | null {
	if (value == null) return null;
	if (!members.includes(value as number | string)) {
		throw new NativeMediaCharacteristicsError(`characteristics.${label} must be a reported member value.`);
	}
	return value as number | string;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NativeMediaCharacteristicsError(`A ${label} record must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function rejectUnknownKeys(
	candidate: Record<string, unknown>,
	keys: readonly string[],
	label: string,
): void {
	for (const key of Object.keys(candidate)) {
		if (!keys.includes(key)) {
			throw new NativeMediaCharacteristicsError(`A ${label} record carries the unsupported key ${key}.`);
		}
	}
}
