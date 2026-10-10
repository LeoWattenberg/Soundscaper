/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { readCanonicalSafeVisualText, readExactSafeVisualText } from './safe-visual-text.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from './imaging/image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from './imaging/image-develop-state-v2.ts';

export type ImageDevelopHandoffOriginV1 = Readonly<{
	schemaFamily: 'lightscaper'; schemaVersion: 1 | 2; catalogId: string; photoId: string; revision: number;
	versionId: string; versionKind: 'master' | 'virtual-copy'; versionName: string; versionCreatedAt: string;
}> | Readonly<{
	schemaFamily: 'framescaper'; schemaVersion: 1; projectId: string; revision: number; sourceId: string; sequenceId: string; clipId: string;
}>;
export interface ImageDevelopHandoffProvenanceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'image-develop-handoff';
	readonly origin: ImageDevelopHandoffOriginV1;
	/** Exact original spelling is retained beside its canonical original filename. */
	readonly original: Readonly<{ exactName: string; sha256: string; byteLength: number }>;
	readonly developSha256: string;
}

/** Only normalized closed recipe facts are hashed; this grants no resource/body authority. */
export function imageDevelopHandoffRecipeSha256V1(value: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(normalizeImageDevelopStateV1OrV2(value)));
	if (bytes.byteLength > IMAGE_DEVELOP_LIMITS_V1.maximumBytes) throw new RangeError('Image handoff recipe exceeds its byte limit.');
	return bytesToHex(sha256(bytes));
}

export function createImageDevelopHandoffProvenanceV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceV1> {
	const input = record(value, 'image handoff provenance request', ['origin', 'original', 'develop']);
	const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop', 'image handoff provenance request'));
	const result = normalizeImageDevelopHandoffProvenanceV1({ schemaVersion: 1, kind: 'image-develop-handoff',
		origin: field(input, 'origin', 'image handoff provenance request'), original: field(input, 'original', 'image handoff provenance request'),
		developSha256: imageDevelopHandoffRecipeSha256V1(develop) });
	if (result.origin.schemaFamily === 'lightscaper' && result.origin.schemaVersion === 1 && develop.processVersion !== 1) {
		throw new RangeError('A Photo1 origin cannot bind a successor develop process.');
	}
	return result;
}

export function normalizeImageDevelopHandoffProvenanceV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceV1> {
	const input = record(value, 'image handoff provenance', ['schemaVersion', 'kind', 'origin', 'original', 'developSha256']);
	if (field(input, 'schemaVersion', 'image handoff provenance') !== 1 || field(input, 'kind', 'image handoff provenance') !== 'image-develop-handoff') {
		throw new RangeError('Unsupported image handoff provenance identity or version.');
	}
	const original = record(field(input, 'original', 'image handoff provenance'), 'image handoff original', ['exactName', 'sha256', 'byteLength']);
	return Object.freeze({ schemaVersion: 1, kind: 'image-develop-handoff', origin: origin(field(input, 'origin', 'image handoff provenance')),
		original: Object.freeze({ exactName: readExactSafeVisualText(field(original, 'exactName', 'image handoff original'), 'image handoff exact filename', 512, false),
			sha256: digest(field(original, 'sha256', 'image handoff original')), byteLength: integer(field(original, 'byteLength', 'image handoff original'), 1, 64 * 1024 * 1024) }),
		developSha256: digest(field(input, 'developSha256', 'image handoff provenance')) });
}

function origin(value: unknown): ImageDevelopHandoffOriginV1 {
	const discriminator = record(value, 'image handoff origin', ['schemaFamily', 'schemaVersion', 'catalogId', 'photoId', 'revision', 'versionId', 'versionKind', 'versionName', 'versionCreatedAt',
		'projectId', 'sourceId', 'sequenceId', 'clipId'], ['schemaFamily', 'schemaVersion']);
	const family = field(discriminator, 'schemaFamily', 'image handoff origin');
	if (family === 'lightscaper') {
		const input = record(value, 'photo handoff origin', ['schemaFamily', 'schemaVersion', 'catalogId', 'photoId', 'revision', 'versionId', 'versionKind', 'versionName', 'versionCreatedAt']);
		const version = field(input, 'schemaVersion', 'photo handoff origin'), kind = field(input, 'versionKind', 'photo handoff origin');
		if (version !== 1 && version !== 2) throw new RangeError('Unsupported photo handoff schema version.');
		if (kind !== 'master' && kind !== 'virtual-copy') throw new RangeError('Unsupported photo handoff version kind.');
		return Object.freeze({ schemaFamily: family, schemaVersion: version, catalogId: id(field(input, 'catalogId', 'photo handoff origin')),
			photoId: id(field(input, 'photoId', 'photo handoff origin')), revision: integer(field(input, 'revision', 'photo handoff origin'), 0, Number.MAX_SAFE_INTEGER),
			versionId: id(field(input, 'versionId', 'photo handoff origin')), versionKind: kind,
			versionName: readCanonicalSafeVisualText(field(input, 'versionName', 'photo handoff origin'), 'photo handoff version name', 256, false),
			versionCreatedAt: timestamp(field(input, 'versionCreatedAt', 'photo handoff origin')) });
	}
	if (family === 'framescaper') {
		const input = record(value, 'Frame handoff origin', ['schemaFamily', 'schemaVersion', 'projectId', 'revision', 'sourceId', 'sequenceId', 'clipId']);
		if (field(input, 'schemaVersion', 'Frame handoff origin') !== 1) throw new RangeError('Unsupported Frame handoff provenance version.');
		return Object.freeze({ schemaFamily: family, schemaVersion: 1, projectId: id(field(input, 'projectId', 'Frame handoff origin')),
			revision: integer(field(input, 'revision', 'Frame handoff origin'), 0, Number.MAX_SAFE_INTEGER), sourceId: id(field(input, 'sourceId', 'Frame handoff origin')),
			sequenceId: id(field(input, 'sequenceId', 'Frame handoff origin')), clipId: id(field(input, 'clipId', 'Frame handoff origin')) });
	}
	throw new RangeError('Unsupported image handoff origin.');
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Image handoff integer is outside its bound.');
	return value;
}
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Image handoff requires a stable ID.');
	return value;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Image handoff requires a lowercase SHA-256.');
	return value;
}
function timestamp(value: unknown): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
		|| !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('Image handoff requires a canonical UTC timestamp.');
	return value;
}
