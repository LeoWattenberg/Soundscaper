/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PhotoQueryFields, { isPhotoQueryFieldsValidV2, type PhotoQueryFieldsPropsV2 } from '../src/common/editor/ui/lightscaper/PhotoQueryFields.tsx';
import type { PhotoLibraryQueryV2 } from '../src/common/editor/photo-library-query-port-v2.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { PHOTO_METADATA_QUERY_COLUMNS_V2 as metadataColumns } from '../src/lightscaper/catalog/photo-metadata-query-columns-v2.ts';
import { normalizePhotoSmartQueryV2 } from '../src/lightscaper/catalog/photo-smart-query-v2.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const initial: PhotoLibraryQueryV2 = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: null,
	sort: { field: 'photo-id', direction: 'ascending' }, predicate: null };
const labels = { flags: { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' },
	colorLabels: { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' } };

test('controlled query fields own no submit, migration or definition read until a reference scope is chosen', async () => {
	let reads = 0;
	const mounted = await mount({ readDefinitions: async () => { reads++; throw new Error('Unexpected read'); } });
	try {
		assert.equal(reads, 0); assert.equal(mounted.dom.find('form'), null);
		assert.equal(mounted.dom.find('[data-query-build]'), null); assert.equal(mounted.dom.find('[data-query-close]'), null);
		assert.equal(isPhotoQueryFieldsValidV2(initial, true), true);
		await mounted.change('queryText', 'Landscape'); await mounted.change('queryFilter', 'rating');
		await mounted.change('queryRating', '4'); await mounted.change('querySort', 'capture-time');
		await mounted.change('queryDirection', 'descending');
		assert.deepEqual(mounted.query(), { ...initial, text: 'Landscape', filter: { kind: 'rating', value: 4 },
			sort: { field: 'capture-time', direction: 'descending' } }); assert.equal(reads, 0);
	} finally { await mounted.dispose(); }
});

test('the parent accepts or replaces the single query and unrelated edits preserve exact compound predicate identity', async () => {
	const predicate = normalizePhotoSmartQueryV2({ schemaVersion: 2, kind: 'photo-smart-query', predicate: {
		kind: 'any', terms: [{ kind: 'presence', column: 'iso', value: 'known' },
			{ kind: 'not', term: { kind: 'keyword', id: 'keyword-1' } }] } }).predicate;
	const mounted = await mount({ query: { ...initial, predicate }, metadataValid: false }, false);
	try {
		await mounted.change('queryText', 'Awaiting parent');
		assert.equal(mounted.query().text, ''); assert.equal(reactProps(mounted.control('queryText')).value as unknown, '');
		assert.equal(mounted.changes[0]?.query.predicate, predicate); assert.equal(mounted.changes[0]?.metadataValid, false);
		await mounted.render({ query: { ...initial, text: 'Parent replacement', predicate }, metadataValid: true });
		assert.equal(reactProps(mounted.control('queryText')).value as unknown, 'Parent replacement');
		await mounted.change('querySort', 'rating'); assert.equal(mounted.changes.at(-1)?.query.predicate, predicate);
		assert.ok(mounted.dom.find('[data-metadata-preserved]'));
		await mounted.click('[data-metadata-replace]'); assert.equal(mounted.changes.at(-1)?.query.predicate, null);
		assert.equal(mounted.changes.at(-1)?.metadataValid, true);
	} finally { await mounted.dispose(); }
});

test('folder, keyword and collection scopes stay invalid until their exact selected reference is supplied', async () => {
	const requests: string[] = [];
	const mounted = await mount({ readDefinitions: async request => {
		requests.push(request.kind); const row = request.kind === 'collection'
			? { kind: 'collection' as const, id: 'definition-1', name: 'Chosen', collectionKind: 'manual' as const }
			: { kind: request.kind, id: 'definition-1', name: 'Chosen', parentId: null };
		return { rootRevision: 3, rows: [row], parent: null, selected: request.selectedId ? row : null, cursor: null };
	} });
	try {
		for (const kind of ['folder', 'keyword', 'collection'] as const) {
			await mounted.change('queryFilter', kind);
			assert.deepEqual(mounted.query().filter, { kind, id: '' });
			assert.equal(isPhotoQueryFieldsValidV2(mounted.query(), mounted.valid()), false);
			await mounted.click('[data-definition-choose="definition-1"]');
			assert.deepEqual(mounted.query().filter, { kind, id: 'definition-1' });
			assert.equal(isPhotoQueryFieldsValidV2(mounted.query(), mounted.valid()), true);
		}
		assert.ok(requests.includes('folder')); assert.ok(requests.includes('keyword')); assert.ok(requests.includes('collection'));
	} finally { await mounted.dispose(); }
});

test('metadata validity survives text and sort edits until the invalid condition is repaired', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); assert.equal(mounted.valid(), false);
		await mounted.change('queryText', 'Still invalid'); await mounted.change('querySort', 'file-name');
		assert.equal(isPhotoQueryFieldsValidV2(mounted.query(), mounted.valid()), false);
		await mounted.change('metadataValue-0', 'Canon'); await mounted.change('metadataColumn-0', 'iso');
		await mounted.change('metadataMinimum-0', '200'); assert.equal(mounted.valid(), true);
		assert.deepEqual(mounted.query().predicate, { kind: 'all', terms: [{ kind: 'number', column: 'iso', minimum: 200, maximum: null }] });
		assert.equal(mounted.query().text, 'Still invalid'); assert.equal(mounted.query().sort.field, 'file-name');
	} finally { await mounted.dispose(); }
});

