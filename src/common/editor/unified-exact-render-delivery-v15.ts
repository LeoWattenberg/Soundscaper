/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed caption and image-sequence companion delivery authority for exact V15 plans. */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from './native-media-v14-native-dispatch.ts';
import {
	PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
	type PlatformImageSequenceCompanionAudioFormatV1,
} from './platform-image-sequence-companion-audio.ts';

export const FRAMESCAPER_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1 =
	PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1;

export type FramescaperImageSequenceCompanionAudioFormatV1 =
	PlatformImageSequenceCompanionAudioFormatV1;

export interface UnifiedExactRenderCaptionDeliveryV15 {
	/** V13/V14 finishing keeps captions out of the picture; V15 owns this later delivery stage. */
	readonly stage: 'post-finishing-delivery';
	readonly trackId: string;
	readonly cueSetSha256: string;
	readonly mux: null | Readonly<{
		readonly codec: 'mov_text' | 'webvtt';
		readonly documentSha256: string;
	}>;
	readonly burnIn: null | Readonly<{
		readonly planSha256: string;
		readonly fontSubsetIds: readonly string[];
		readonly alphaDisposition: 'opaque-output' | 'caption-composited';
	}>;
	readonly sidecar: null | Readonly<{
		readonly format: 'srt' | 'vtt' | 'imsc1';
		readonly documentSha256: string;
	}>;
}

export interface UnifiedExactRenderCompanionAudioV15 {
	readonly formatId: FramescaperImageSequenceCompanionAudioFormatV1;
	readonly fileName: string;
	readonly planFingerprint: string;
	readonly recoveryClass: 'atomic-restart';
}

export interface UnifiedExactRenderDeliveryV15 {
	readonly captionDelivery: UnifiedExactRenderCaptionDeliveryV15 | null;
	readonly companionAudio: UnifiedExactRenderCompanionAudioV15 | null;
}

interface DeliveryContext {
	readonly container: 'mp4' | 'webm' | 'mov' | 'mxf' | 'matroska' | 'image2';
	readonly deliveryProfile: NativeMediaV14EncodeProfileId;
	readonly includeAudio: boolean;
}

