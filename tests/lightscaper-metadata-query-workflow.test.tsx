/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibraryQueryPortV2, PhotoLibraryQueryV2 } from '../src/common/editor/photo-library-query-port-v2.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';

const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', predicate: { kind: 'all',
	terms: [{ kind: 'text', column: 'camera-model', operator: 'equals', value: 'Camera' },
		{ kind: 'number', column: 'iso', minimum: 200, maximum: 800 }] } });
const row = Object.freeze({ id: 'matching', fileName: 'Photo.jpg', width: 32, height: 24, rating: 0,
	flag: 'unflagged' as const, colorLabel: 'none' as const });
const page = (rows = [row], cursor: string | null = null) => ({ catalogName: 'Metadata library', totalCount: 100, rows, cursor, scanned: 64 });

test('the menu workflow forwards complete V2 criteria through sparse ordinary pages and collapsed refreshes', async () => {
	const owner = createImportTestPort() as ReturnType<typeof createImportTestPort> & PhotoLibraryQueryPortV2;
	const ordinary: PhotoLibraryQueryV2[] = [], collapsed: PhotoLibraryQueryV2[] = [];
	owner.readQueryStepV2 = async request => { ordinary.push(request.query); return request.cursor ? page() : page([], 'after-64'); };
	owner.readStackQueryStepV2 = async request => { collapsed.push(request.query); return page(); };
	owner.setRating = async (_id, rating) => ({ ...row, rating });
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.applyQuery(query); });
		assert.equal(mounted.current.page?.rows[0]?.id, row.id); assert.equal(ordinary.length, 2);
		assert.ok(ordinary.every(criteria => criteria === query));
		await act(async () => { await mounted.current.setStackCollapsed(true); });
		assert.equal(mounted.current.stackCollapsed, true); assert.deepEqual(collapsed, [query]);
		await act(async () => { await mounted.current.setRating(row.id, 4); });
		assert.deepEqual(collapsed, [query, query]);
		await act(async () => { await mounted.current.setStackCollapsed(false); });
		assert.equal(mounted.current.stackCollapsed, false); assert.equal(ordinary.length, 4);
		assert.equal(mounted.current.query, query);
	} finally { await mounted.dispose(); }
});

test('the menu workflow explicitly rebuilds V2 and retains both byte owners across yielded steps', async () => {
	const owner = createImportTestPort() as ReturnType<typeof createImportTestPort> & PhotoLibraryQueryPortV2;
	let calls = 0;
	owner.rebuildQueryStepV2 = async () => { calls++; return { processed: 16, readBytes: 2_097_152, writtenBytes: 1_048_576, ready: calls === 2 }; };
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.buildQueryIndex(); });
		assert.equal(calls, 2); assert.equal(mounted.current.error, null);
		assert.deepEqual(mounted.current.queryIndexProgress, { processed: 32, readBytes: 4_194_304, writtenBytes: 2_097_152, ready: true });
	} finally { await mounted.dispose(); }
});

test('the menu readiness probe selects V2 before any criteria are authored', async () => {
	const owner = createImportTestPort() as ReturnType<typeof createImportTestPort> & PhotoLibraryQueryPortV2;
	let calls = 0;
	owner.readQueryStepV2 = async request => { calls++; assert.equal(request.query.schemaVersion, 2);
		assert.equal(request.query.predicate, null); return page(); };
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.probeQuery(); });
		assert.equal(calls, 1); assert.equal(mounted.current.error, null); assert.equal(mounted.current.query, null);
	} finally { await mounted.dispose(); }
});
