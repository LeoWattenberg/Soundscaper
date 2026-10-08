/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoQueryDialogCopyV1 } from '../src/common/editor/ui/lightscaper/PhotoQueryDialog.tsx';
import type { PhotoLibraryQueryV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoQueryDialog } = await import('../src/common/editor/ui/lightscaper/PhotoQueryDialog.tsx');
hooks.deregister();

const query: PhotoLibraryQueryV1 = { text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' } };
const copy: PhotoQueryDialogCopyV1 = {
	photoQueryTitle: 'Search, filter and sort', photoQueryText: 'Search text', photoQueryFilter: 'Filter', photoQueryAllPhotos: 'All photos',
	photoQuerySort: 'Sort', photoQueryDirection: 'Direction', photoQuerySortId: 'Photo ID', photoQuerySortFileName: 'Filename',
	photoQuerySortCaptureTime: 'Capture time', photoQuerySortRating: 'Rating', photoQueryAscending: 'Ascending', photoQueryDescending: 'Descending',
	photoQueryFolder: 'Folder', photoQueryKeyword: 'Keyword', photoQueryCollection: 'Collection', photoQueryApply: 'Apply',
	photoQueryBuildIndex: 'Build index', photoQueryResumeIndex: 'Resume index', photoQueryIndexRequired: 'Index required', photoQueryIndexProgress: 'Processed {count}',
	photoDefinitionRoot: 'Root', photoDefinitionUp: 'Up', photoDefinitionNext: 'Next', photoDefinitionReload: 'Reload', photoDefinitionChoose: 'Choose',
	photoDefinitionOpen: 'Open', photoDefinitionClear: 'Clear', photoDefinitionSelected: 'Selected', photoDefinitionEmpty: 'No definitions', photoDefinitionFailed: 'Definitions unavailable',
	photoRating: 'Rating', photoFlag: 'Flag', photoColorLabel: 'Color label', photoWorking: 'Working', photoCloseMetadata: 'Close',
};
const labels = { flags: { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' },
	colorLabels: { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' } };

test('text, exact attribute filter and both global sort directions submit through one opt-in dialog', async () => {
	const applied: PhotoLibraryQueryV1[] = []; let definitions = 0;
	const mounted = await mount({ query, copy, ...labels, busy: false, error: null, needsIndex: false, indexProgress: null,
		onClose: () => undefined, onBuild: () => undefined, onApply: next => { applied.push(next); }, readDefinitions: async () => {
			definitions++; return { rootRevision: 0, rows: [], parent: null, selected: null, cursor: null };
		} });
	try {
		assert.equal(definitions, 0); assert.equal(reactProps(mounted.one('[name="queryText"]')).maxLength as unknown, 256);
		await mounted.change('[name="queryText"]', 'Landscape');
		await mounted.change('[name="queryFilter"]', 'rating'); await mounted.change('[name="queryRating"]', '4');
		await mounted.change('[name="querySort"]', 'capture-time'); await mounted.change('[name="queryDirection"]', 'descending');
		await mounted.submit();
		assert.deepEqual(applied, [{ text: 'Landscape', filter: { kind: 'rating', value: 4 }, sort: { field: 'capture-time', direction: 'descending' } }]);
		assert.equal(definitions, 0); assert.equal(mounted.dom.one('[name="querySort"]').querySelectorAll('option').length, 4);
	} finally { await mounted.dispose(); }
});

test('collection selection is explicit, retains smart/manual distinction and blocks an unselected scope', async () => {
	const applied: PhotoLibraryQueryV1[] = []; const requests: string[] = [];
	const mounted = await mount({ query, copy, ...labels, busy: false, error: null, needsIndex: false, indexProgress: null, onClose: () => undefined,
		onBuild: () => undefined, onApply: next => { applied.push(next); }, readDefinitions: async request => {
			requests.push(request.kind); return { rootRevision: 7, rows: [{ kind: 'collection', id: 'smart', name: 'Live picks', collectionKind: 'smart' }],
				parent: null, selected: request.selectedId ? { kind: 'collection', id: 'smart', name: 'Live picks', collectionKind: 'smart' } : null, cursor: null };
		} });
	try {
		await mounted.change('[name="queryFilter"]', 'collection'); await mounted.submit(); assert.equal(applied.length, 0);
		assert.deepEqual(requests, ['collection']);
		await mounted.click('[data-definition-choose="smart"]'); await mounted.submit();
		assert.equal(applied[0]?.filter?.kind, 'collection'); assert.deepEqual(applied[0]?.filter, { kind: 'collection', id: 'smart' });
		assert.match(mounted.dom.container.textContent, /Live picks/u);
	} finally { await mounted.dispose(); }
});

test('migration never starts on mount and Build/Resume requires its explicit button', async () => {
	let builds = 0, closes = 0, applies = 0;
	const props = { query, copy, ...labels, busy: false, error: 'Catalog changed', needsIndex: true, indexProgress: null,
		onClose: () => { closes++; }, onBuild: () => { builds++; }, onApply: () => { applies++; },
		readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }) };
	const mounted = await mount(props);
	try {
		assert.equal(builds, 0); assert.match(mounted.dom.one('[role="alert"]').textContent, /Catalog changed/u);
		await mounted.submit(); assert.equal(applies, 0);
		await mounted.click('[data-query-build]'); assert.equal(builds, 1);
		await mounted.render({ ...props, indexProgress: { processed: 16, readBytes: 8_388_608, ready: false } });
		assert.equal(mounted.dom.one('[data-query-build]').textContent, 'Resume index');
		await mounted.click('[data-query-close]'); assert.equal(closes, 1); assert.equal(builds, 1);
	} finally { await mounted.dispose(); }
});

test('a pending index probe keeps the initial search input available while persistence actions stay disabled', async () => {
	const applied: PhotoLibraryQueryV1[] = [];
	const props = { query, copy, ...labels, busy: true, error: null, needsIndex: false, indexProgress: null,
		onClose: () => undefined, onBuild: () => undefined, onApply: (next: PhotoLibraryQueryV1) => { applied.push(next); },
		readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }) };
	const mounted = await mount(props);
	try {
		const fieldset = mounted.one('[name="queryText"]').closest('fieldset');
		assert.equal(fieldset ? reactProps(fieldset).disabled : false, false);
		await mounted.change('[name="queryText"]', 'Draft query'); await mounted.submit();
		assert.equal(applied.length, 0);
		await mounted.render({ ...props, busy: false }); await mounted.submit();
		assert.equal(applied[0]?.text, 'Draft query');
	} finally { await mounted.dispose(); }
});

