/* SPDX-License-Identifier: AGPL-3.0-only */

import { array, field, id, integer, record, unique } from './value-validation.ts';

export const PHOTO_STACK_LIMITS_V1 = Object.freeze({ maximumPhotos: 1024, maximumDocumentBytes: 262_144, pageSize: 64 });

/** Independent grouping authority; the closed catalog/photo family stays version 1. */
export interface PhotoStackV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-stack';
	readonly catalogId: string;
	readonly id: string;
	readonly revision: number;
	readonly photoIds: readonly string[];
	readonly coverPhotoId: string;
}

/** Retained even after the last dissolve so global grouping revisions never reset. */
export interface PhotoStackStateV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-stack-state';
	readonly catalogId: string;
	readonly revision: number;
	readonly stackCount: number;
}

export function normalizePhotoStackV1(value: unknown): Readonly<PhotoStackV1> {
	const input = record(value, 'photo stack', ['schemaVersion', 'kind', 'catalogId', 'id', 'revision', 'photoIds', 'coverPhotoId']);
	requireVersion(input, 'photo-stack');
	const photoIds = array(field(input, 'photoIds'), 'stack photos', 2, PHOTO_STACK_LIMITS_V1.maximumPhotos)
		.map((entry) => id(entry, 'stack photo ID'));
	unique(photoIds, 'stack photos');
	const coverPhotoId = id(field(input, 'coverPhotoId'), 'stack cover photo ID');
	if (!photoIds.includes(coverPhotoId)) throw new RangeError('Stack cover must belong to its ordered membership.');
	const result: PhotoStackV1 = Object.freeze({ schemaVersion: 1, kind: 'photo-stack',
		catalogId: id(field(input, 'catalogId'), 'stack catalog ID'), id: id(field(input, 'id'), 'stack ID'),
		revision: integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'stack revision'),
		photoIds: Object.freeze(photoIds), coverPhotoId });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_STACK_LIMITS_V1.maximumDocumentBytes) {
		throw new RangeError('Photo stack exceeds its serialized byte budget.');
	}
	return result;
}

export function serializePhotoStackV1(value: unknown): string {
	return JSON.stringify(normalizePhotoStackV1(value));
}

export function normalizePhotoStackStateV1(value: unknown): Readonly<PhotoStackStateV1> {
	const input = record(value, 'photo stack state', ['schemaVersion', 'kind', 'catalogId', 'revision', 'stackCount']);
	requireVersion(input, 'photo-stack-state');
	return Object.freeze({ schemaVersion: 1, kind: 'photo-stack-state', catalogId: id(field(input, 'catalogId'), 'stack catalog ID'),
		revision: integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'stack state revision'),
		stackCount: integer(field(input, 'stackCount'), 0, Number.MAX_SAFE_INTEGER, 'stack count') });
}

function requireVersion(input: Readonly<Record<string, unknown>>, kind: string): void {
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported photo stack protocol version.');
	if (field(input, 'kind') !== kind) throw new TypeError('Unexpected photo stack document kind.');
}
