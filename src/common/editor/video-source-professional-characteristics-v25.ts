/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * V25's versioned extension of the existing source-characteristics record.
 *
 * This is deliberately not a second `professionalCharacteristics` object. The
 * facts the native probe establishes extend the same exact-or-unreported record
 * every video source already owns. Earlier exact schemas continue to use the
 * smaller record from `video-source-characteristics.ts`; V25 validates this
 * larger closed form without changing those historical wire shapes.
 */

import {
	createUnreportedVideoSourceCharacteristics,
	normalizeVideoSourceCharacteristics,
	videoSourceCharacteristicsAreReported,
	type VideoSourceCharacteristics,
	type VideoSourceCharacteristicsOptions,
	type VideoSourceColour,
} from './video-source-characteristics.ts';

export const VIDEO_SOURCE_V25_BIT_DEPTHS: readonly number[] = Object.freeze([8, 10, 12, 16, 32]);
export const VIDEO_SOURCE_V25_CHROMA_FORMATS: readonly string[] = Object.freeze([
	'4:0:0', '4:2:0', '4:2:2', '4:4:4',
]);
export const VIDEO_SOURCE_V25_ALPHA_MODES: readonly string[] = Object.freeze([
	'straight', 'premultiplied',
]);
export const VIDEO_SOURCE_V25_ALPHA_INTERPRETATIONS: readonly string[] = Object.freeze([
	'transparency', 'matte', 'unused',
]);
export const VIDEO_SOURCE_V25_PQ_TRANSFER = 'smpte2084';
export const VIDEO_SOURCE_V25_HLG_TRANSFER = 'arib-std-b67';
export const VIDEO_SOURCE_V25_SDR_TRANSFERS: readonly string[] = Object.freeze([
	'bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'linear',
	'iec61966-2-1', 'iec61966-2-4', 'bt1361e', 'bt2020-10', 'bt2020-12',
]);

export interface VideoSourceV25Rational {
	readonly num: number;
	readonly den: number;
}

export interface VideoSourceV25Chromaticity {
	readonly x: VideoSourceV25Rational;
	readonly y: VideoSourceV25Rational;
}

export interface VideoSourceV25MasteringDisplay {
	readonly redPrimary: VideoSourceV25Chromaticity;
	readonly greenPrimary: VideoSourceV25Chromaticity;
	readonly bluePrimary: VideoSourceV25Chromaticity;
	readonly whitePoint: VideoSourceV25Chromaticity;
	readonly minimumLuminance: VideoSourceV25Rational;
	readonly maximumLuminance: VideoSourceV25Rational;
}

export interface VideoSourceV25ContentLight {
	readonly maximumContentLightLevel: number;
	readonly maximumFrameAverageLightLevel: number;
}

export interface VideoSourceColourV25 extends VideoSourceColour {
	readonly masteringDisplay: VideoSourceV25MasteringDisplay | null;
	readonly contentLight: VideoSourceV25ContentLight | null;
}

/** One source record, extending the existing fields in-place for exact V25. */
export interface VideoSourceCharacteristicsV25
	extends Omit<VideoSourceCharacteristics, 'colour'> {
	readonly bitDepth: number | null;
	readonly pixelFormat: string | null;
	readonly chromaFormat: string | null;
	readonly alphaMode: string | null;
	readonly alphaInterpretation: string | null;
	readonly colour: VideoSourceColourV25;
}

export type VideoSourceV25HdrTransferClaim = 'sdr' | 'pq' | 'hlg' | 'unreported';

export interface VideoSourceV25HdrClaim {
	readonly transfer: VideoSourceV25HdrTransferClaim;
	readonly hdr10Metadata: boolean;
	readonly wideGamut: boolean;
}

export class VideoSourceProfessionalCharacteristicsV25Error extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VideoSourceProfessionalCharacteristicsV25Error';
	}
}