test('a retained scalar edit cannot clear parent-owned invalidity when only validity changes', async () => {
	const mounted = await mount();
	try {
		const oldSort = reactProps(mounted.control('querySort')).onChange;
		await mounted.render({ metadataValid: false });
		await act(async () => { oldSort?.({ currentTarget: { value: 'rating' } }); });
		assert.equal(mounted.valid(), false);
		assert.equal(isPhotoQueryFieldsValidV2(mounted.query(), mounted.valid()), false);
	} finally { await mounted.dispose(); }
});

test('busy controls refuse retained edits while search text stays editable and replaced/unmounted handlers retire', async () => {
	const mounted = await mount();
	try {
		const oldSort = reactProps(mounted.control('querySort')).onChange;
		await mounted.render({ disabled: true });
		await act(async () => { oldSort?.({ currentTarget: { value: 'rating' } }); });
		assert.equal(mounted.query().sort.field, 'photo-id');
		assert.equal(mounted.control('queryText').closest('fieldset'), null);
		await mounted.change('queryText', 'Busy draft'); assert.equal(mounted.query().text, 'Busy draft');
		const oldText = reactProps(mounted.control('queryText')).onChange;
		await mounted.render({ disabled: false, query: { ...initial, text: 'Fresh' } });
		await act(async () => { oldText?.({ currentTarget: { value: 'Retired' } }); });
		assert.equal(mounted.query().text, 'Fresh');
		const retired = reactProps(mounted.control('queryText')).onChange, count = mounted.changes.length;
		await mounted.unmount(); await act(async () => { retired?.({ currentTarget: { value: 'After unmount' } }); });
		assert.equal(mounted.changes.length, count);
	} finally { await mounted.dispose(); }
});

async function mount(overrides: Partial<PhotoQueryFieldsPropsV2> = {}, accept = true) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const changes: { query: PhotoLibraryQueryV2; metadataValid: boolean }[] = [];
	let props: PhotoQueryFieldsPropsV2 = { query: initial, metadataValid: true, disabled: false, ...labels,
		copy: bundledLightscaperEditorCopyForLocale('en'), metadataColumns,
		normalizeMetadataPredicate: predicate => normalizePhotoSmartQueryV2({ schemaVersion: 2, kind: 'photo-smart-query', predicate }).predicate,
		readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }),
		onChange: (query, metadataValid) => { changes.push({ query, metadataValid });
			if (accept) { props = { ...props, query, metadataValid }; root.render(<PhotoQueryFields {...props} />); } }, ...overrides };
	const render = async (next: Partial<PhotoQueryFieldsPropsV2>) => { props = { ...props, ...next }; await act(async () => { root.render(<PhotoQueryFields {...props} />); }); };
	const control = (name: string) => { const node = dom.container.querySelectorAll('input,select,textarea')
		.find(candidate => candidate.name === name || candidate.getAttribute('name') === name);
		assert.ok(node, `Missing control ${name}`); return node; };
	let unmounted = false;
	const unmount = async () => { if (!unmounted) { await act(async () => { root.unmount(); }); unmounted = true; } };
	await render({});
	return { dom, control, changes, render, query: () => props.query, valid: () => props.metadataValid, unmount,
		async change(name: string, value: string) { await act(async () => { reactProps(control(name)).onChange?.({ currentTarget: { value } }); }); },
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async dispose() { try { await unmount(); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
