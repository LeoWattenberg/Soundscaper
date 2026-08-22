/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The required professional decode and encode baseline, and the admission that
 * decides whether one profile may carry one source.
 *
 * Two rules shape this module. First, every row names the fail-closed licensing
 * and provenance rows it depends on, and admission refuses a profile whose rows
 * are not cleared: capability follows evidence, never convenience. Second, a
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
	/** Every fail-closed licensing and provenance row this profile depends on. */
	readonly policyRowIds: readonly string[];
	readonly maximumBitDepth: number;
	readonly chromaFormats: readonly string[];
	readonly supportsAlpha: boolean;
	readonly preservesHdrMetadata: boolean;
	readonly lossless: boolean;
	readonly imageSequence: boolean;
	readonly longGop: boolean;
}

const CURRENT_SET = 'codec-native-ffmpeg-current-set';
const MEZZANINE = 'codec-mezzanine-and-longform';
const ADVANCED = 'codec-hevc-and-av1';
const STILLS = 'codec-image-sequence-still-formats';
const CONTAINERS = 'container-mov-mxf-matroska';

const ALL_CHROMA = VIDEO_SOURCE_V25_CHROMA_FORMATS;
const UPTO_422: readonly string[] = Object.freeze(['4:0:0', '4:2:0', '4:2:2']);
const UPTO_420: readonly string[] = Object.freeze(['4:0:0', '4:2:0']);

/**
 * The required baseline. A row's presence is a requirement, not a claim that it
 * is available: an uncleared row blocks milestone-5B exit rather than silently
 * narrowing the tier.
 */
export const NATIVE_MEDIA_PROFESSIONAL_PROFILES: readonly NativeMediaProfileV1[] = Object.freeze([
	decode('decode-h264', 'h264', 'any', [CURRENT_SET], 10, UPTO_422, false, true),
	decode('decode-hevc', 'hevc', 'any', [ADVANCED], 12, ALL_CHROMA, true, true),
	decode('decode-vp9', 'vp9', 'any', [CURRENT_SET], 12, ALL_CHROMA, true, true),
	decode('decode-av1', 'av1', 'any', [ADVANCED], 12, ALL_CHROMA, true, true),
	decode('decode-prores', 'prores', 'mov', [MEZZANINE, CONTAINERS], 12, ALL_CHROMA, true, false),
	decode('decode-dnxhr', 'dnxhr', 'mxf', [MEZZANINE, CONTAINERS], 12, ALL_CHROMA, false, false),
	sequenceDecode('decode-png-sequence', 'png', [STILLS], 16),
	sequenceDecode('decode-tiff-sequence', 'tiff', [STILLS], 16),
	sequenceDecode('decode-openexr-sequence', 'exr', [STILLS], 32),
	encode({
		id: 'encode-mp4-h264', codec: 'libx264', container: 'mp4', policyRowIds: [CURRENT_SET],
		maximumBitDepth: 8, chromaFormats: UPTO_420, longGop: true,
	}),
	encode({
		id: 'encode-webm-vp9', codec: 'libvpx-vp9', container: 'webm', policyRowIds: [CURRENT_SET],
		maximumBitDepth: 8, chromaFormats: UPTO_420, longGop: true,
	}),
	encode({
		id: 'encode-mov-prores-proxy', codec: 'prores_ks', container: 'mov',
		policyRowIds: [MEZZANINE, CONTAINERS],
		maximumBitDepth: 10, chromaFormats: UPTO_422, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-mov-prores-422-hq', codec: 'prores_ks', container: 'mov',
		policyRowIds: [MEZZANINE, CONTAINERS],
		maximumBitDepth: 10, chromaFormats: UPTO_422, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-mov-prores-4444', codec: 'prores_ks', container: 'mov',
		policyRowIds: [MEZZANINE, CONTAINERS],
		maximumBitDepth: 12, chromaFormats: ALL_CHROMA, supportsAlpha: true, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-mxf-dnxhr-hqx', codec: 'dnxhd', container: 'mxf',
		policyRowIds: [MEZZANINE, CONTAINERS],
		maximumBitDepth: 12, chromaFormats: UPTO_422, preservesHdrMetadata: true,
	}),
	encode({
		id: 'encode-matroska-ffv1', codec: 'ffv1', container: 'matroska',
		policyRowIds: [MEZZANINE, CONTAINERS],
		maximumBitDepth: 16, chromaFormats: ALL_CHROMA, supportsAlpha: true,
		preservesHdrMetadata: true, lossless: true,
	}),
	sequenceEncode('encode-png-sequence', 'png', [STILLS], 16),
	sequenceEncode('encode-tiff-sequence', 'tiff', [STILLS], 16),
	sequenceEncode('encode-openexr-sequence', 'exr', [STILLS], 32),
]);

