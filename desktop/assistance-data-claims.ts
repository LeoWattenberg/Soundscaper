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
import {
	LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES,
	LOCAL_ASSISTANCE_INPUT_ROLES,
	LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES,
	LOCAL_ASSISTANCE_OUTPUT_ROLES,
	localAssistanceJsonMediaTypes,
} from '../src/common/editor/assistance/local-assistance-media-contract.ts';

export const ASSISTANCE_DATA_CLAIM_VERSION = 1;

export const ASSISTANCE_INPUT_ROLES = Object.freeze([
	...LOCAL_ASSISTANCE_INPUT_ROLES.slice(0, 3),
	'video-authority',
	...LOCAL_ASSISTANCE_INPUT_ROLES.slice(3),
	'shot-boundaries',
	'recognized-text',
	'reaction-ranges',
	'embeddings',
	'highlight-video-signals',
	'highlight-audio-signals',
	'highlight-transcript-signals',
] as const);

export const ASSISTANCE_OUTPUT_ROLES = Object.freeze([
	...LOCAL_ASSISTANCE_OUTPUT_ROLES,
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
	'synthesized-audio',
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
	...LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES,
	'video-authority': localAssistanceJsonMediaTypes('video-authority'),
	'shot-boundaries': LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['shot-boundaries'],
	'recognized-text': LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['recognized-text'],
	'reaction-ranges': localAssistanceJsonMediaTypes('reaction-ranges'),
	embeddings: LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES.embeddings,
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
	...LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES,
	captions: localAssistanceJsonMediaTypes('captions'),
	'cleanup-proposals': localAssistanceJsonMediaTypes('cleanup-proposals'),
	'attributed-transcript': localAssistanceJsonMediaTypes('attributed-transcript'),
	'reaction-ranges': localAssistanceJsonMediaTypes('reaction-ranges'),
	'text-chunks': localAssistanceJsonMediaTypes('text-chunks'),
	'transcript-index': localAssistanceJsonMediaTypes('transcript-index'),
	'beat-labels': localAssistanceJsonMediaTypes('beat-labels'),
	'tempo-map-diff': localAssistanceJsonMediaTypes('tempo-map-diff'),
	'cut-proposals': localAssistanceJsonMediaTypes('cut-proposals'),
	'frame-pack': LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES['frame-pack'],
	'video-index': localAssistanceJsonMediaTypes('video-index'),
	'tracked-subjects': localAssistanceJsonMediaTypes('tracked-subjects'),
	'reframe-path': localAssistanceJsonMediaTypes('reframe-path'),
	'highlight-signals': localAssistanceJsonMediaTypes('highlight-signals'),
	'highlight-candidates': localAssistanceJsonMediaTypes('highlight-candidates'),
	'highlight-proposals': localAssistanceJsonMediaTypes('highlight-proposals'),
	'synthesized-audio': Object.freeze(['audio/wav']),
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
