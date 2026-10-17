/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/use-product-video-visual-preview-session.ts';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime, type ProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const frame = { layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
	ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] } };
const session = (close: () => Promise<void>): ProductVideoVisualPreviewSession => ({ resolve: () => frame, resolveTransitionWeight: () => null, dispose() {}, close });

test('the actual preview hook joins old native frame retirement before the replacement factory and unmount closes the replacement', async () => {
	const owner = {}, held = deferred<void>(); let project = { revision: 1 }, calls = 0, closes = 0;
	bindProductVideoVisualPreviewRuntime(owner, createProductVideoVisualPreviewRuntime(async () => {
		calls++; return session(() => { closes++; return calls === 1 ? held.promise : Promise.resolve(); });
	}));
	function View() { const value = useProductVideoVisualPreviewSession({ owner, project, width: 2, height: 2, requestFrame() {} });
		return <output>{String(value.state.pending)}</output>; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		assert.equal(calls, 1); project = { revision: 2 }; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(closes, 1); assert.equal(calls, 1);
		held.resolve(); await act(async () => { await settle(); }); assert.equal(calls, 2);
	} finally { held.resolve(); await mounted.dispose(); await settle(); }
	assert.equal(closes, 2);
});

test('a held old factory cannot publish or overlap a replacement and its late native cleanup is joined', async () => {
	const owner = {}, factory = deferred<ProductVideoVisualPreviewSession>(), held = deferred<void>();
	let project = { revision: 1 }, calls = 0, closes = 0;
	bindProductVideoVisualPreviewRuntime(owner, createProductVideoVisualPreviewRuntime(async () => {
		calls++; return calls === 1 ? factory.promise : session(async () => { closes++; });
	}));
	function View() { useProductVideoVisualPreviewSession({ owner, project, width: 2, height: 2, requestFrame() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		project = { revision: 2 }; await mounted.render();
		factory.resolve(session(() => { closes++; return held.promise; })); await act(async () => { await settle(); });
		assert.equal(closes, 1); assert.equal(calls, 1); held.resolve(); await act(async () => { await settle(); }); assert.equal(calls, 2);
	} finally { factory.resolve(session(async () => undefined)); held.resolve(); await mounted.dispose(); await settle(); }
});

test('an opaque failed old target retirement blocks later hook factories without inspecting the reason', async () => {
	const owner = {}; let project = { revision: 1 }, calls = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	bindProductVideoVisualPreviewRuntime(owner, createProductVideoVisualPreviewRuntime(async () => { calls++; return session(() => Promise.reject(reason)); }));
	function View() { const value = useProductVideoVisualPreviewSession({ owner, project, width: 2, height: 2, requestFrame() {}, failureMessage: 'Preview unavailable' });
		return <output>{value.state.error}</output>; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		project = { revision: 2 }; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(calls, 1); assert.equal(traps, 0); assert.equal(mounted.dom.one('output').textContent, 'Preview unavailable');
		project = { revision: 3 }; await mounted.render(); await act(async () => { await settle(); }); assert.equal(calls, 1);
	} finally { await mounted.dispose(); await settle(); }
});