const BASE_KEYS = Object.freeze([
	'backend', 'codedWidth', 'codedHeight', 'rotationDegrees', 'pixelAspectRatio', 'fieldOrder',
	'hasAlpha', 'videoCodec', 'colour', 'audioStreams', 'extractedAudioStreamIndex', 'startTimecode',
]);
const PROFESSIONAL_KEYS = Object.freeze([
	'bitDepth', 'pixelFormat', 'chromaFormat', 'alphaMode', 'alphaInterpretation',
]);
const COLOUR_BASE_KEYS = Object.freeze(['primaries', 'transfer', 'matrix', 'range']);
const COLOUR_V25_KEYS = Object.freeze([...COLOUR_BASE_KEYS, 'masteringDisplay', 'contentLight']);
const MASTERING_KEYS = Object.freeze([
	'redPrimary', 'greenPrimary', 'bluePrimary', 'whitePoint',
	'minimumLuminance', 'maximumLuminance',
]);
const CONTENT_LIGHT_KEYS = Object.freeze([
	'maximumContentLightLevel', 'maximumFrameAverageLightLevel',
]);
const CHROMATICITY_KEYS = Object.freeze(['x', 'y']);
const RATIONAL_KEYS = Object.freeze(['num', 'den']);
const TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const MAXIMUM_RATIONAL_TERM = 1_000_000_000;
const MAXIMUM_LIGHT_LEVEL = 100_000;
const WIDE_GAMUT_PRIMARIES: ReadonlySet<string> = new Set(['bt2020', 'smpte431', 'smpte432']);

export function createUnreportedVideoSourceCharacteristicsV25(): VideoSourceCharacteristicsV25 {
	const base = createUnreportedVideoSourceCharacteristics();
	return Object.freeze({
		...base,
		bitDepth: null,
		pixelFormat: null,
		chromaFormat: null,
		alphaMode: null,
		alphaInterpretation: null,
		colour: Object.freeze({
			...base.colour,
			masteringDisplay: null,
			contentLight: null,
		}),
	});
}

/** Normalize the one persisted V25 source-characteristics record. */
export function normalizeVideoSourceCharacteristicsV25(
	value: unknown,
	options: VideoSourceCharacteristicsOptions = {},
): VideoSourceCharacteristicsV25 {
	if (value == null) return createUnreportedVideoSourceCharacteristicsV25();
	const candidate = record(value, 'V25 source characteristics');
	rejectUnknownKeys(candidate, [...BASE_KEYS, ...PROFESSIONAL_KEYS], 'V25 source characteristics');
	const colourInput = candidate.colour == null
		? null
		: record(candidate.colour, 'V25 source characteristics.colour');
	if (colourInput) rejectUnknownKeys(colourInput, COLOUR_V25_KEYS, 'V25 source characteristics.colour');
	const baseInput = baseProjection(candidate, colourInput);
	const base = normalizeVideoSourceCharacteristics(baseInput, options);
	const alphaMode = optionalMember(
		candidate.alphaMode, VIDEO_SOURCE_V25_ALPHA_MODES, 'alphaMode',
	) as string | null;
	const alphaInterpretation = optionalMember(
		candidate.alphaInterpretation, VIDEO_SOURCE_V25_ALPHA_INTERPRETATIONS, 'alphaInterpretation',
	) as string | null;
	if (base.hasAlpha === false && (alphaMode !== null || alphaInterpretation !== null)) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(
			'A source reported without alpha cannot carry an alpha mode or interpretation.',
		);
	}
	return Object.freeze({
		...base,
		bitDepth: optionalMember(candidate.bitDepth, VIDEO_SOURCE_V25_BIT_DEPTHS, 'bitDepth') as number | null,
		pixelFormat: optionalTag(candidate.pixelFormat, 'pixelFormat'),
		chromaFormat: optionalMember(
			candidate.chromaFormat, VIDEO_SOURCE_V25_CHROMA_FORMATS, 'chromaFormat',
		) as string | null,
		alphaMode,
		alphaInterpretation,
		colour: Object.freeze({
			...base.colour,
			masteringDisplay: normalizeMasteringDisplay(colourInput?.masteringDisplay),
			contentLight: normalizeContentLight(colourInput?.contentLight),
		}),
	});
}

export function videoSourceCharacteristicsV25AreReported(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const colour = candidate.colour as Record<string, unknown> | null | undefined;
	return videoSourceCharacteristicsAreReported(value)
		|| PROFESSIONAL_KEYS.some((key) => candidate[key] != null)
		|| Boolean(colour && (colour.masteringDisplay != null || colour.contentLight != null));
}

export function resolveVideoSourceHdrClaimV25(
	characteristics: VideoSourceCharacteristicsV25,
): VideoSourceV25HdrClaim {
	const transfer = hdrTransferClaim(characteristics.colour.transfer);
	return Object.freeze({
		transfer,
		hdr10Metadata: characteristics.colour.masteringDisplay !== null
			&& characteristics.colour.contentLight !== null,
		wideGamut: (transfer === 'pq' || transfer === 'hlg')
			&& characteristics.colour.primaries !== null
			&& WIDE_GAMUT_PRIMARIES.has(characteristics.colour.primaries),
	});
}

