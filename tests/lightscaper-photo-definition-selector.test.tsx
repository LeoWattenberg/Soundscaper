/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PhotoDefinitionSelector, { type PhotoDefinitionSelectorCopyV1 } from '../src/common/editor/ui/lightscaper/PhotoDefinitionSelector.tsx';
import type { PhotoLibraryDefinitionPageV1, PhotoLibraryDefinitionRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const copy: PhotoDefinitionSelectorCopyV1 = { photoDefinitionRoot: 'Root', photoDefinitionUp: 'Up', photoDefinitionNext: 'Next',
	photoDefinitionReload: 'Reload', photoDefinitionChoose: 'Choose', photoDefinitionOpen: 'Open', photoDefinitionClear: 'Clear',
	photoDefinitionSelected: 'Selected', photoDefinitionEmpty: 'No definitions', photoDefinitionFailed: 'Definitions unavailable', photoWorking: 'Working' };
const node = (id: string, parentId: string | null = null): PhotoLibraryDefinitionRowV1 => ({ kind: 'folder', id, name: `Folder ${id}`, parentId });
const page = (rows: readonly PhotoLibraryDefinitionRowV1[], cursor: string | null = null): PhotoLibraryDefinitionPageV1 =>
	({ rootRevision: 0, rows, cursor, parent: null, selected: null });

test('the selector keeps one64-row page, pages explicitly and opens/up/root without accumulating ancestors', async () => {
	const calls: Array<{ parentId?: string | null; cursor?: string | null }> = [];
	const chosen: Array<PhotoLibraryDefinitionRowV1 | null> = [];
	const mounted = await mount({ kind: 'folder', selectedId: null, copy, onSelect: row => { chosen.push(row); }, readPage: async request => {
		calls.push(request);
		if (request.parentId === '65') return { ...page([node('child', '65')]), parent: { id: '65', name: 'Folder 65', parentId: null } };
		return request.cursor ? page([node('65')]) : page(Array.from({ length: 64 }, (_, i) => node(String(i))), 'next');
	} });
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-definition-id]').length, 64); assert.equal(calls.length, 1);
		await mounted.click('[data-definition-next]');
		assert.equal(mounted.dom.container.querySelectorAll('[data-definition-id]').length, 1); assert.equal(calls[1]?.cursor, 'next');
		await mounted.click('[data-definition-open="65"]');
		assert.equal(calls.at(-1)?.parentId, '65'); assert.equal(mounted.dom.one('[data-definition-parent]').textContent, 'Folder 65');
		await mounted.click('[data-definition-choose="child"]'); assert.equal(chosen[0]?.id, 'child');
		await mounted.click('[data-definition-up]'); assert.equal(calls.at(-1)?.parentId, null);
		assert.equal(mounted.dom.container.querySelectorAll('[data-definition-id]').length, 64);
	} finally { await mounted.dispose(); }
});

test('a replaced reader aborts the old demand and its late page cannot replace fresh rows', async () => {
	const delayed = deferred<PhotoLibraryDefinitionPageV1>(); let signal: AbortSignal | undefined;
	const props = { kind: 'folder' as const, selectedId: null, copy, onSelect: () => undefined,
		readPage: async (request: { signal?: AbortSignal }) => { signal = request.signal; return delayed.promise; } };
	const mounted = await mount(props);
	try {
		assert.equal(signal?.aborted, false);
		await mounted.render({ ...props, readPage: async () => page([node('fresh')]) });
		assert.equal(signal?.aborted, true); assert.ok(mounted.dom.find('[data-definition-id="fresh"]'));
		await act(async () => { delayed.resolve(page([node('old')])); await Promise.resolve(); });
		assert.equal(mounted.dom.find('[data-definition-id="old"]'), null);
	} finally { delayed.resolve(page([])); await mounted.dispose(); }
});

test('revision errors remain visible until explicit reload, and unmount aborts demand', async () => {
	let reads = 0, signal: AbortSignal | undefined;
	const mounted = await mount({ kind: 'folder', selectedId: null, copy, onSelect: () => undefined, readPage: async request => {
		reads++; signal = request.signal; if (reads === 1) throw new Error('Catalog revision changed'); return page([node('fresh')]);
	} });
	try {
		assert.match(mounted.dom.one('[role="alert"]').textContent, /revision changed/u); assert.equal(reads, 1);
		await mounted.click('[data-definition-reload]'); assert.equal(reads, 2); assert.equal(mounted.dom.find('[role="alert"]'), null);
		assert.ok(mounted.dom.find('[data-definition-id="fresh"]'));
	} finally { await mounted.dispose(); }
	assert.equal(signal?.aborted, true);
});

type Props = React.ComponentProps<typeof PhotoDefinitionSelector>;
async function mount(props: Props) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async (next: Props) => { await act(async () => { root.render(<PhotoDefinitionSelector {...next} />); }); };
	await render(props);
	return { dom, render, async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
