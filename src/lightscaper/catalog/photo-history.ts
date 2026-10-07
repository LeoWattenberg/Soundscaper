/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeLightscaperDocumentV1, validateLightscaperDocumentV1 } from './documents.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoDocumentV1 } from './types.ts';
import { integer } from './value-validation.ts';

export interface PhotoHistoryV1 {
	readonly present: PhotoDocumentV1;
	readonly past: readonly PhotoDocumentV1[];
	readonly future: readonly PhotoDocumentV1[];
	readonly capacity: number;
}

export function createPhotoHistoryV1(value: unknown, capacity = 20): PhotoHistoryV1 {
	return freezeHistory(readPhoto(value), [], [], integer(capacity, 1, LIMITS.maximumHistoryEntries, 'photo history capacity'));
}

/** Commit only this photo aggregate. Storage must compare this revision atomically. */
export function commitPhotoHistoryV1(history: PhotoHistoryV1, value: unknown): PhotoHistoryV1 {
	const next = readPhoto(value);
	assertSameOriginal(history.present, next);
	if (next.revision !== history.present.revision) throw new RangeError('Photo history candidate has a stale revision.');
	const present = withNextRevision(next, history.present.revision);
	return freezeHistory(present, [...history.past, history.present].slice(-history.capacity), [], history.capacity);
}

/** Undo restores authored state but never rolls back the storage revision. */
export function undoPhotoHistoryV1(history: PhotoHistoryV1): PhotoHistoryV1 {
	const previous = history.past.at(-1);
	if (!previous) return history;
	return freezeHistory(withNextRevision(previous, history.present.revision), history.past.slice(0, -1),
		[...history.future, history.present].slice(-history.capacity), history.capacity);
}

export function redoPhotoHistoryV1(history: PhotoHistoryV1): PhotoHistoryV1 {
	const next = history.future.at(-1);
	if (!next) return history;
	return freezeHistory(withNextRevision(next, history.present.revision), [...history.past, history.present].slice(-history.capacity),
		history.future.slice(0, -1), history.capacity);
}

/** Produce an edit candidate with a fresh version identity; commit owns the revision. */
export function createPhotoVersionV1(
	value: unknown,
	request: Readonly<{ id: string; name: string; createdAt: string; sourceVersionId?: string }>,
): PhotoDocumentV1 {
	const photo = readPhoto(value);
	const source = photo.versions.find((version) => version.id === (request.sourceVersionId ?? photo.activeVersionId));
	if (!source) throw new ReferenceError('Cannot copy a missing photo version.');
	return readPhoto({ ...photo, activeVersionId: request.id, versions: [
		...photo.versions, { id: request.id, name: request.name, createdAt: request.createdAt, kind: 'virtual-copy', develop: source.develop },
	] });
}

function readPhoto(value: unknown): PhotoDocumentV1 {
	const document = validateLightscaperDocumentV1(value);
	if (document.kind !== 'photo') throw new TypeError('Photo history requires one photo document.');
	return document;
}

function assertSameOriginal(previous: PhotoDocumentV1, next: PhotoDocumentV1): void {
	if (previous.id !== next.id || previous.catalogId !== next.catalogId) throw new RangeError('Photo history cannot change catalog or photo identity.');
	// Retention/location relinking belongs to its own digest-verified storage
	// transaction. History edits may not replace any original reference field.
	if (JSON.stringify(previous.original) !== JSON.stringify(next.original)) {
		throw new RangeError('Photo history cannot mutate the retained original.');
	}
	if (JSON.stringify(previous.extractedMetadata) !== JSON.stringify(next.extractedMetadata)) {
		throw new RangeError('Photo history cannot replace extracted import facts.');
	}
}

function withNextRevision(photo: PhotoDocumentV1, revision: number): PhotoDocumentV1 {
	return readPhoto({ ...photo, revision: integer(revision + 1, 1, Number.MAX_SAFE_INTEGER, 'photo revision') });
}

function freezeHistory(present: PhotoDocumentV1, past: readonly PhotoDocumentV1[], future: readonly PhotoDocumentV1[], capacity: number): PhotoHistoryV1 {
	const retainedPast = [...past];
	const retainedFuture = [...future];
	const size = (photo: PhotoDocumentV1) => new TextEncoder().encode(serializeLightscaperDocumentV1(photo)).byteLength;
	let byteLength = size(present) + retainedPast.reduce((sum, photo) => sum + size(photo), 0)
		+ retainedFuture.reduce((sum, photo) => sum + size(photo), 0);
	while (byteLength > LIMITS.maximumHistoryBytes) {
		const evicted = retainedPast.length > 0 ? retainedPast.shift() : retainedFuture.shift();
		if (!evicted) break;
		byteLength -= size(evicted);
	}
	return Object.freeze({ present, past: Object.freeze(retainedPast), future: Object.freeze(retainedFuture), capacity });
}
