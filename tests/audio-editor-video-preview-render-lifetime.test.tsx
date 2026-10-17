/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useVideoPreviewRenderLifetime } from '../src/common/editor/ui/workspace/use-video-preview-render-lifetime.ts';
import { invalidateEnginePlayhead } from '../src/common/editor/engine/playhead-discontinuity.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

test('mounted compositor replacement joins the actual held exact frame and Session before disposing GPU resources or opening a new generation', async () => {
	const held = deferred<void>(), session = deferred<void>(); let engine = {}, creates = 0, disposes = 0, signal!: AbortSignal;
	let lifetime!: ReturnType<typeof useVideoPreviewRenderLifetime<{ dispose(): void }>>;
	const canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	const create = () => { creates++; return { dispose() { disposes++; } }; };
	const joinSession = () => session.promise;
	function View() { lifetime = useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create, joinSession,
		requestFrame() {}, onReady() {}, onFailure() {}, onContextLost() {}, onRetire() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		const old = compositorRef.current; assert.equal(creates, 1);
		const render = lifetime.coordinatorRef.current!.run({ render: async nativeSignal => { signal = nativeSignal; await held.promise; },
			isCurrent: () => true, publish() { assert.fail('retired frame'); }, onError() {} });
		engine = {}; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(signal.aborted, true); assert.equal(compositorRef.current, null); assert.equal(creates, 1); assert.equal(disposes, 0);
		held.resolve(); await render; await act(async () => { await settle(); }); assert.equal(disposes, 0);
		session.resolve(); await act(async () => { await settle(); }); assert.equal(disposes, 1); assert.equal(creates, 2); assert.notEqual(compositorRef.current, old);
	} finally { held.resolve(); session.resolve(); await mounted.dispose(); await settle(); }
	assert.equal(disposes, 2);
});

test('the mounted engine discontinuity synchronously blocks publication and only resumes after the real frame join; continuous demand publishes', async () => {
	const engine = {}, held = deferred<void>(); let signal!: AbortSignal, publishes = 0, requests = 0;
	let lifetime!: ReturnType<typeof useVideoPreviewRenderLifetime<{ dispose(): void }>>;
	const canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	const create = () => ({ dispose() {} });
	function View() { lifetime = useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create, joinSession: async () => undefined,
		requestFrame() { requests++; }, onReady() {}, onFailure() {}, onContextLost() {}, onRetire() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		const render = lifetime.coordinatorRef.current!.run({ render: async nativeSignal => { signal = nativeSignal; await held.promise; },
			isCurrent: () => true, publish() { publishes++; }, onError() {} });
		invalidateEnginePlayhead(engine); assert.equal(signal.aborted, true); assert.equal(lifetime.mayRender(), false);
		const before = requests; held.resolve(); await render; await act(async () => { await settle(); });
		assert.equal(publishes, 0); assert.equal(lifetime.mayRender(), true); assert.equal(requests, before + 1);
		const second = deferred<void>(); const next = lifetime.coordinatorRef.current!.run({ render: async () => { await second.promise; },
			isCurrent: () => true, publish() { publishes++; }, onError() {} });
		for (let index = 0; index < 20; index++) lifetime.coordinatorRef.current!.deferWhileActive();
		second.resolve(); await next; assert.equal(publishes, 1);
	} finally { held.resolve(); await mounted.dispose(); await settle(); }
});