function baseProjection(
	candidate: Record<string, unknown>,
	colour: Record<string, unknown> | null,
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const key of BASE_KEYS) {
		if (key !== 'colour' && Object.hasOwn(candidate, key)) output[key] = candidate[key];
	}
	if (colour !== null) {
		output.colour = Object.fromEntries(COLOUR_BASE_KEYS
			.filter((key) => Object.hasOwn(colour, key))
			.map((key) => [key, colour[key]]));
	}
	return output;
}

function hdrTransferClaim(value: string | null): VideoSourceV25HdrTransferClaim {
	if (value === null) return 'unreported';
	if (value === VIDEO_SOURCE_V25_PQ_TRANSFER) return 'pq';
	if (value === VIDEO_SOURCE_V25_HLG_TRANSFER) return 'hlg';
	return VIDEO_SOURCE_V25_SDR_TRANSFERS.includes(value) ? 'sdr' : 'unreported';
}

function normalizeMasteringDisplay(value: unknown): VideoSourceV25MasteringDisplay | null {
	if (value == null) return null;
	const candidate = record(value, 'masteringDisplay');
	rejectUnknownKeys(candidate, MASTERING_KEYS, 'masteringDisplay');
	if (MASTERING_KEYS.some((key) => candidate[key] == null)) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(
			'Mastering-display metadata is reported whole or not at all.',
		);
	}
	const minimumLuminance = rational(candidate.minimumLuminance, 'masteringDisplay.minimumLuminance');
	const maximumLuminance = rational(candidate.maximumLuminance, 'masteringDisplay.maximumLuminance');
	if (rationalExceeds(minimumLuminance, maximumLuminance)) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(
			'Mastering-display minimum luminance exceeds its maximum.',
		);
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

function normalizeContentLight(value: unknown): VideoSourceV25ContentLight | null {
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
		throw new VideoSourceProfessionalCharacteristicsV25Error(
			'Frame-average light level cannot exceed the maximum content light level.',
		);
	}
	return Object.freeze({ maximumContentLightLevel, maximumFrameAverageLightLevel });
}

function chromaticity(value: unknown, name: string): VideoSourceV25Chromaticity {
	const candidate = record(value, name);
	rejectUnknownKeys(candidate, CHROMATICITY_KEYS, name);
	return Object.freeze({ x: rational(candidate.x, `${name}.x`), y: rational(candidate.y, `${name}.y`) });
}

function rational(value: unknown, name: string): VideoSourceV25Rational {
	const candidate = record(value, name);
	rejectUnknownKeys(candidate, RATIONAL_KEYS, name);
	const num = candidate.num;
	const den = candidate.den;
	if (!Number.isSafeInteger(num) || Number(num) < 0 || Number(num) > MAXIMUM_RATIONAL_TERM
		|| !Number.isSafeInteger(den) || Number(den) <= 0 || Number(den) > MAXIMUM_RATIONAL_TERM) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} must be a bounded rational.`);
	}
	return Object.freeze({ num: Number(num), den: Number(den) });
}

function rationalExceeds(left: VideoSourceV25Rational, right: VideoSourceV25Rational): boolean {
	return BigInt(left.num) * BigInt(right.den) > BigInt(right.num) * BigInt(left.den);
}

function lightLevel(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAXIMUM_LIGHT_LEVEL) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} must be a bounded light level.`);
	}
	return Number(value);
}

function optionalTag(value: unknown, name: string): string | null {
	if (value == null) return null;
	if (typeof value !== 'string' || !TAG.test(value)) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} must be a bounded probe tag.`);
	}
	return value;
}

function optionalMember(
	value: unknown,
	allowed: readonly (number | string)[],
	name: string,
): number | string | null {
	if (value == null) return null;
	if (!allowed.includes(value as number | string)) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} is unsupported.`);
	}
	return value as number | string;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} must be a plain record.`);
	}
	const snapshot = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} carries a symbol field.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new VideoSourceProfessionalCharacteristicsV25Error(
				`${name}.${key} must be an own enumerable data property.`,
			);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function rejectUnknownKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	name: string,
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			throw new VideoSourceProfessionalCharacteristicsV25Error(`${name} carries unsupported key ${key}.`);
		}
	}
}
