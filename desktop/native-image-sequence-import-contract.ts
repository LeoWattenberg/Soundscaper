/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';

import { assertHelperWireEnvelope } from './helper-wire-admission.ts';
import type {
	NativeMediaImageSequenceInventoryReferenceV25,
	NativeMediaImageSequenceSourcePackReferenceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import type { FramescaperImageSequenceNativeAdmissionRequestV25 } from '../src/framescaper/editor-native-image-sequence-import-v25.ts';
import { imageSequenceStorageSha256 } from './native-image-sequence-import-storage.ts';

export const FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CONTROL_MAXIMUM_BYTES = 64 * 1024;

export type FramescaperNativeImageSequenceCandidateGeneration = 25 | 26;
export type FramescaperNativeImageSequenceAssetKind = 'pack' | 'inventory';
export type FramescaperNativeImageSequenceReference =
	| NativeMediaImageSequenceSourcePackReferenceV25
	| NativeMediaImageSequenceInventoryReferenceV25;
export interface FramescaperNativeImageSequenceRecoveryManifest {
	readonly version: 1;
	readonly transactionId: string;
	readonly generation: FramescaperNativeImageSequenceCandidateGeneration;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sourceId: string | null;
	readonly pack: FramescaperNativeImageSequenceReference | null;
	readonly inventory: FramescaperNativeImageSequenceReference | null;
	readonly authenticator: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TRANSACTION_ID = /^[a-f0-9]{40}$/u;

const REQUEST_FIELDS = Object.freeze({
	begin: ['operation', 'candidateGeneration', 'projectId', 'projectRevision'],
	write: ['operation', 'transactionId', 'asset', 'offset', 'bytes'],
	'prepare-write': ['operation', 'transactionId', 'asset', 'offset', 'binding'],
	'await-write': ['operation', 'transactionId', 'asset', 'offset', 'streamId'],
	commit: ['operation', 'transactionId', 'asset', 'reference'],
	admit: ['operation', 'transactionId', 'admission'],
	complete: [
		'operation', 'transactionId', 'sourceId', 'inventorySha256', 'sourcePackSha256',
	],
	discard: ['operation', 'transactionId'],
} as const);

export function assertFramescaperNativeImageSequenceImportRequest(
	value: unknown,
	options: Readonly<{ allowDirectWrite: boolean; controlEnvelope?: boolean }>,
): void {
	if (options.controlEnvelope === true) assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('An image-sequence import request must be a plain record.');
	}
	const operation = (value as Readonly<{ operation?: unknown }>).operation;
	if (typeof operation !== 'string' || !Object.hasOwn(REQUEST_FIELDS, operation)) {
		throw new TypeError('The image-sequence import operation is unsupported.');
	}
	if (operation === 'write' && !options.allowDirectWrite) {
		throw new TypeError('Image-sequence bytes require the negotiated MessagePort data plane.');
	}
	const fields = REQUEST_FIELDS[operation as keyof typeof REQUEST_FIELDS];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as never))) {
		throw new TypeError('The image-sequence import request has missing or unsupported fields.');
	}
}

export function assertFramescaperNativeImageSequenceImportPortRequest(value: unknown): void {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An image-sequence import port request must be a record.');
	}
	const fields = ['transactionId', 'asset', 'offset', 'binding'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('The image-sequence import port request must be exact and pathless.');
	}
}

export function normalizeFramescaperNativeImageSequenceReference(
	value: unknown,
	asset: FramescaperNativeImageSequenceAssetKind,
): FramescaperNativeImageSequenceReference {
	const record = exactRecord(value, asset === 'pack'
		? ['kind', 'storageKey', 'sha256', 'byteLength']
		: ['kind', 'version', 'storageKey', 'sha256', 'byteLength', 'frameCount',
			'firstFrameNumber', 'lastFrameNumber'], 'asset reference');
	const expectedKind = asset === 'pack' ? 'image-sequence-source-pack' : 'image-sequence-inventory';
	const digest = framescaperNativeImageSequenceSha256(record.sha256);
	const prefix = asset === 'pack' ? 'image-sequence-pack-sha256:' : 'image-sequence-inventory-sha256:';
	if (record.kind !== expectedKind || record.storageKey !== `${prefix}${digest}`) {
		throw new Error('The asset reference identity is not digest-bound.');
	}
	framescaperNativeImageSequenceInteger(record.byteLength, 'asset byte length', 1);
	if (asset === 'inventory') {
		if (record.version !== 1) throw new TypeError('The inventory reference version is unsupported.');
		for (const key of ['frameCount', 'firstFrameNumber', 'lastFrameNumber']) {
			framescaperNativeImageSequenceInteger(record[key], key, key === 'frameCount' ? 1 : 0);
		}
	}
	return Object.freeze({ ...record }) as unknown as FramescaperNativeImageSequenceReference;
}

