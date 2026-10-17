/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperSelectedTimelineFilmstripFinishing as filmstrip } from '../src/framescaper/editor-selected-finishing-timeline-filmstrip.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const parsed = parseCubeLutV1(TEXT), body = new TextEncoder().encode(TEXT);
const ref = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength,
	size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
const source = [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
const expected = [0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255];

function project() {
	const rate = { num: 10, den: 1 };
	return createFramescaperProjectFinishing(PROFILE, { id: 'strip', title: 'Strip', now: '2026-10-09T00:00:00.000Z',
		sources: [createVideoSource({ id: 'source', name: 'Pixels', storageKey: 'original', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			frameCount: 4800, sampleFrameCount: 4800, sourceFrameCount: 1, frameRate: rate, width: 2, height: 2 })],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'source', title: 'Pixels', sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null,
			videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: ref } }] }],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate, trackIds: ['track'] }], primarySequenceId: 'main',
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] } });
}

function surfaces(t: TestContext, clearFailure?: unknown) {
	const previous = ['document', 'ImageData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	const writes: number[][] = [], outputs: Uint8ClampedArray[] = []; let clears = 0, armed = false;
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
		let written: Uint8ClampedArray | undefined;
		return { width: 2, height: 2, getContext() { return {
			drawImage() {}, clearRect() { clears++; if ((written || armed) && clearFailure !== undefined) throw clearFailure; },
			getImageData() { return { data: written ?? new Uint8ClampedArray(source) }; },
			putImageData(image: { data: Uint8ClampedArray }) { written = image.data; outputs.push(image.data); writes.push(Array.from(image.data)); },
		}; } };
	} } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	} });
	t.after(() => { for (const [key, descriptor] of previous) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	return { writes, outputs, armCleanupFailure() { armed = true; }, get clears() { return clears; } };
}

function options(signal: AbortSignal, loadMediaAsset: (key: string, options?: { signal?: AbortSignal }) => Promise<Blob>) {
	return { profile: PROFILE, project: project(), width: 2, height: 2, signal, store: { loadMediaAsset } as never,
		frames: [{ key: 'cell', clipId: 'clip', sourceId: 'source', timelineSample: 0, sourceUrl: 'blob:cell' }] };
}

test('current filmstrip publishes the literal V27 pixels only after its exact Session output is retired', async t => {
	const dom = surfaces(t); let decoded = 0;
	const result = await filmstrip({ ...options(new AbortController().signal, async () => new Blob([body])),
		async decodeSource() { return { width: 2, height: 2, drawable: {}, dispose() { decoded++; } }; } });
	assert.equal(result?.length, 1); assert.deepEqual(Array.from(result![0]!.pixels), expected);
	assert.equal(decoded, 1); assert.ok(dom.clears > 0); assert.deepEqual(dom.writes, [expected]);
});

test('held filmstrip LUT work receives and joins opaque native cancellation before it can paint', async t => {
	const dom = surfaces(t), held = deferred<void>(), entered = deferred<void>(), stop = new AbortController();
	let nativeSignal: AbortSignal | undefined, joined = false, decoded = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const work = filmstrip({ ...options(stop.signal, async (_key, port) => {
		nativeSignal = port?.signal; entered.resolve(); await held.promise; joined = true; return new Blob([body]);
	}), async decodeSource() { return { width: 2, height: 2, drawable: {}, dispose() { decoded++; } }; } });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	await entered.promise; stop.abort(reason);
	try {
		assert.equal(await remainsPending(work), true); assert.equal(nativeSignal?.aborted, true);
		held.resolve(); assert.equal((await outcome).error, reason); assert.equal(joined, true);
		assert.equal(decoded, 1); assert.deepEqual(dom.writes, []); assert.equal(traps, 0);
	} finally { held.resolve(); await outcome; }
});

test('filmstrip rejects a distinct exact output cleanup failure and wipes its undelivered copied thumbnail', async t => {
	const cleanup = Object.freeze({ cleanup: true }), dom = surfaces(t, cleanup), copies: Uint8Array[] = [];
	const original = Uint8Array.from;
	Uint8Array.from = function(...args: Parameters<typeof Uint8Array.from>) {
		const copy = Reflect.apply(original, Uint8Array, args) as Uint8Array;
		if (dom.outputs.includes(args[0] as Uint8ClampedArray)) copies.push(copy);
		return copy;
	} as typeof Uint8Array.from;
	try {
		const work = filmstrip({ ...options(new AbortController().signal, async () => new Blob([body])),
			async decodeSource() { return { width: 2, height: 2, drawable: {}, dispose() {} }; } });
		const { error } = await work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		assert.equal(error, cleanup); assert.equal(dom.writes.length, 1); assert.ok(dom.clears > 0);
		assert.equal(copies.length, 1); assert.ok(copies[0]!.every(value => value === 0));
	} finally { Uint8Array.from = original; }
});

test('held cancellation and distinct Session cleanup remain joined as exact opaque outcomes', async t => {
	const cleanup = Object.freeze({ cleanup: true }), dom = surfaces(t, cleanup), held = deferred<void>(), entered = deferred<void>();
	const stop = new AbortController(); let traps = 0, decoded = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const work = filmstrip({ ...options(stop.signal, async () => { entered.resolve(); await held.promise; return new Blob([body]); }),
		async decodeSource() { return { width: 2, height: 2, drawable: {}, dispose() { decoded++; } }; } });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	await entered.promise; stop.abort(reason); dom.armCleanupFailure();
	try {
		assert.equal(await remainsPending(work), true); held.resolve();
		const { error } = await outcome; assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [reason, cleanup]);
		assert.equal(decoded, 1); assert.equal(dom.writes.length, 0); assert.equal(traps, 0);
	} finally { held.resolve(); await outcome; }
});
