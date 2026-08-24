/* SPDX-License-Identifier: AGPL-3.0-only */

/** Honest admission for the current native decoder's RGBA8 SDR output contract. */

import {
	normalizeVideoSourceCharacteristicsV25,
	resolveVideoSourceHdrClaimV25,
} from './video-source-professional-characteristics-v25.ts';

export const NATIVE_IMAGE_SEQUENCE_RGBA8_REFUSAL_CODES = Object.freeze([
	'bit-depth-unreported',
	'bit-depth-exceeds-rgba8',
	'hdr-transfer-unsupported',
	'hdr-metadata-unsupported',
	'colour-unreported',
	'wide-gamut-unsupported',
	'colour-interpretation-unsupported',
	'alpha-presence-unreported',
	'alpha-decode-unsupported',
] as const);

export type NativeImageSequenceRgba8RefusalCode =
	(typeof NATIVE_IMAGE_SEQUENCE_RGBA8_REFUSAL_CODES)[number];

export class NativeImageSequenceRgba8AdmissionError extends Error {
	readonly code: NativeImageSequenceRgba8RefusalCode;

	constructor(code: NativeImageSequenceRgba8RefusalCode) {
		super(message(code));
		this.name = 'NativeImageSequenceRgba8AdmissionError';
		this.code = code;
	}
}

/** Refuse before project mutation or helper decode could silently flatten precision or HDR. */
export function assertNativeImageSequenceRgba8DecodeCompatibility(value: unknown): void {
	const source = normalizeVideoSourceCharacteristicsV25(value);
	if (source.bitDepth === null) refuse('bit-depth-unreported');
	if (source.bitDepth !== 8) refuse('bit-depth-exceeds-rgba8');
	const hdr = resolveVideoSourceHdrClaimV25(source);
	if (hdr.transfer === 'pq' || hdr.transfer === 'hlg') refuse('hdr-transfer-unsupported');
	if (hdr.hdr10Metadata || source.colour.masteringDisplay !== null
		|| source.colour.contentLight !== null) refuse('hdr-metadata-unsupported');
	if (source.colour.primaries === null || source.colour.transfer === null
		|| source.colour.matrix === null || source.colour.range === null) refuse('colour-unreported');
	if (source.colour.primaries !== null
		&& ['bt2020', 'smpte431', 'smpte432', 'display-p3'].includes(source.colour.primaries)) {
		refuse('wide-gamut-unsupported');
	}
	if (source.colour.primaries !== 'srgb'
		|| !['iec61966-2-1', 'srgb'].includes(source.colour.transfer)
		|| source.colour.matrix !== 'rgb'
		|| source.colour.range !== 'full') {
		refuse('colour-interpretation-unsupported');
	}
	if (source.hasAlpha === null) refuse('alpha-presence-unreported');
	if (source.hasAlpha === true) refuse('alpha-decode-unsupported');
}

function refuse(code: NativeImageSequenceRgba8RefusalCode): never {
	throw new NativeImageSequenceRgba8AdmissionError(code);
}

function message(code: NativeImageSequenceRgba8RefusalCode): string {
	if (code === 'bit-depth-unreported') return 'Native image-sequence RGBA8 decode requires reported 8-bit source precision.';
	if (code === 'bit-depth-exceeds-rgba8') return 'Native image-sequence RGBA8 decode cannot preserve source precision above 8-bit.';
	if (code === 'hdr-transfer-unsupported') return 'Native image-sequence RGBA8 decode cannot preserve PQ or HLG transfer.';
	if (code === 'hdr-metadata-unsupported') return 'Native image-sequence RGBA8 decode cannot preserve HDR mastering metadata.';
	if (code === 'wide-gamut-unsupported') return 'Native image-sequence RGBA8 decode cannot preserve this wide-gamut source.';
	if (code === 'colour-unreported') return 'Native image-sequence RGBA8 decode requires reported SDR colour interpretation.';
	if (code === 'colour-interpretation-unsupported') return 'Native image-sequence RGBA8 decode cannot preserve this colour interpretation.';
	if (code === 'alpha-presence-unreported') return 'Native image-sequence RGBA8 decode requires reported opaque alpha semantics.';
	return 'Native image-sequence RGBA8 decode cannot currently prove alpha preservation.';
}
