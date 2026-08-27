/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The required professional decode and encode baseline, and the admission that
 * decides whether one profile may carry one source.
 *
 * Two rules shape this module. First, every profile names the licensing and
 * provenance rows milestone 9 must clear before stable 1.0, while pending human
 * review never disables an implemented build or test path. Second, a
 * profile that cannot preserve a *required* bit depth, chroma, HDR metadata, or
 * alpha is refused before any work begins, rather than flattening the output
 * and relabelling it as if nothing was lost.
 *
 * Losing something the caller did not require is legitimate — delivering a
 * 4:4:4 master as 4:2:0 H.264 is the normal case — but it is never silent. Each
 * such loss, and each fact probing failed to establish, comes back as an
 * explicit disclosure so that "the alpha was dropped" can never become
 * something the user finds out from the finished file.
 */

import {
	VIDEO_SOURCE_V25_CHROMA_FORMATS,
	resolveVideoSourceHdrClaimV25,
	type VideoSourceCharacteristicsV25,
} from './video-source-professional-characteristics-v25.ts';

export type NativeMediaProfileOperation = 'decode' | 'encode';

export interface NativeMediaProfileV1 {
	readonly id: string;
	readonly operation: NativeMediaProfileOperation;
	readonly codec: string;
	readonly container: string;
	/** Every licensing and provenance row stable 1.0 release review must clear. */
	readonly policyRowIds: readonly string[];
	readonly maximumBitDepth: number;
	readonly chromaFormats: readonly string[];
	readonly supportsAlpha: boolean;
	readonly preservesHdrMetadata: boolean;
	readonly lossless: boolean;
	readonly imageSequence: boolean;
	readonly longGop: boolean;
}

export const NATIVE_MEDIA_FFMPEG_POLICY_ROW_ID = 'codec-native-ffmpeg-current-set';
const CURRENT_SET = NATIVE_MEDIA_FFMPEG_POLICY_ROW_ID;
const H264_DECODE = Object.freeze(['codec-decode-h264-mp4', 'codec-decode-h264-mov']);
const HEVC_DECODE = Object.freeze(['codec-decode-hevc-mp4', 'codec-decode-hevc-mov']);
const VP9_DECODE = Object.freeze(['codec-decode-vp9-webm']);
const AV1_DECODE = Object.freeze(['codec-decode-av1-mp4', 'codec-decode-av1-webm']);

export const NATIVE_MEDIA_IMAGE_SEQUENCE_DECODE_POLICY_ROW_IDS: readonly string[] = Object.freeze([
	CURRENT_SET,
	'codec-decode-png-image-sequence',
	'codec-decode-tiff-image-sequence',
	'codec-decode-openexr-image-sequence',
]);

/** Selected sequence decode/export currently crosses one authenticated RGBA8 carrier. */
export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH = 8;

const ALL_CHROMA = VIDEO_SOURCE_V25_CHROMA_FORMATS;
const UPTO_422: readonly string[] = Object.freeze(['4:0:0', '4:2:0', '4:2:2']);
const UPTO_420: readonly string[] = Object.freeze(['4:0:0', '4:2:0']);

/**
 * The required baseline. A row's presence is a stable 1.0 release requirement,
 * not a claim that human review is already complete.
 */