export function normalizeFramescaperNativeImageSequenceAdmission(
	value: unknown,
): FramescaperImageSequenceNativeAdmissionRequestV25 {
	const record = exactRecord(value, [
		'kind', 'candidateGeneration', 'projectId', 'projectRevision', 'sourceId', 'profileId',
		'frameRate', 'frameCount', 'inventory', 'sourcePack',
	], 'admission');
	if (record.kind !== 'framescaper-image-sequence-admission-v1'
		|| (record.candidateGeneration !== 25 && record.candidateGeneration !== 26)) {
		throw new TypeError('Admission is not an exact V25/V26 request.');
	}
	framescaperNativeImageSequenceId(record.projectId, 'project ID');
	framescaperNativeImageSequenceId(record.sourceId, 'source ID');
	framescaperNativeImageSequenceInteger(record.projectRevision, 'project revision');
	framescaperNativeImageSequenceInteger(record.frameCount, 'frame count', 1);
	if (!['decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence']
		.includes(String(record.profileId))) throw new TypeError('The sequence decode profile is unsupported.');
	const rate = exactRecord(record.frameRate, ['num', 'den'], 'image-sequence rate');
	framescaperNativeImageSequenceInteger(rate.num, 'rate numerator', 1);
	framescaperNativeImageSequenceInteger(rate.den, 'rate denominator', 1);
	return Object.freeze({ ...record }) as unknown as FramescaperImageSequenceNativeAdmissionRequestV25;
}

export function parseFramescaperNativeImageSequenceManifest(
	bytes: Uint8Array,
	expectedTransactionId: string,
): FramescaperNativeImageSequenceRecoveryManifest {
	const record = exactRecord(
		JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
		['version', 'transactionId', 'generation', 'projectId', 'projectRevision', 'sourceId',
			'pack', 'inventory', 'authenticator'],
		'recovery manifest',
	);
	if (record.version !== 1 || record.transactionId !== expectedTransactionId
		|| !TRANSACTION_ID.test(expectedTransactionId)
		|| (record.generation !== 25 && record.generation !== 26)
		|| (record.sourceId !== null && typeof record.sourceId !== 'string')) {
		throw new Error('Invalid image-sequence recovery identity.');
	}
	const body = Object.freeze({
		version: 1 as const,
		transactionId: expectedTransactionId,
		generation: record.generation,
		projectId: framescaperNativeImageSequenceId(record.projectId, 'project ID'),
		projectRevision: framescaperNativeImageSequenceInteger(
			record.projectRevision, 'project revision',
		),
		sourceId: record.sourceId === null
			? null : framescaperNativeImageSequenceId(record.sourceId, 'source ID'),
		pack: record.pack === null
			? null : normalizeFramescaperNativeImageSequenceReference(record.pack, 'pack'),
		inventory: record.inventory === null
			? null : normalizeFramescaperNativeImageSequenceReference(record.inventory, 'inventory'),
	});
	const authenticator = framescaperNativeImageSequenceSha256(record.authenticator);
	if (authenticator !== imageSequenceStorageSha256(JSON.stringify(body))) {
		throw new Error('Unauthenticated image-sequence recovery manifest.');
	}
	return Object.freeze({ ...body, authenticator });
}

export function framescaperNativeImageSequenceAssetPath(
	root: string,
	reference: Pick<FramescaperNativeImageSequenceReference, 'kind' | 'sha256'>,
): string {
	const digest = framescaperNativeImageSequenceSha256(reference.sha256);
	const extension = reference.kind === 'image-sequence-source-pack' ? 'pack'
		: reference.kind === 'image-sequence-inventory' ? 'inventory' : null;
	if (extension === null) throw new TypeError('The image-sequence asset kind is unsupported.');
	return join(root, 'objects', `${digest}.${extension}`);
}

export function framescaperNativeImageSequenceId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

export function framescaperNativeImageSequenceInteger(
	value: unknown,
	label: string,
	minimum = 0,
): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function framescaperNativeImageSequenceSha256(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('The SHA-256 digest is invalid.');
	}
	return value;
}

function exactRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== keys.length) {
		throw new TypeError(`The ${label} must be an exact plain record.`);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The ${label}.${key} must be an enumerable data property.`);
		}
	}
	return value as Record<string, unknown>;
}
