/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoPreviewPanel from '../src/common/editor/ui/workspace/VideoPreviewPanel.jsx';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { ReactTestElement } from './helpers/react-test-dom.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const frame = { layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
	ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] } };
const project = { id: 'preview', revision: 1, sampleRate: 48_000, tracks: [], clips: [], sources: [] };

async function mountedHeldPanel() {
	const held = deferred<void>(), cleanup = deferred<void>(); let signal: AbortSignal | undefined, reads = 0, deletes = 0;
	const controller = { actions: {}, engine: { sampleRate: 48_000, getPositionFrames: () => 0 },
		getTelemetrySnapshot: () => ({ positionFrame: 0, transportState: 'playing', playbackRate: 1 }), subscribeTelemetry: () => () => undefined };
	let currentController = controller;
	bindProductVideoVisualPreviewRuntime(controller, createProductVideoVisualPreviewRuntime(async () => ({
		exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {}, close: () => cleanup.promise,
		async renderExact(request) { reads++; signal = request.signal; await held.promise; return { frame, layers: [], renderedEffectIds: [] }; },
	})));
	const prototype = ReactTestElement.prototype;
	const priorContext = Object.getOwnPropertyDescriptor(prototype, 'getContext');
	Object.defineProperty(prototype, 'getContext', { configurable: true, value() { return new Proxy({}, { get(_target, key) {
		return () => { if (key === 'deleteProgram') deletes++; return key === 'getShaderParameter' || key === 'getProgramParameter' ? true : {}; };
	} }); } });
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const queued = new Map<number, FrameRequestCallback>(); let nextId = 0;
	let installed = false;
	function View() {
		if (!installed) { installed = true; Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true,
			value(callback: FrameRequestCallback) { const id = ++nextId; queued.set(id, callback); return id; } });
			Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value(id: number) { queued.delete(id); } }); }
		return <VideoPreviewPanel controller={currentController} snapshot={{ project, missingSourceIds: [] }} copy={ENGLISH_COPY} run={() => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <View />);
	const flush = async () => { await act(async () => {
		const entry = queued.entries().next().value; assert.ok(entry); queued.delete(entry[0]); entry[1](0); await settle();
	}); };
	await flush();
	return { held, cleanup, mounted, controller, flush, signal: () => signal, reads: () => reads, deletes: () => deletes,
		async replaceController(next: typeof controller) { currentController = next; await mounted.render(); await act(async () => { await settle(); }); },
		async restore() {
			held.resolve(); cleanup.resolve(); await mounted.dispose(); await settle();
			if (priorContext) Object.defineProperty(prototype, 'getContext', priorContext); else Reflect.deleteProperty(prototype, 'getContext');
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		} };
}

test('the actual playing Panel passes its native coordinator signal to the resource-capable Session', async () => {
	const fixture = await mountedHeldPanel();
	try { assert.equal(fixture.reads(), 1); assert.ok(fixture.signal() instanceof AbortSignal); }
	finally { await fixture.restore(); }
});

test('the actual Panel unmount revokes its held request and waits both frame and Session before disposing its compositor', async () => {
	const fixture = await mountedHeldPanel();
	try {
		await fixture.mounted.dispose(); assert.equal(fixture.deletes(), 0);
		assert.equal(fixture.signal()?.aborted, true);
		fixture.held.resolve(); await settle(); assert.equal(fixture.deletes(), 0);
		fixture.cleanup.resolve(); await settle(); assert.ok(fixture.deletes() > 0);
	} finally { await fixture.restore(); }
});

test('actual controller replacement closes only its captured old Session and leaves the new Session alive after the held frame and cleanup join', async () => {
	const fixture = await mountedHeldPanel(); let factories = 0, closes = 0, reads = 0;
	const next = { ...fixture.controller, engine: { ...fixture.controller.engine } };
	bindProductVideoVisualPreviewRuntime(next, createProductVideoVisualPreviewRuntime(async () => {
		factories++; return { exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {},
			async close() { closes++; }, async renderExact() { reads++; return { frame, layers: [], renderedEffectIds: [] }; } };
	}));
	try {
		await fixture.replaceController(next); assert.equal(fixture.signal()?.aborted, true); assert.equal(factories, 0);
		fixture.held.resolve(); await act(async () => { await settle(); }); assert.equal(factories, 0);
		fixture.cleanup.resolve(); await act(async () => { await settle(); }); assert.equal(factories, 1); assert.equal(closes, 0);
		await fixture.flush(); assert.equal(reads, 1);
	} finally { await fixture.restore(); }
	assert.equal(closes, 1);
});