export const NATIVE_MEDIA_PROFESSIONAL_PROFILES: readonly NativeMediaProfileV1[] = Object.freeze([
	decode('decode-h264', 'h264', 'any', rows(...H264_DECODE), 10, UPTO_422, false, true),
	decode('decode-hevc', 'hevc', 'any', rows(...HEVC_DECODE), 12, ALL_CHROMA, true, true),
	decode('decode-vp9', 'vp9', 'any', rows(...VP9_DECODE), 12, ALL_CHROMA, true, true),
	decode('decode-av1', 'av1', 'any', rows(...AV1_DECODE), 12, ALL_CHROMA, true, true),
	decode('decode-prores', 'prores', 'mov', rows('codec-decode-prores-mov'), 12, ALL_CHROMA, true, false),
	decode('decode-dnxhr', 'dnxhr', 'mxf', rows('codec-decode-dnxhr-mxf'), 12, ALL_CHROMA, false, false),
	sequenceDecode('decode-png-sequence', 'png', rows('codec-decode-png-image-sequence')),
	sequenceDecode('decode-tiff-sequence', 'tiff', rows('codec-decode-tiff-image-sequence')),
	sequenceDecode('decode-openexr-sequence', 'exr', rows('codec-decode-openexr-image-sequence')),
	encode({
		id: 'encode-mp4-h264', codec: 'libx264', container: 'mp4',
		policyRowIds: rows('codec-encode-h264-mp4'),
		maximumBitDepth: 8, chromaFormats: UPTO_420, longGop: true,
	}),
	encode({
		id: 'encode-hevc-main10-hdr10', codec: 'libx265', container: 'mp4',
		policyRowIds: rows('codec-encode-hevc-mp4-main10-hdr10'),
		maximumBitDepth: 10, chromaFormats: UPTO_420,
		preservesHdrMetadata: true, longGop: true,
	}),
	encode({
		id: 'encode-hevc-main10-sdr', codec: 'libx265', container: 'mp4',
		policyRowIds: rows('codec-encode-hevc-mp4-main10-sdr'),
		maximumBitDepth: 10, chromaFormats: UPTO_420,
		preservesHdrMetadata: false, longGop: true,
	}),
	encode({
		id: 'encode-webm-vp9', codec: 'libvpx-vp9', container: 'webm',
		policyRowIds: rows('codec-encode-vp9-webm'),
		maximumBitDepth: 8, chromaFormats: UPTO_420, longGop: true,
	}),
	encode({
		id: 'encode-mov-prores-proxy', codec: 'prores_ks', container: 'mov',
		policyRowIds: rows('codec-encode-prores-mov-proxy'),
		maximumBitDepth: 10, chromaFormats: UPTO_422, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-mov-prores-422-hq', codec: 'prores_ks', container: 'mov',
		policyRowIds: rows('codec-encode-prores-mov-422-hq'),
		maximumBitDepth: 10, chromaFormats: UPTO_422, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-mov-prores-4444', codec: 'prores_ks', container: 'mov',
		policyRowIds: rows('codec-encode-prores-mov-4444'),
		maximumBitDepth: 12, chromaFormats: ALL_CHROMA, supportsAlpha: true, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-mxf-dnxhr-hqx', codec: 'dnxhd', container: 'mxf',
		policyRowIds: rows('codec-encode-dnxhr-mxf-hqx'),
		maximumBitDepth: 12, chromaFormats: UPTO_422, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-matroska-ffv1', codec: 'ffv1', container: 'matroska',
		policyRowIds: rows('codec-encode-ffv1-matroska'),
		maximumBitDepth: 16, chromaFormats: ALL_CHROMA, supportsAlpha: true,
		preservesHdrMetadata: true, lossless: true,
	}),
	sequenceEncode('encode-png-sequence', 'png', rows('codec-encode-png-image-sequence')),
	sequenceEncode('encode-tiff-sequence', 'tiff', rows('codec-encode-tiff-image-sequence')),
	sequenceEncode('encode-openexr-sequence', 'exr', rows('codec-encode-openexr-image-sequence')),
]);

function rows(...exactRowIds: readonly string[]): readonly string[] {
	return Object.freeze([CURRENT_SET, ...exactRowIds]);
}

/** Every distinct licensing row the required baseline depends on. */
export const NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS: readonly string[] = Object.freeze([
	...new Set(NATIVE_MEDIA_PROFESSIONAL_PROFILES.flatMap((profile) => profile.policyRowIds)),
].sort());

export const NATIVE_MEDIA_PROFILE_REFUSALS = Object.freeze([
	'profile-unknown',
	'bit-depth-not-preserved',
	'chroma-not-preserved',
	'hdr-metadata-not-preserved',
	'alpha-not-preserved',
] as const);

export type NativeMediaProfileRefusal = (typeof NATIVE_MEDIA_PROFILE_REFUSALS)[number];

export const NATIVE_MEDIA_PROFILE_DISCLOSURES = Object.freeze([
	'bit-depth-unreported',
	'chroma-unreported',
	'transfer-unreported',
	'alpha-presence-unreported',
	'bit-depth-reduced',
	'chroma-subsampled',
	'hdr-metadata-dropped',
	'alpha-dropped',
] as const);