/** Every distinct licensing row the required baseline depends on. */
export const NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS: readonly string[] = Object.freeze([
	...new Set(NATIVE_MEDIA_PROFESSIONAL_PROFILES.flatMap((profile) => profile.policyRowIds)),
].sort());

export const NATIVE_MEDIA_PROFILE_REFUSALS = Object.freeze([
	'profile-unknown',
	'policy-row-blocked',
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
	/** Licensing rows whose review is recorded as cleared. Empty by default. */
	readonly clearedPolicyRowIds?: readonly string[];
}

export interface NativeMediaProfileAdmissionVerdictV1 {
	readonly admitted: boolean;
	readonly profileId: string;
	readonly refusals: readonly NativeMediaProfileRefusal[];
	readonly disclosures: readonly NativeMediaProfileDisclosure[];
	readonly blockedPolicyRowIds: readonly string[];
}

export function nativeMediaProfile(profileId: string): NativeMediaProfileV1 | null {
	return NATIVE_MEDIA_PROFESSIONAL_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

/**
 * Decide whether one profile may carry one source.
 *
 * The licensing rows are checked first and independently of everything else: an
 * uncleared row is a refusal no measurement can overturn.
 */
export function evaluateNativeMediaProfileAdmission(
	request: NativeMediaProfileAdmissionRequestV1,
): NativeMediaProfileAdmissionVerdictV1 {
	const profile = nativeMediaProfile(request.profileId);
	if (!profile) {
		return verdict(request.profileId, ['profile-unknown'], [], []);
	}
	const cleared = new Set(request.clearedPolicyRowIds ?? []);
	const blockedPolicyRowIds = profile.policyRowIds.filter((rowId) => !cleared.has(rowId));
	const refusals: NativeMediaProfileRefusal[] = [];
	const disclosures: NativeMediaProfileDisclosure[] = [];
	if (blockedPolicyRowIds.length > 0) refusals.push('policy-row-blocked');

	const requirements = request.requirements ?? {};
	const source = request.source;
	appraiseBitDepth(profile, source, requirements, refusals, disclosures);
	appraiseChroma(profile, source, requirements, refusals, disclosures);
	appraiseHdr(profile, source, requirements, refusals, disclosures);
	appraiseAlpha(profile, source, requirements, refusals, disclosures);

	return verdict(profile.id, refusals, disclosures, blockedPolicyRowIds);
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
	blockedPolicyRowIds: readonly string[],
): NativeMediaProfileAdmissionVerdictV1 {
	return Object.freeze({
		admitted: refusals.length === 0,
		profileId,
		refusals: Object.freeze([...refusals]),
		disclosures: Object.freeze([...disclosures]),
		blockedPolicyRowIds: Object.freeze([...blockedPolicyRowIds]),
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
	maximumBitDepth: number,
): NativeMediaProfileV1 {
	return Object.freeze({
		...decode(id, codec, 'image-sequence', policyRowIds, maximumBitDepth, ALL_CHROMA, true, false),
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
	maximumBitDepth: number,
): NativeMediaProfileV1 {
	return encode({
		id,
		codec,
		container: 'image-sequence',
		policyRowIds,
		maximumBitDepth,
		chromaFormats: ALL_CHROMA,
		supportsAlpha: true,
		lossless: true,
		imageSequence: true,
	});
}
