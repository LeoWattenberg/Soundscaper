/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageDevelopDraftPresentationV1, type ImageDevelopDraftPresentationPortsV1,
	type WithImageDevelopDraftFrameV1 } from '../src/common/editor/controller/shared/image-develop-draft-presentation-v1.ts';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const ORIGINAL = [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255];
const AFTER = [188, 188, 188, 255, 0, 0, 0, 255], COVERAGE = [255, 0];
const selection = Object.freeze({ maskId: 'range', effectId: 'tone' });
function recipe() {
	const repair = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
		target: { x: .5, y: .5 }, source: { x: 1 / 6, y: .5 }, radius: .2, feather: 0, opacity: 1 }] });
	return normalizeImageDevelopStateCurrentV1({ ...repair, effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 1 / 3, cropWidth: 2 / 3, flipHorizontal: 1 } })],
		masks: [{ schemaVersion: 1, id: 'range', kind: 'matte', inputs: [], nodes: [{ id: 'range', kind: 'luminance-range', lower: .9, upper: 1, falloff: 0 }], outputNodeId: 'range' }],
		maskBindings: [{ maskId: 'range', effectId: 'tone' }] });
}
// The callback seam supplies a bounded Original; actual Frame pack admission is
// separately owned by the native Session suite. Repair/range/geometry execution
// and display scopes below are the maintained engines, with literal oracles.
function fixture() {
	const after = {} as HTMLCanvasElement, overlay = {} as HTMLCanvasElement, planes = new Map<HTMLCanvasElement, number[]>();
	const backings: PixelFrameV1['pixels'][] = [], requests: Parameters<WithImageDevelopDraftFrameV1>[0][] = [];
	let current = true, active = 0, maximum = 0;
	const hooks = { afterPaint: async (): Promise<void> => undefined };
	const render: WithImageDevelopDraftFrameV1 = async (request, consume, options) => {
		requests.push(request); active++; maximum = Math.max(maximum, active);
		const frame = rgbaFrame(ORIGINAL); backings.push(frame.pixels);
		try { return await withImageDevelopFrameV3({ frame, ...request, ...(options?.signal ? { signal: options.signal } : {}) }, async output => {
			backings.push(output.frame.pixels); if (output.maskOverlay) backings.push(output.maskOverlay.coverage);
			const result = await consume(output); await hooks.afterPaint(); return result;
		}, PROFILE); } finally { frame.pixels.fill(0); active--; }
	};
	const ports: ImageDevelopDraftPresentationPortsV1 = {
		withDraftFrame(request, consume, options) { assert.equal(this, ports); return render(request, consume, options); },
		isCurrent() { assert.equal(this, ports); return current; },
		paint(canvas, frame) { assert.equal(this, ports); planes.set(canvas, [...frame.pixels]); backings.push(frame.pixels);
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; },
		clear(canvas) { assert.equal(this, ports); planes.delete(canvas); },
	};
	return { owner: new ImageDevelopDraftPresentationV1(ports), ports, after, overlay, planes, backings, requests, hooks,
		maximum: () => maximum, retireSource() { current = false; } };
}

test('neutral draft presentation shows literal repaired effect-input range coverage after geometry, with mode absent from native requests', async () => {
	const f = fixture(), develop = recipe(), wire = JSON.stringify(develop);
	try {
		f.owner.setView({ develop, after: f.after }); await f.owner.drain(); assert.deepEqual(f.planes.get(f.after), AFTER);
		assert.equal(f.planes.has(f.overlay), false); assert.equal(Object.hasOwn(f.requests[0]!, 'maskOverlay'), false);
		for (const mode of ['color', 'grayscale'] as const) {
			f.owner.setView({ develop, after: f.after, overlay: f.overlay, maskOverlay: selection, maskOverlayMode: mode }); await f.owner.drain();
			assert.deepEqual(f.planes.get(f.after), AFTER);
			assert.deepEqual(f.planes.get(f.overlay), COVERAGE.flatMap(value => mode === 'grayscale' ? [value, value, value, 255] : [255, 48, 48, value]));
			assert.equal(f.owner.snapshot().status, 'ready'); assert.deepEqual(f.owner.snapshot().extent, { width: 2, height: 1 });
			assert.deepEqual(f.requests.at(-1)?.maskOverlay, selection); assert.equal(Object.hasOwn(f.requests.at(-1)!, 'maskOverlayMode'), false);
		}
		assert.equal(JSON.stringify(develop), wire); assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
		await f.owner.close(); assert.equal(f.planes.size, 0);
	} finally { await f.owner.close(); }
});

test('neutral presenter pins all actual callback receivers before lazy work and never evaluates later port replacements', async () => {
	const f = fixture();
	for (const key of ['withDraftFrame', 'isCurrent', 'paint', 'clear']) Object.defineProperty(f.ports, key, { get() { assert.fail('An admitted presenter must keep its captured callback.'); } });
	try { f.owner.setView({ develop: recipe(), after: f.after }); await f.owner.drain();
		assert.equal(f.requests.length, 1); assert.deepEqual(f.planes.get(f.after), AFTER); await f.owner.close(); assert.equal(f.planes.size, 0);
	} finally { await f.owner.close(); }
});

