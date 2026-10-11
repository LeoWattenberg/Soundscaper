/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from './types.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2, upgradePhotoDocumentV2, type PhotoDocumentV2 } from './photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, upgradePhotoDocumentV3, type PhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from './types.ts';
import { array, field, id, integer, name, record, utcTimestamp } from './value-validation.ts';

export type PhotoHistoryProfileV1 = 'legacy2' | 'current3';
type Photo<Profile extends PhotoHistoryProfileV1> = Profile extends 'legacy2' ? PhotoDocumentV1 | PhotoDocumentV2 : PhotoDocumentCurrentV1;
export interface PhotoHistoryForProfileV1<Profile extends PhotoHistoryProfileV1> {
	readonly present: Photo<Profile>;
	readonly past: readonly Photo<Profile>[];
	readonly future: readonly Photo<Profile>[];
	readonly capacity: number;
}
type VersionRequest = Readonly<{ id: string; name: string; createdAt: string; sourceVersionId?: string }>;
const issued = new WeakMap<object, PhotoHistoryProfileV1>();

/** Built-in literal profiles share revision/retention algorithms, never host policy callbacks. */
export function createPhotoHistoryForProfileV1<Profile extends PhotoHistoryProfileV1>(profile: Profile, value: unknown, capacity = 20): PhotoHistoryForProfileV1<Profile> {
	return freezeHistory(profile, readPhoto(profile, value), [], [], integer(capacity, 1, LIMITS.maximumHistoryEntries, 'photo history capacity'));
}
export function commitPhotoHistoryForProfileV1<Profile extends PhotoHistoryProfileV1>(
	profile: Profile, historyValue: PhotoHistoryForProfileV1<Profile>, value: unknown,
): PhotoHistoryForProfileV1<Profile> {
	const history = readHistory(profile, historyValue), next = readPhoto(profile, value);
	assertSameOriginal(history.present, next);
	if (next.revision !== history.present.revision) throw new RangeError('Photo history candidate has a stale revision.');
	const aggregate = aggregateVersion(profile, history, next);
	const present = withNextRevision(profile, next, history.present.revision, aggregate);
	return freezeHistory(profile, present, [...history.past, history.present].slice(-history.capacity), [], history.capacity);
}
export function undoPhotoHistoryForProfileV1<Profile extends PhotoHistoryProfileV1>(profile: Profile, historyValue: PhotoHistoryForProfileV1<Profile>): PhotoHistoryForProfileV1<Profile> {
	const history = readHistory(profile, historyValue), previous = history.past.at(-1);
	if (!previous) return history;
	return freezeHistory(profile, withNextRevision(profile, previous, history.present.revision, aggregateVersion(profile, history)), history.past.slice(0, -1),
		[...history.future, history.present].slice(-history.capacity), history.capacity);
}
export function redoPhotoHistoryForProfileV1<Profile extends PhotoHistoryProfileV1>(profile: Profile, historyValue: PhotoHistoryForProfileV1<Profile>): PhotoHistoryForProfileV1<Profile> {
	const history = readHistory(profile, historyValue), next = history.future.at(-1);
	if (!next) return history;
	return freezeHistory(profile, withNextRevision(profile, next, history.present.revision, aggregateVersion(profile, history)), [...history.past, history.present].slice(-history.capacity),
		history.future.slice(0, -1), history.capacity);
}
export function createPhotoVersionForProfileV1<Profile extends PhotoHistoryProfileV1>(profile: Profile, value: unknown, requestValue: VersionRequest): Photo<Profile> {
	const photo = readPhoto(profile, value);
	const request = profile === 'current3' ? readVersionRequest(requestValue) : requestValue;
	const source = photo.versions.find(version => version.id === (request.sourceVersionId ?? photo.activeVersionId));
	if (!source) throw new ReferenceError('Cannot copy a missing photo version.');
	return readPhoto(profile, { ...photo, activeVersionId: request.id, versions: [...photo.versions,
		{ id: request.id, name: request.name, createdAt: request.createdAt, kind: 'virtual-copy', develop: source.develop }] });
}
function assertProfile(profile: PhotoHistoryProfileV1): void {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo history profile.');
}
function readPhoto<Profile extends PhotoHistoryProfileV1>(profile: Profile, value: unknown): Photo<Profile> {
	assertProfile(profile);
	return (profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value)) as Photo<Profile>;
}
function readHistory<Profile extends PhotoHistoryProfileV1>(profile: Profile, value: PhotoHistoryForProfileV1<Profile>): PhotoHistoryForProfileV1<Profile> {
	assertProfile(profile);
	// Legacy public APIs retain their existing typed-history behavior. Current
	// outputs are already detached/frozen; native identity avoids recopying them.
	if (profile === 'legacy2' || issued.get(value) === profile) return value;
	const input = record(value, 'current photo history', ['present', 'past', 'future', 'capacity']);
	const capacity = integer(field(input, 'capacity'), 1, LIMITS.maximumHistoryEntries, 'photo history capacity');
	const present = readPhoto(profile, field(input, 'present'));
	let admittedBytes = new TextEncoder().encode(serializePhotoDocumentCurrentV1(present)).byteLength;
	const retained = (key: string) => Object.freeze(array(field(input, key), 'retained photo history', 0, capacity).map(candidate => {
		const photo = readPhoto(profile, candidate); assertSameOriginal(present, photo);
		admittedBytes += new TextEncoder().encode(serializePhotoDocumentCurrentV1(photo)).byteLength;
		if (admittedBytes > LIMITS.maximumHistoryBytes) throw new RangeError('Photo history exceeds its byte budget.');
		return photo;
	}));
	const result = Object.freeze({ present, past: retained('past'), future: retained('future'), capacity });
	issued.set(result, profile); return result;
}
function assertSameOriginal(previous: PhotoDocumentCurrentV1, next: PhotoDocumentCurrentV1): void {
	if (previous.id !== next.id || previous.catalogId !== next.catalogId) throw new RangeError('Photo history cannot change catalog or photo identity.');
	if (JSON.stringify(previous.original) !== JSON.stringify(next.original)) throw new RangeError('Photo history cannot mutate the retained original.');
	if (JSON.stringify(previous.extractedMetadata) !== JSON.stringify(next.extractedMetadata)) throw new RangeError('Photo history cannot replace extracted import facts.');
}
function aggregateVersion<Profile extends PhotoHistoryProfileV1>(profile: Profile, history: PhotoHistoryForProfileV1<Profile>, next?: Photo<Profile>): 1 | 2 | 3 {
	if (profile === 'legacy2') return history.present.schemaVersion;
	// Derive the sticky aggregate before truncating redo or evicting any state.
	let version: 1 | 2 | 3 = history.present.schemaVersion;
	for (const photo of [...history.past, ...history.future, ...(next ? [next] : [])]) if (photo.schemaVersion > version) version = photo.schemaVersion;
	return version;
}
function withNextRevision<Profile extends PhotoHistoryProfileV1>(profile: Profile, photo: Photo<Profile>, revision: number, aggregate: 1 | 2 | 3): Photo<Profile> {
	const retained = aggregate === 3 ? upgradePhotoDocumentV3(photo) : aggregate === 2 ? upgradePhotoDocumentV2(photo) : photo;
	return readPhoto(profile, { ...retained, revision: integer(revision + 1, 1, Number.MAX_SAFE_INTEGER, 'photo revision') });
}
function freezeHistory<Profile extends PhotoHistoryProfileV1>(profile: Profile, present: Photo<Profile>, past: readonly Photo<Profile>[], future: readonly Photo<Profile>[], capacity: number): PhotoHistoryForProfileV1<Profile> {
	const retainedPast = [...past], retainedFuture = [...future];
	const size = (photo: Photo<Profile>) => new TextEncoder().encode(profile === 'legacy2' ? serializePhotoDocumentV1OrV2(photo) : serializePhotoDocumentCurrentV1(photo)).byteLength;
	let byteLength = size(present) + retainedPast.reduce((sum, photo) => sum + size(photo), 0) + retainedFuture.reduce((sum, photo) => sum + size(photo), 0);
	while (byteLength > LIMITS.maximumHistoryBytes) {
		const evicted = retainedPast.length > 0 ? retainedPast.shift() : retainedFuture.shift();
		if (!evicted) break;
		byteLength -= size(evicted);
	}
	const result = Object.freeze({ present, past: Object.freeze(retainedPast), future: Object.freeze(retainedFuture), capacity });
	issued.set(result, profile); return result;
}
function readVersionRequest(value: unknown): VersionRequest {
	const input = record(value, 'current virtual copy', ['id', 'name', 'createdAt', 'sourceVersionId'], ['id', 'name', 'createdAt']);
	return Object.freeze({ id: id(field(input, 'id'), 'virtual copy ID'), name: name(field(input, 'name'), 'virtual copy name'),
		createdAt: utcTimestamp(field(input, 'createdAt'), 'virtual copy time'),
		...(Object.hasOwn(input, 'sourceVersionId') ? { sourceVersionId: id(field(input, 'sourceVersionId'), 'virtual copy source ID') } : {}) });
}