const CAPTION_FIELDS = Object.freeze([
	'stage', 'trackId', 'cueSetSha256', 'mux', 'burnIn', 'sidecar',
]);
const MUX_FIELDS = Object.freeze(['codec', 'documentSha256']);
const BURN_FIELDS = Object.freeze(['planSha256', 'fontSubsetIds', 'alphaDisposition']);
const SIDECAR_FIELDS = Object.freeze(['format', 'documentSha256']);
const COMPANION_FIELDS = Object.freeze([
	'formatId', 'fileName', 'planFingerprint', 'recoveryClass',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function normalizeUnifiedExactRenderDeliveryV15(
	captionValue: unknown,
	companionValue: unknown,
	context: DeliveryContext,
): UnifiedExactRenderDeliveryV15 {
	const captionDelivery = captionValue === null
		? null : normalizeCaptionDelivery(captionValue, context);
	const companionAudio = companionValue === null
		? null : normalizeCompanionAudio(companionValue, context);
	return Object.freeze({ captionDelivery, companionAudio });
}

export function assertUnifiedExactRenderDeliveryReferencesV15(
	delivery: UnifiedExactRenderDeliveryV15,
	captionTrackIds: ReadonlySet<string>,
): void {
	const trackId = delivery.captionDelivery?.trackId;
	if (trackId !== undefined && !captionTrackIds.has(trackId)) {
		throw new ReferenceError(`V15 caption delivery track ${trackId} is not in the exact finishing plan.`);
	}
}

/** Image sequences cannot hide programme audio merely because their picture container cannot embed it. */
export function assertUnifiedExactRenderCompanionAudioRequiredV15(
	delivery: UnifiedExactRenderDeliveryV15,
	context: Readonly<{ readonly container: DeliveryContext['container']; readonly hasProgrammeAudio: boolean }>,
): void {
	if (context.container === 'image2' && context.hasProgrammeAudio && delivery.companionAudio === null) {
		throw new RangeError('Unified V15 image-sequence delivery requires companion audio for its programme audio.');
	}
}

function normalizeCaptionDelivery(
	value: unknown,
	context: DeliveryContext,
): UnifiedExactRenderCaptionDeliveryV15 {
	const name = 'unified V15 caption delivery';
	const row = readClosedDomainRecord(value, name, CAPTION_FIELDS);
	if (field(row, 'stage', name) !== 'post-finishing-delivery') {
		throw new RangeError('Unified V15 captions require the post-finishing delivery stage.');
	}
	const mux = nullableMux(field(row, 'mux', name));
	const burnIn = nullableBurn(field(row, 'burnIn', name), context);
	const sidecar = nullableSidecar(field(row, 'sidecar', name));
	if (mux === null && burnIn === null && sidecar === null) {
		throw new RangeError('Unified V15 caption delivery must select mux, burn-in, or sidecar output.');
	}
	if (mux !== null) assertMuxContainer(mux.codec, context.container);
	if (burnIn !== null && context.deliveryProfile === 'encode-mov-prores-4444') {
		throw new RangeError('ProRes 4444 alpha delivery refuses caption burn-in because it changes authored alpha.');
	}
	return Object.freeze({
		stage: 'post-finishing-delivery' as const,
		trackId: stableId(field(row, 'trackId', name), `${name}.trackId`),
		cueSetSha256: sha256(field(row, 'cueSetSha256', name), `${name}.cueSetSha256`),
		mux, burnIn, sidecar,
	});
}

function nullableMux(value: unknown): UnifiedExactRenderCaptionDeliveryV15['mux'] {
	if (value === null) return null;
	const name = 'unified V15 caption mux';
	const row = readClosedDomainRecord(value, name, MUX_FIELDS);
	const codec = field(row, 'codec', name);
	if (codec !== 'mov_text' && codec !== 'webvtt') {
		throw new RangeError('Unified V15 caption mux codec is unsupported.');
	}
	return Object.freeze({
		codec,
		documentSha256: sha256(field(row, 'documentSha256', name), `${name}.documentSha256`),
	});
}

function nullableBurn(
	value: unknown,
	context: DeliveryContext,
): UnifiedExactRenderCaptionDeliveryV15['burnIn'] {
	if (value === null) return null;
	const name = 'unified V15 caption burn plan';
	const row = readClosedDomainRecord(value, name, BURN_FIELDS);
	const ids = readClosedDomainArray(field(row, 'fontSubsetIds', name), `${name}.fontSubsetIds`, 0, 256)
		.map((id, index) => stableId(id, `${name}.fontSubsetIds[${String(index)}]`));
	const sorted = [...ids].sort((left, right) => left.localeCompare(right));
	if (new Set(sorted).size !== sorted.length || ids.some((id, index) => id !== sorted[index])) {
		throw new RangeError('Unified V15 caption font subset IDs must be unique and sorted.');
	}
	const alphaDisposition = field(row, 'alphaDisposition', name);
	const expectedAlphaDisposition = nativeMediaV14EncodeDispatch(context.deliveryProfile).supportsAlpha
		? 'caption-composited' as const : 'opaque-output' as const;
	if (alphaDisposition !== expectedAlphaDisposition) {
		throw new RangeError(
			`Unified V15 caption burn alpha disposition must be ${expectedAlphaDisposition}.`,
		);
	}
	return Object.freeze({
		planSha256: sha256(field(row, 'planSha256', name), `${name}.planSha256`),
		fontSubsetIds: Object.freeze(sorted),
		alphaDisposition: expectedAlphaDisposition,
	});
}

function nullableSidecar(value: unknown): UnifiedExactRenderCaptionDeliveryV15['sidecar'] {
	if (value === null) return null;
	const name = 'unified V15 caption sidecar';
	const row = readClosedDomainRecord(value, name, SIDECAR_FIELDS);
	const format = field(row, 'format', name);
	if (format !== 'srt' && format !== 'vtt' && format !== 'imsc1') {
		throw new RangeError('Unified V15 caption sidecar format is unsupported.');
	}
	return Object.freeze({
		format,
		documentSha256: sha256(field(row, 'documentSha256', name), `${name}.documentSha256`),
	});
}

function normalizeCompanionAudio(
	value: unknown,
	context: DeliveryContext,
): UnifiedExactRenderCompanionAudioV15 {
	const name = 'unified V15 companion audio';
	if (context.container !== 'image2' || context.includeAudio) {
		throw new RangeError('Companion audio is available only for a non-embedded image-sequence delivery.');
	}
	const row = readClosedDomainRecord(value, name, COMPANION_FIELDS);
	const formatId = field(row, 'formatId', name);
	if (!(FRAMESCAPER_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1 as readonly unknown[]).includes(formatId)) {
		throw new RangeError('Unified V15 companion audio format is outside the closed built-in registry.');
	}
	const typedFormat = formatId as FramescaperImageSequenceCompanionAudioFormatV1;
	const fileName = field(row, 'fileName', name);
	if (fileName !== framescaperImageSequenceCompanionAudioFileNameV15(typedFormat)) {
		throw new RangeError('Unified V15 companion audio file name does not match its format.');
	}
	if (field(row, 'recoveryClass', name) !== 'atomic-restart') {
		throw new RangeError('Unified V15 companion audio must use atomic restart recovery.');
	}
	return Object.freeze({
		formatId: typedFormat,
		fileName,
		planFingerprint: sha256(field(row, 'planFingerprint', name), `${name}.planFingerprint`),
		recoveryClass: 'atomic-restart' as const,
	});
}

export function framescaperImageSequenceCompanionAudioFileNameV15(
	format: FramescaperImageSequenceCompanionAudioFormatV1,
): string {
	const extension = format === 'bwf' ? 'wav'
		: format === 'ogg-vorbis' ? 'ogg'
			: format === 'aac-m4a' ? 'm4a'
				: format;
	return `audio.${extension}`;
}

function assertMuxContainer(
	codec: UnifiedExactRenderCaptionDeliveryV15['mux'] extends infer _Mux ? 'mov_text' | 'webvtt' : never,
	container: DeliveryContext['container'],
): void {
	if ((codec === 'mov_text' && (container === 'mov' || container === 'mp4'))
		|| (codec === 'webvtt' && container === 'webm')) return;
	throw new RangeError(`Caption codec ${codec} cannot be muxed into ${container}.`);
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function sha256(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}
