/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogArchiveSavedCollectionGuardV3 } from '../src/lightscaper/archive/catalog-archive-saved-collection-guard-v3.ts';
import { savedArchiveDefinitionV3 as definition, savedArchiveRootV3 as root, savedArchiveStateV3 as state } from './helpers/lightscaper-saved-collection-archive-fixture.ts';

test('guard retains only bounded IDs and authenticates the exact physical-state count', () => {
	const guard = new PhotoCatalogArchiveSavedCollectionGuardV3(root(), state(2));
	guard.admit(definition()); assert.equal(guard.count, 1); assert.throws(() => guard.finish(), /count/iu);
	assert.throws(() => guard.admit(definition()), /duplicate/iu); assert.equal(guard.count, 1);
	guard.admit(definition('saved-2')); guard.finish(); assert.equal(guard.count, 2);
	assert.throws(() => guard.admit(definition('saved-3')), /count/iu); assert.equal(guard.count, 2);
});

test('physical absence and retained empty state both permit zero records without synthesizing authority', () => {
	for (const retained of [null, state(0, 0), state(0, 99)]) {
		const guard = new PhotoCatalogArchiveSavedCollectionGuardV3(root(), retained); guard.finish();
		assert.throws(() => guard.admit(definition()), /count/iu); assert.equal(guard.count, 0);
	}
	assert.throws(() => new PhotoCatalogArchiveSavedCollectionGuardV3(root(), { ...state(0), catalogId: 'foreign' }), /catalog/iu);
	assert.throws(() => new PhotoCatalogArchiveSavedCollectionGuardV3(root(), state(10_000)), /10000|count/iu);
});

test('guard checks every nested branch, root-only collection filter and root/saved ID disjointness', () => {
	const guard = new PhotoCatalogArchiveSavedCollectionGuardV3(root(), state(2));
	for (const candidate of [definition('root-collection'), { ...definition(), catalogId: 'foreign' },
		{ ...definition(), query: { ...definition().query, filter: { kind: 'collection' as const, id: 'saved-2' } } },
		definition('saved-1', { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 },
			{ kind: 'not', term: { kind: 'all', terms: [{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'missing' }] } }] })]) {
		assert.throws(() => guard.admit(candidate), /disjoint|catalog|missing/iu); assert.equal(guard.count, 0);
	}
	guard.admit(definition('saved-1', { kind: 'not', term: { kind: 'all', terms: [{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }] } }));
	guard.admit(definition('saved-2')); guard.finish();
});

test('the closed admitted identity bound caps scalar retention across the full 10000-ID inventory', () => {
	const guard = new PhotoCatalogArchiveSavedCollectionGuardV3({ ...root(), collections: [] }, state(10_000));
	const sample = { ...definition(), query: { ...definition().query, filter: null } };
	assert.throws(() => guard.admit({ ...sample, id: 'x'.repeat(129) }), /ID/iu);
	assert.throws(() => guard.admit({ ...sample, id: 'bad|id' }), /ID/iu);
	for (let index = 0; index < 10_000; index++) guard.admit({ ...sample, id: `saved-${index}` });
	guard.finish(); assert.equal(guard.count, 10_000); assert.throws(() => guard.admit({ ...sample, id: 'extra' }), /count/iu);
});
