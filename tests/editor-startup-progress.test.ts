/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import {
	createEditorStartupProgressStore,
	parseEditorStartupAssetInventory,
} from '../src/common/site/editor-startup-progress.ts';
import { EditorStartupProgress } from '../src/common/site/EditorStartupProgress.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const INVENTORY = {
	schemaVersion: 1,
	productId: 'framescaper',
	assets: [
		{ path: '/assets/entry.js', rawBytes: 20 },
		{ path: '/assets/editor.js', rawBytes: 70 },
		{ path: '/assets/editor.css', rawBytes: 10 },
	],
};

test('startup progress counts completed asset bytes once, including cached resources', () => {
	const store = createEditorStartupProgressStore();
	store.configure(parseEditorStartupAssetInventory(INVENTORY, 'framescaper'));
	assert.deepEqual(store.getSnapshot(), { phase: 'loading', percent: 0 });
	store.recordResource('/assets/entry.js', { decodedBodySize: 20, responseStatus: 200 });
	assert.deepEqual(store.getSnapshot(), { phase: 'loading', percent: 20 });
	store.recordResource('/assets/entry.js', { decodedBodySize: 20, responseStatus: 200 });
	store.recordResource('/assets/other.js', { decodedBodySize: 500, responseStatus: 200 });
	store.recordResource('/assets/editor.css', { decodedBodySize: 10, responseStatus: 200, transferSize: 0 });
	assert.deepEqual(store.getSnapshot(), { phase: 'loading', percent: 30 });
	store.recordResource('/assets/editor.js', { decodedBodySize: 70, responseStatus: 200 });
	assert.deepEqual(store.getSnapshot(), { phase: 'loading', percent: 100 });
	store.markPreparing();
	assert.deepEqual(store.getSnapshot(), { phase: 'preparing', percent: null });
	store.finish();
	assert.deepEqual(store.getSnapshot(), { phase: 'ready', percent: null });
});

test('startup progress ignores failed resources and remains unnumbered without timing', () => {
	const store = createEditorStartupProgressStore();
	assert.deepEqual(store.getSnapshot(), { phase: 'indeterminate', percent: null });
	store.recordResource('/assets/entry.js', { decodedBodySize: 20, responseStatus: 200 });
	assert.deepEqual(store.getSnapshot(), { phase: 'indeterminate', percent: null });
	store.configure(parseEditorStartupAssetInventory(INVENTORY, 'framescaper'));
	store.recordResource('/assets/entry.js', { decodedBodySize: 0, responseStatus: 404 });
	assert.deepEqual(store.getSnapshot(), { phase: 'loading', percent: 0 });
	store.recordResource('/assets/entry.js', { decodedBodySize: 20, responseStatus: 200 });
	assert.deepEqual(store.getSnapshot(), { phase: 'loading', percent: 20 });
});

test('startup inventory refuses a peer product, duplicate path, and invented size', () => {
	assert.throws(() => parseEditorStartupAssetInventory(INVENTORY, 'soundscaper'), /product/iu);
	assert.throws(() => parseEditorStartupAssetInventory({ ...INVENTORY,
		assets: [...INVENTORY.assets, INVENTORY.assets[0]],
	}, 'framescaper'), /duplicate/iu);
	assert.throws(() => parseEditorStartupAssetInventory({ ...INVENTORY,
		assets: [{ path: '/assets/entry.js', rawBytes: 0 }],
	}, 'framescaper'), /size/iu);
});

test('the editor-area indicator changes from a real percentage to unnumbered preparation', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const store = createEditorStartupProgressStore();
	try {
		act(() => root.render(React.createElement(EditorStartupProgress, { store })));
		assert.equal(dom.one('progress').hasAttribute('value'), false);
		act(() => store.configure(parseEditorStartupAssetInventory(INVENTORY, 'framescaper')));
		act(() => store.recordResource('/assets/entry.js', { decodedBodySize: 20, responseStatus: 200 }));
		assert.equal(dom.one('progress').getAttribute('value'), '20');
		assert.match(dom.one('[data-editor-startup-progress]').textContent ?? '', /20%/u);
		act(() => store.markPreparing());
		assert.equal(dom.one('progress').hasAttribute('value'), false);
		assert.match(dom.one('[data-editor-startup-progress]').textContent ?? '', /Preparing editor/u);
		act(() => root.unmount());
	} finally {
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