test('a failed compositor retirement blocks a later mounted factory and uses scalar diagnostics without inspecting the opaque reason', async () => {
	let traps = 0, creates = 0, failures = 0, engine = {};
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	const create = () => { creates++; return { dispose() { throw reason; } }; };
	function View() { useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create, joinSession: async () => undefined,
		requestFrame() {}, onReady() {}, onFailure() { failures++; }, onContextLost() {}, onRetire() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try { engine = {}; await mounted.render(); await act(async () => { await settle(); }); assert.equal(creates, 1); assert.equal(failures, 1); assert.equal(traps, 0); }
	finally { await mounted.dispose(); await settle(); }
});

test('StrictMode replay waits the predecessor Session drain before creating one live compositor', async () => {
	const held = deferred<void>(); let joins = 0, creates = 0, disposes = 0;
	const engine = {}, canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	const create = () => { creates++; return { dispose() { disposes++; } }; };
	function View() { useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create,
		joinSession: () => ++joins === 1 ? held.promise : Promise.resolve(), requestFrame() {}, onReady() {}, onFailure() {}, onContextLost() {}, onRetire() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <React.StrictMode><View /></React.StrictMode>);
	try {
		assert.equal(joins, 1); assert.equal(creates, 0);
		held.resolve(); await act(async () => { await settle(); }); assert.equal(creates, 1); assert.equal(disposes, 0);
	} finally { held.resolve(); await mounted.dispose(); await settle(); }
	assert.equal(disposes, 1);
});

test('Session replacement keeps rendering closed after the hard join until the exact replacement publication resumes it', async () => {
	const engine = {}, canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	let lifetime!: ReturnType<typeof useVideoPreviewRenderLifetime<{ dispose(): void }>>;
	const create = () => ({ dispose() {} });
	function View() { lifetime = useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create, joinSession: async () => undefined,
		requestFrame() {}, onReady() {}, onFailure() {}, onContextLost() {}, onRetire() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		assert.equal(lifetime.mayRender(), true); const replacing = lifetime.beforeReplace(); assert.equal(lifetime.mayRender(), false);
		await replacing; await lifetime.supersede(); assert.equal(lifetime.mayRender(), false);
		lifetime.afterReplace(); assert.equal(lifetime.mayRender(), true);
	} finally { await mounted.dispose(); await settle(); }
});

test('a mounted generation captures its own Session retirement method before the caller replaces that capability', async () => {
	const held = deferred<void>(), oldEngine = {}, nextEngine = {}; let engine = oldEngine, oldJoins = 0, nextJoins = 0, creates = 0;
	const canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	const create = () => { creates++; return { dispose() {} }; };
	const oldJoin = () => { oldJoins++; return held.promise; }, nextJoin = async () => { nextJoins++; };
	function View() { useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create, joinSession: engine === oldEngine ? oldJoin : nextJoin,
		requestFrame() {}, onReady() {}, onFailure() {}, onContextLost() {}, onRetire() {} }); return <output />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		engine = nextEngine; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(oldJoins, 1); assert.equal(nextJoins, 0); assert.equal(creates, 1);
		held.resolve(); await act(async () => { await settle(); }); assert.equal(creates, 2);
	} finally { held.resolve(); await mounted.dispose(); await settle(); }
	assert.equal(nextJoins, 1);
});

test('an observer setup failure retires the captured generation before asynchronous GPU creation and uses only the fixed failure callback', async () => {
	let creates = 0, failures = 0, disconnects = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
		observe() { throw reason; } disconnect() { disconnects++; }
	} });
	const engine = {}, canvasRef = { current: {} as HTMLCanvasElement }, compositorRef = { current: null as { dispose(): void } | null };
	const create = () => { creates++; return { dispose() {} }; };
	function View() { useVideoPreviewRenderLifetime({ engine, canvasRef, compositorRef, create, joinSession: async () => undefined,
		requestFrame() {}, onReady() {}, onFailure() { failures++; }, onContextLost() {}, onRetire() {} }); return <output />; }
	class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
		state = { failed: false };
		static getDerivedStateFromError() { return { failed: true }; }
		render() { return this.state.failed ? <output /> : this.props.children; }
	}
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	try { mounted = await mountPhotoImportUi(() => <Boundary><View /></Boundary>); await act(async () => { await settle(); });
		assert.equal(creates, 0); assert.equal(disconnects, 1); assert.equal(failures, 1); assert.equal(traps, 0);
	} finally { if (mounted) await mounted.dispose(); await settle();
		if (prior) Object.defineProperty(globalThis, 'ResizeObserver', prior); else Reflect.deleteProperty(globalThis, 'ResizeObserver'); }
});
