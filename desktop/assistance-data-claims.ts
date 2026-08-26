/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Pathless, digest-bound custody records for assistance bulk data.
 *
 * A renderer may hold these records, but only main owns the backing bytes and
 * any concrete filesystem path. Job control messages carry the records; byte
 * bodies travel through a separately staged data plane.
 */

import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import { assertHelperWireEnvelope } from './helper-wire-admission.ts';

export const ASSISTANCE_DATA_CLAIM_VERSION = 1;

export const ASSISTANCE_INPUT_ROLES = Object.freeze([
	'audio',
	'video',
	'video-authority',
	'frame-pack',
	'transcript',
	'text',
	'editorial-context',
	'shot-boundaries',
	'reaction-ranges',
	'embeddings',
	'highlight-video-signals',
	'highlight-audio-signals',
	'highlight-transcript-signals',
] as const);

export const ASSISTANCE_OUTPUT_ROLES = Object.freeze([
	'voice-activity',
	'transcript',
	'word-alignment',
	'speaker-turns',
	'enhanced-audio',
	'separated-audio',
	'audio-tags',
	'beat-grid',
	'embeddings',
	'recognized-text',
	'shot-boundaries',
	'subject-tracks',
	'saliency-map',
	'editorial-proposal',
	'captions',
	'cleanup-proposals',
	'attributed-transcript',
	'reaction-ranges',
	'text-chunks',
	'transcript-index',
	'beat-labels',
	'tempo-map-diff',
	'cut-proposals',
	'frame-pack',
	'video-index',
	'tracked-subjects',
	'reframe-path',
	'highlight-signals',
	'highlight-candidates',
	'highlight-proposals',
] as const);

export type AssistanceInputRole = (typeof ASSISTANCE_INPUT_ROLES)[number];
export type AssistanceOutputRole = (typeof ASSISTANCE_OUTPUT_ROLES)[number];

