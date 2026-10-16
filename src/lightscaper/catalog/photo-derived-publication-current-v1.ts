/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoOriginalV1 } from './photo-document-envelope-v1.ts';
import type { PhotoOriginalV1 } from './types.ts';
import { id, integer } from './value-validation.ts';

export interface PhotoDerivedPublicationSelectionCurrentV1 {
	readonly photoId: string;
	readonly revision: number;
	readonly original: Readonly<PhotoOriginalV1>;
}
export interface PhotoDerivedPublicationGuardCurrentV1 {
	readonly catalogId: string;
	readonly resultPhotoId: string;
	readonly selections: readonly Readonly<PhotoDerivedPublicationSelectionCurrentV1>[];
}
const GUARDS = new WeakSet<object>();

/** Capture every bounded scalar before body verification can yield. This is
 * source identity, never a body, decoder capability or deferred transaction. */
export function capturePhotoDerivedPublicationGuardCurrentV1(catalogIdValue: unknown, selectionsValue: unknown,
	resultPhotoIdValue: unknown): Readonly<PhotoDerivedPublicationGuardCurrentV1> {
	const catalogId = id(catalogIdValue, 'derived catalog ID'), resultPhotoId = id(resultPhotoIdValue, 'derived result photo ID');
	const seen = new Set<string>();
	const selections = readClosedDomainArray(selectionsValue, 'derived source selections', 2, 9).map(value => {
		const input = readClosedDomainRecord(value, 'derived source selection', ['photoId', 'revision', 'original']);
		const get = (key: string) => readClosedDomainField(input, key, 'derived source selection');
		const photoId = id(get('photoId'), 'derived source photo ID');
		if (photoId === resultPhotoId || seen.has(photoId)) throw new RangeError('Derived sources require unique Photos distinct from the result.');
		seen.add(photoId);
		return Object.freeze({ photoId, revision: integer(get('revision'), 0, Number.MAX_SAFE_INTEGER, 'derived source revision'),
			original: normalizePhotoOriginalV1(get('original')) });
	});
	const guard = Object.freeze({ catalogId, resultPhotoId, selections: Object.freeze(selections) });
	GUARDS.add(guard); return guard;
}

/** Only an owning capture may reach the internal optional native guard seam. */
export function readPhotoDerivedPublicationGuardCurrentV1(value: unknown): Readonly<PhotoDerivedPublicationGuardCurrentV1> {
	if (!value || typeof value !== 'object' || !GUARDS.has(value)) throw new TypeError('Derived publication requires its owning captured source guard.');
	return value as Readonly<PhotoDerivedPublicationGuardCurrentV1>;
}
