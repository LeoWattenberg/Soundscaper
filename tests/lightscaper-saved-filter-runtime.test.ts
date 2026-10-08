/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_SAVED_FILTER_RUNTIME_V1 as runtime } from '../src/lightscaper/photo-saved-filter-ui-runtime-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';

const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'Landscape',
	filter: { kind: 'collection', id: 'manual' }, sort: { field: 'capture-time', direction: 'descending' },
	predicate: { kind: 'all', terms: [{ kind: 'keyword', id: 'keyword' }, { kind: 'not', term: {
		kind: 'any', terms: [{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
			{ kind: 'number', column: 'iso', minimum: 400, maximum: 1600 }] } }] } });

test('saved filter controls round-trip every full Query2 field without changing nested metadata conditions', () => {
	const json = runtime.writeQueryJson(query), loaded = runtime.readQueryJson(json);
	assert.deepEqual(loaded, query); assert.equal(runtime.writeQueryJson(loaded), json);
	assert.ok(Object.isFrozen(loaded)); assert.ok(Object.isFrozen(loaded.predicate)); assert.ok(Object.isFrozen(runtime));
	assert.deepEqual(Object.keys(runtime).sort(), ['columns', 'normalizePredicate', 'readQueryJson', 'writeQueryJson']);
});

test('saving an older transient filter explicitly promotes text, literal filter and sort into full Query2', () => {
	const { text, filter, sort } = query;
	assert.deepEqual(runtime.readQueryJson(runtime.writeQueryJson({ text, filter, sort })), { schemaVersion: 2,
		kind: 'photo-catalog-query', text, filter, sort, predicate: null });
});

test('saved recipe JSON requires its complete closed profile and bounded UTF8 before parsing', () => {
	for (const input of [null, 17, {}, '{', 'x'.repeat(524289), '😀'.repeat(131073),
		JSON.stringify({ schemaVersion: 2, kind: 'photo-catalog-query' }), JSON.stringify({ ...query, schemaVersion: 3 }),
		JSON.stringify({ ...query, kind: 'foreign' }), JSON.stringify({ ...query, future: true }),
		JSON.stringify({ ...query, predicate: { kind: 'future' } })]) assert.throws(() => runtime.readQueryJson(input));
});

test('controlled incomplete references and malformed full drafts cannot be serialized for a save', () => {
	for (const input of [{ ...query, filter: { kind: 'keyword', id: '' } }, { ...query, future: true },
		{ ...query, predicate: { kind: 'number', column: 'iso', minimum: 1600, maximum: 400 } }]) {
		assert.throws(() => runtime.writeQueryJson(input as typeof query));
	}
});

test('a versioned draft must explicitly preserve its predicate rather than default missing criteria', () => {
	const { predicate: _predicate, ...incomplete } = query;
	assert.throws(() => runtime.writeQueryJson(incomplete as typeof query));
});

test('all 256 grammar nodes and large escaped legal recipes remain intact through the injected pure controls', () => {
	const large = normalizePhotoCatalogQueryV2({ ...query, predicate: { kind: 'all', terms: Array.from({ length: 255 }, () => ({
		kind: 'text', column: 'camera-make', operator: 'equals', value: '\ud800'.repeat(256),
	})) } });
	const json = runtime.writeQueryJson(large);
	assert.ok(new TextEncoder().encode(json).byteLength > 390000);
	assert.ok(new TextEncoder().encode(json).byteLength <= 524288);
	assert.deepEqual(runtime.readQueryJson(json), large);
});