test('choosing a smart collection submits its ID while the selected-label refresh is still pending', async () => {
	const pending = deferred<Awaited<ReturnType<Props['readDefinitions']>>>(), applied: PhotoLibraryQueryV1[] = [];
	const rows = [{ kind: 'collection', id: 'manual', name: 'Manual', collectionKind: 'manual' },
		{ kind: 'collection', id: 'smart', name: 'Live picks', collectionKind: 'smart' }] as const;
	const mounted = await mount({ query: { ...query, filter: { kind: 'collection', id: 'manual' } }, copy, ...labels,
		busy: false, error: null, needsIndex: false, indexProgress: null, onClose: () => undefined, onBuild: () => undefined,
		onApply: next => { applied.push(next); }, readDefinitions: async request => request.selectedId === 'smart' ? pending.promise
			: { rootRevision: 0, rows, parent: null, selected: rows[0], cursor: null } });
	try {
		await mounted.click('[data-definition-choose="smart"]');
		assert.equal(mounted.dom.one('[data-definition-selector="collection"]').getAttribute('aria-busy'), 'true');
		await mounted.submit(); assert.deepEqual(applied[0]?.filter, { kind: 'collection', id: 'smart' });
		await act(async () => { pending.resolve({ rootRevision: 0, rows, parent: null, selected: rows[1], cursor: null }); });
		await mounted.submit(); assert.deepEqual(applied[1]?.filter, { kind: 'collection', id: 'smart' });
	} finally { pending.resolve({ rootRevision: 0, rows, parent: null, selected: rows[1], cursor: null }); await mounted.dispose(); }
});

type Props = React.ComponentProps<typeof PhotoQueryDialog>;
async function mount(props: Props) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async (next: Props) => { await act(async () => { root.render(<PhotoQueryDialog {...next} />); }); };
	const one = (selector: string) => {
		const name = /^\[name="([^"]+)"\]$/u.exec(selector)?.[1];
		const node = name ? dom.container.querySelectorAll('input,select').find(candidate => candidate.name === name || candidate.getAttribute('name') === name) : dom.find(selector);
		assert.ok(node, `Missing mounted control ${selector}`); return node;
	};
	await render(props);
	return { dom, one, render, async change(selector: string, value: string) { await act(async () => { reactProps(one(selector)).onChange?.({ currentTarget: { value } }); }); },
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async submit() { await act(async () => { reactProps(dom.one('form')).onSubmit?.({ preventDefault() {} }); }); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