test('replacement clears old targets, joins the held actual render and starts only the latest request after native retirement', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(); let once = true;
	f.hooks.afterPaint = async () => { if (once) { once = false; entered.resolve(); await release.promise; } };
	try {
		f.owner.setView({ develop: recipe(), after: f.after, overlay: f.overlay, maskOverlay: selection });
		assert.equal(await Promise.race([entered.promise.then(() => true), f.owner.drain().then(() => false)]), true);
		assert.equal(f.owner.snapshot().status, 'pending'); assert.equal(await remainsPending(f.owner.drain()), true);
		f.owner.setView({ develop: recipe(), after: f.after, overlay: f.overlay, maskOverlay: selection, maskOverlayMode: 'grayscale' });
		f.owner.setView({ develop: recipe(), after: f.after }); await settle(); assert.equal(f.requests.length, 1); assert.equal(f.planes.size, 0);
		release.resolve(); await f.owner.drain(); assert.equal(f.requests.length, 2); assert.equal(f.maximum(), 1);
		assert.equal(Object.hasOwn(f.requests[1]!, 'maskOverlay'), false); assert.deepEqual(f.planes.get(f.after), AFTER);
		assert.equal(f.planes.has(f.overlay), false); assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await f.owner.close(); }
});

test('pause and Close seal synchronously but readiness and retirement wait for the real callback lifetime', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.afterPaint = async () => { entered.resolve(); await release.promise; };
	try {
		f.owner.setView({ develop: recipe(), after: f.after, overlay: f.overlay, maskOverlay: selection });
		await entered.promise; const paused = f.owner.pause(), closing = f.owner.close(); assert.equal(f.owner.close(), closing);
		assert.equal(f.planes.size, 0); assert.equal(await remainsPending(paused), true); assert.equal(await remainsPending(closing), true);
		f.owner.setView({ develop: recipe(), after: f.after }); assert.equal(f.requests.length, 1);
		release.resolve(); await paused; await closing; assert.notEqual(f.owner.snapshot().status, 'ready');
		assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0))); assert.equal(f.requests.length, 1);
	} finally { release.resolve(); await f.owner.close(); }
});

test('a replacement queued during pause regains both canvas targets after the held prior native scope joins', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(); let first = true;
	f.hooks.afterPaint = async () => { if (first) { first = false; entered.resolve(); await release.promise; } };
	try {
		f.owner.setView({ develop: recipe(), after: f.after }); await entered.promise;
		const paused = f.owner.pause(); f.owner.setView({ develop: recipe(), after: f.after, overlay: f.overlay, maskOverlay: selection });
		assert.equal(await remainsPending(paused), true); assert.equal(f.requests.length, 1);
		release.resolve(); await paused; await f.owner.drain(); assert.equal(f.requests.length, 2);
		assert.deepEqual(f.planes.get(f.after), AFTER); assert.deepEqual(f.planes.get(f.overlay), [255, 48, 48, 255, 255, 48, 48, 0]);
		await f.owner.close(); assert.equal(f.planes.size, 0); assert.equal(f.maximum(), 1);
	} finally { release.resolve(); await f.owner.close(); }
});

test('stale source fences canvas writes after a native callback yields and retains a joinable failure', async () => {
	const entered = deferred<void>(), release = deferred<void>(), painted: number[] = []; let current = true;
	const ports: ImageDevelopDraftPresentationPortsV1 = { isCurrent: () => current, clear: () => undefined,
		withDraftFrame: async (request, consume, options) => { entered.resolve(); await release.promise;
			const frame = rgbaFrame(ORIGINAL); try { return await withImageDevelopFrameV3({ frame, ...request, signal: options?.signal }, consume, PROFILE); } finally { frame.pixels.fill(0); } },
		paint: (_canvas, frame) => { painted.push(frame.pixels.byteLength); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; } };
	const owner = new ImageDevelopDraftPresentationV1(ports);
	try { owner.setView({ develop: recipe(), after: {} as HTMLCanvasElement }); await entered.promise; current = false; release.resolve();
		await assert.rejects(owner.drain()); assert.equal(painted.length, 0); assert.equal(owner.snapshot().status, 'failed');
	} finally { release.resolve(); await owner.close().catch(() => undefined); }
});

test('opaque cleanup failure after replacement cancellation survives drain and idempotent Close without coercion', async () => {
	const entered = deferred<void>(), release = deferred<void>(), { proxy, revoke } = Proxy.revocable({}, {}); revoke();
	const owner = new ImageDevelopDraftPresentationV1({ isCurrent: () => true, clear: () => undefined,
		withDraftFrame: async () => { entered.resolve(); await release.promise; throw proxy; } });
	owner.setView({ develop: recipe(), after: {} as HTMLCanvasElement }); await entered.promise;
	const closing = owner.close(); assert.equal(await remainsPending(closing), true); release.resolve();
	for (const work of [closing, owner.drain()]) {
		const result = await work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, proxy), true);
	}
	assert.equal(owner.close(), closing);
});