export interface AssistanceStagedInputClaim {
	readonly claimVersion: typeof ASSISTANCE_DATA_CLAIM_VERSION;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: AssistanceInputRole;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AssistanceOutputReservation {
	readonly claimVersion: typeof ASSISTANCE_DATA_CLAIM_VERSION;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: AssistanceOutputRole;
	readonly mediaType: string;
	readonly maximumByteLength: number;
}

export interface AssistanceOutputClaim {
	readonly claimVersion: typeof ASSISTANCE_DATA_CLAIM_VERSION;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: AssistanceOutputRole;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

const INPUT_KEYS = Object.freeze([
	'claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256',
]);
const RESERVATION_KEYS = Object.freeze([
	'claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'maximumByteLength',
]);
const OUTPUT_KEYS = Object.freeze([
	'claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256',
]);
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MEDIA_TYPE = /^[a-z\d][a-z\d!#$&^_.+-]{0,126}\/[a-z\d][a-z\d!#$&^_.+-]{0,126}$/u;
const INPUT_MEDIA_TYPES = Object.freeze({
	audio: Object.freeze(['audio/wav', 'audio/x-wav', 'audio/flac']),
	video: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']),
	'video-authority': jsonTypes('video-authority'),
	'frame-pack': Object.freeze(['application/vnd.soundscaper.frame-pack']),
	transcript: Object.freeze(['application/json', 'application/vnd.soundscaper.transcript+json']),
	text: Object.freeze(['text/plain']),
	'editorial-context': Object.freeze([
		'application/json', 'application/vnd.soundscaper.editorial-context+json',
	]),
	'shot-boundaries': jsonTypes('shot-boundaries'),
	'reaction-ranges': jsonTypes('reaction-ranges'),
	embeddings: Object.freeze(['application/vnd.soundscaper.embedding-matrix-v1']),
	'highlight-video-signals': Object.freeze([
		'application/vnd.soundscaper.highlight-video-signals+json',
	]),
	'highlight-audio-signals': Object.freeze([
		'application/vnd.soundscaper.highlight-audio-signals+json',
	]),
	'highlight-transcript-signals': Object.freeze([
		'application/vnd.soundscaper.highlight-transcript-signals+json',
	]),
} satisfies Readonly<Record<AssistanceInputRole, readonly string[]>>);
const OUTPUT_MEDIA_TYPES = Object.freeze({
	'voice-activity': jsonTypes('voice-activity'),
	transcript: jsonTypes('transcript'),
	'word-alignment': jsonTypes('word-alignment'),
	'speaker-turns': jsonTypes('speaker-turns'),
	'enhanced-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'separated-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'audio-tags': jsonTypes('audio-tags'),
	'beat-grid': jsonTypes('beat-grid'),
	embeddings: Object.freeze([
		'application/vnd.soundscaper.embedding-matrix-v1',
	]),
	'recognized-text': jsonTypes('recognized-text'),
	'shot-boundaries': jsonTypes('shot-boundaries'),
	'subject-tracks': jsonTypes('subject-tracks'),
	'saliency-map': jsonTypes('saliency-map'),
	'editorial-proposal': jsonTypes('editorial-proposal'),
	captions: jsonTypes('captions'),
	'cleanup-proposals': jsonTypes('cleanup-proposals'),
	'attributed-transcript': jsonTypes('attributed-transcript'),
	'reaction-ranges': jsonTypes('reaction-ranges'),
	'text-chunks': jsonTypes('text-chunks'),
	'transcript-index': jsonTypes('transcript-index'),
	'beat-labels': jsonTypes('beat-labels'),
	'tempo-map-diff': jsonTypes('tempo-map-diff'),
	'cut-proposals': jsonTypes('cut-proposals'),
	'frame-pack': Object.freeze(['application/vnd.soundscaper.frame-pack']),
	'video-index': jsonTypes('video-index'),
	'tracked-subjects': jsonTypes('tracked-subjects'),
	'reframe-path': jsonTypes('reframe-path'),
	'highlight-signals': jsonTypes('highlight-signals'),
	'highlight-candidates': jsonTypes('highlight-candidates'),
	'highlight-proposals': jsonTypes('highlight-proposals'),
} satisfies Readonly<Record<AssistanceOutputRole, readonly string[]>>);

export function validateAssistanceStagedInputClaim(value: unknown): AssistanceStagedInputClaim {
	const record = claimRecord(value, INPUT_KEYS, 'An assistance staged-input claim');
	const role = enumValue(record.role, ASSISTANCE_INPUT_ROLES, 'An assistance input role is unrecognised.');
	const admittedMediaType = roleMediaType(record.mediaType, role, INPUT_MEDIA_TYPES);
	return Object.freeze({
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
		claimId: opaqueId(record.claimId, 'claim'),
		jobId: opaqueId(record.jobId, 'job'),
		role,
		mediaType: admittedMediaType,
		byteLength: byteLength(record.byteLength, 'An assistance input byte length is outside its bound.'),
		sha256: digest(record.sha256),
	});
}

export function validateAssistanceOutputReservation(value: unknown): AssistanceOutputReservation {
	const record = claimRecord(value, RESERVATION_KEYS, 'An assistance output reservation');
	const role = enumValue(record.role, ASSISTANCE_OUTPUT_ROLES, 'An assistance output role is unrecognised.');
	const admittedMediaType = roleMediaType(record.mediaType, role, OUTPUT_MEDIA_TYPES);
	return Object.freeze({
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
		claimId: opaqueId(record.claimId, 'claim'),
		jobId: opaqueId(record.jobId, 'job'),
		role,
		mediaType: admittedMediaType,
		maximumByteLength: byteLength(
			record.maximumByteLength,
			'An assistance output maximum byte length is outside its bound.',
		),
	});
}

export function validateAssistanceOutputClaim(
	value: unknown,
	reservationValue?: unknown,
): AssistanceOutputClaim {
	const record = claimRecord(value, OUTPUT_KEYS, 'An assistance output claim');
	const role = enumValue(record.role, ASSISTANCE_OUTPUT_ROLES, 'An assistance output role is unrecognised.');
	const admittedMediaType = roleMediaType(record.mediaType, role, OUTPUT_MEDIA_TYPES);
	const claim = Object.freeze({
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
		claimId: opaqueId(record.claimId, 'claim'),
		jobId: opaqueId(record.jobId, 'job'),
		role,
		mediaType: admittedMediaType,
		byteLength: byteLength(record.byteLength, 'An assistance output byte length is outside its bound.'),
		sha256: digest(record.sha256),
	});
	if (reservationValue === undefined) return claim;
	const reservation = validateAssistanceOutputReservation(reservationValue);
	if (claim.claimId !== reservation.claimId || claim.jobId !== reservation.jobId
		|| claim.role !== reservation.role || claim.mediaType !== reservation.mediaType
		|| claim.byteLength > reservation.maximumByteLength) {
		throw new TypeError('An assistance output claim disagrees with its exact reservation.');
	}
	return claim;
}

function claimRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
): Record<string, unknown> {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`${label} must carry exactly its schema keys.`);
	}
	if (record.claimVersion !== ASSISTANCE_DATA_CLAIM_VERSION) {
		throw new TypeError(`${label} uses an unsupported claim version.`);
	}
	return record;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`An assistance ${label} id must be 40 lowercase hexadecimal characters.`);
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('An assistance data claim needs a lowercase SHA-256 digest.');
	}
	return value;
}

function mediaType(value: unknown): string {
	if (typeof value !== 'string' || !MEDIA_TYPE.test(value)) {
		throw new TypeError('An assistance data claim needs one bounded lower-case media type.');
	}
	return value;
}

function roleMediaType<Role extends string>(
	value: unknown,
	role: Role,
	admitted: Readonly<Record<Role, readonly string[]>>,
): string {
	const candidate = mediaType(value);
	if (!admitted[role].includes(candidate)) {
		throw new TypeError(`The assistance ${role} role does not admit that media type.`);
	}
	return candidate;
}

function jsonTypes(role: AssistanceInputRole | AssistanceOutputRole): readonly string[] {
	return Object.freeze(['application/json', `application/vnd.soundscaper.${role}+json`]);
}

function byteLength(value: unknown, message: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
		throw new RangeError(message);
	}
	return Number(value);
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	message: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(message);
	}
	return value as Values[number];
}