export type NativeMediaProfileDisclosure = (typeof NATIVE_MEDIA_PROFILE_DISCLOSURES)[number];

export interface NativeMediaProfileRequirementsV1 {
	readonly preserveBitDepth?: boolean;
	readonly preserveChroma?: boolean;
	readonly preserveHdrMetadata?: boolean;
	readonly preserveAlpha?: boolean;
}

export interface NativeMediaProfileAdmissionRequestV1 {
	readonly profileId: string;
	readonly source: VideoSourceCharacteristicsV25;
	readonly requirements?: NativeMediaProfileRequirementsV1;
	/** Stable 1.0 release rows whose milestone-9 review is recorded as cleared. */
	readonly clearedPolicyRowIds?: readonly string[];
}

export interface NativeMediaProfileAdmissionVerdictV1 {
	readonly admitted: boolean;
	readonly profileId: string;
	readonly refusals: readonly NativeMediaProfileRefusal[];
	readonly disclosures: readonly NativeMediaProfileDisclosure[];
	/** Pending human review reported to milestone 9; never an execution refusal. */
	readonly pendingReleasePolicyRowIds: readonly string[];
}

export function nativeMediaProfile(profileId: string): NativeMediaProfileV1 | null {
	return NATIVE_MEDIA_PROFESSIONAL_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

/**
 * Decide whether one profile may carry one source.
 *
 * Human licensing rows are reported independently for milestone 9. Machine-
 * verifiable preservation requirements remain the only execution refusals.
 */
export function evaluateNativeMediaProfileAdmission(
	request: NativeMediaProfileAdmissionRequestV1,
): NativeMediaProfileAdmissionVerdictV1 {
	const profile = nativeMediaProfile(request.profileId);
	if (!profile) {
		return verdict(request.profileId, ['profile-unknown'], [], []);
	}
	const cleared = new Set(request.clearedPolicyRowIds ?? []);
	const pendingReleasePolicyRowIds = profile.policyRowIds.filter((rowId) => !cleared.has(rowId));
	const refusals: NativeMediaProfileRefusal[] = [];
	const disclosures: NativeMediaProfileDisclosure[] = [];

	const requirements = request.requirements ?? {};
	const source = request.source;
	appraiseBitDepth(profile, source, requirements, refusals, disclosures);
	appraiseChroma(profile, source, requirements, refusals, disclosures);
	appraiseHdr(profile, source, requirements, refusals, disclosures);
	appraiseAlpha(profile, source, requirements, refusals, disclosures);

	return verdict(profile.id, refusals, disclosures, pendingReleasePolicyRowIds);
}

function appraiseBitDepth(
	profile: NativeMediaProfileV1,
	source: VideoSourceCharacteristicsV25,
	requirements: NativeMediaProfileRequirementsV1,
	refusals: NativeMediaProfileRefusal[],
	disclosures: NativeMediaProfileDisclosure[],
): void {
	if (source.bitDepth === null) {
		if (requirements.preserveBitDepth === true) refusals.push('bit-depth-not-preserved');
		disclosures.push('bit-depth-unreported');
		return;
	}
	if (source.bitDepth <= profile.maximumBitDepth) return;
	if (requirements.preserveBitDepth === true) refusals.push('bit-depth-not-preserved');
	else disclosures.push('bit-depth-reduced');
}

function appraiseChroma(
	profile: NativeMediaProfileV1,
	source: VideoSourceCharacteristicsV25,
	requirements: NativeMediaProfileRequirementsV1,
	refusals: NativeMediaProfileRefusal[],
	disclosures: NativeMediaProfileDisclosure[],
): void {
	if (source.chromaFormat === null) {
		if (requirements.preserveChroma === true) refusals.push('chroma-not-preserved');
		disclosures.push('chroma-unreported');
		return;
	}
	if (profile.chromaFormats.includes(source.chromaFormat)) return;
	if (requirements.preserveChroma === true) refusals.push('chroma-not-preserved');
	else disclosures.push('chroma-subsampled');
}

function appraiseHdr(
	profile: NativeMediaProfileV1,
	source: VideoSourceCharacteristicsV25,
	requirements: NativeMediaProfileRequirementsV1,
	refusals: NativeMediaProfileRefusal[],
	disclosures: NativeMediaProfileDisclosure[],
): void {
	const claim = resolveVideoSourceHdrClaimV25(source);
	const unreportedTransfer = claim.transfer === 'unreported';
	if (unreportedTransfer) disclosures.push('transfer-unreported');
	const carriesHdr = claim.hdr10Metadata || claim.transfer === 'pq' || claim.transfer === 'hlg';
	const dropped = carriesHdr && !profile.preservesHdrMetadata;
	if (!unreportedTransfer && !dropped) return;
	if (requirements.preserveHdrMetadata === true) refusals.push('hdr-metadata-not-preserved');
	else if (dropped) disclosures.push('hdr-metadata-dropped');
}

function appraiseAlpha(
	profile: NativeMediaProfileV1,
	source: VideoSourceCharacteristicsV25,
	requirements: NativeMediaProfileRequirementsV1,
	refusals: NativeMediaProfileRefusal[],
	disclosures: NativeMediaProfileDisclosure[],
): void {
	if (source.hasAlpha === null) {
		if (requirements.preserveAlpha === true) refusals.push('alpha-not-preserved');
		if (!profile.supportsAlpha) disclosures.push('alpha-presence-unreported');
		return;
	}
	if (!source.hasAlpha || profile.supportsAlpha) return;
	if (requirements.preserveAlpha === true) refusals.push('alpha-not-preserved');
	else disclosures.push('alpha-dropped');
}

function verdict(
	profileId: string,
	refusals: readonly NativeMediaProfileRefusal[],
	disclosures: readonly NativeMediaProfileDisclosure[],
	pendingReleasePolicyRowIds: readonly string[],
): NativeMediaProfileAdmissionVerdictV1 {
	return Object.freeze({
		admitted: refusals.length === 0,
		profileId,
		refusals: Object.freeze([...refusals]),
		disclosures: Object.freeze([...disclosures]),
		pendingReleasePolicyRowIds: Object.freeze([...pendingReleasePolicyRowIds]),
	});
}

function decode(
	id: string,
	codec: string,
	container: string,
	policyRowIds: readonly string[],
	maximumBitDepth: number,
	chromaFormats: readonly string[],
	supportsAlpha: boolean,
	longGop: boolean,
): NativeMediaProfileV1 {
	return Object.freeze({
		id,
		operation: 'decode',
		codec,
		container,
		policyRowIds: Object.freeze([...policyRowIds]),
		maximumBitDepth,
		chromaFormats: Object.freeze([...chromaFormats]),
		supportsAlpha,
		preservesHdrMetadata: true,
		lossless: false,
		imageSequence: false,
		longGop,
	});
}

function sequenceDecode(
	id: string,
	codec: string,
	policyRowIds: readonly string[],
): NativeMediaProfileV1 {
	return Object.freeze({
		...decode(
			id, codec, 'image-sequence', policyRowIds,
			NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH, ALL_CHROMA, false, false,
		),
		preservesHdrMetadata: false,
		imageSequence: true,
	});
}

function encode(input: Readonly<{
	id: string;
	codec: string;
	container: string;
	policyRowIds: readonly string[];
	maximumBitDepth: number;
	chromaFormats: readonly string[];
	supportsAlpha?: boolean;
	preservesHdrMetadata?: boolean;
	lossless?: boolean;
	imageSequence?: boolean;
	longGop?: boolean;
}>): NativeMediaProfileV1 {
	return Object.freeze({
		id: input.id,
		operation: 'encode',
		codec: input.codec,
		container: input.container,
		policyRowIds: Object.freeze([...input.policyRowIds]),
		maximumBitDepth: input.maximumBitDepth,
		chromaFormats: Object.freeze([...input.chromaFormats]),
		supportsAlpha: input.supportsAlpha === true,
		preservesHdrMetadata: input.preservesHdrMetadata === true,
		lossless: input.lossless === true,
		imageSequence: input.imageSequence === true,
		longGop: input.longGop === true,
	});
}

function sequenceEncode(
	id: string,
	codec: string,
	policyRowIds: readonly string[],
): NativeMediaProfileV1 {
	return encode({
		id,
		codec,
		container: 'image-sequence',
		policyRowIds,
		maximumBitDepth: NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH,
		chromaFormats: ALL_CHROMA,
		supportsAlpha: true,
		lossless: true,
		imageSequence: true,
	});
}
