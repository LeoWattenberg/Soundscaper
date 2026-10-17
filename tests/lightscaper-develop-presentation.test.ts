/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v1.ts';
import type { PhotoLibraryDevelopSettingsV1 } from '../src/common/editor/photo-library-develop-port-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV1 } from '../src/common/editor/photo-library-develop-proxy-port-v1.ts';
import { createPixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';
import { createHash } from 'node:crypto';
import { deferred, settle } from './helpers/async-test-control.ts';

const develop: PhotoLibraryDevelopSettingsV1 = { processVersion: 1, effects: [], masks: [], maskBindings: [],
	geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } };
const descriptor = { schemaVersion: 1 as const, width: 2, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
const pixels = new Uint8Array([0, 64, 255, 255, 128, 128, 128, 255]);
const preview = { photoId: 'photo', tier: 'fit-screen' as const, descriptor, byteLength: 8,
	outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([pixels]) };
const targets = { before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement };
const limits = { maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 };

test('scoped presentation paints authenticated before/after frames and retains only immutable scalar histograms', async () => {
	let backing: ArrayBuffer | null = null; const painted: number[][] = [];
	const runtime: PhotoLibraryDevelopProxyRuntimeV1 = { withProxy: async (request, consume) => {
		backing = request.frame.pixels.buffer; return consume({ frame: request.frame, histogram: await createPixelFrameHistogramV1(request.frame, { limits }) });
	} };
	const owner = new PhotoLibraryDevelopPresentationV1({ readPreview: async () => ({ outcome: 'ready', preview, cache: 'hit', notices: [] }),
		loadProxy: async () => runtime, paint: (_canvas, value) => { painted.push(Array.from(value.pixels)); return { width: 2, height: 1, byteLength: 8 }; }, clear() {} });
	owner.setView({ photoId: 'photo', develop, ...targets }); await owner.drain();
	assert.deepEqual(painted, [Array.from(pixels), Array.from(pixels)]);
	assert.equal(owner.snapshot().status, 'ready'); assert.equal(owner.snapshot().after?.sampledPixels, 2);
	assert.ok(backing); assert.equal(new Uint8Array(backing).every(byte => byte === 0), true);
	assert.equal(Object.hasOwn(owner.snapshot(), 'pixels'), false); await owner.close();
});

test('old preview retirement barrier settles before any new source/body/runtime admission', async () => {
	const barrier = deferred<void>(); let reads = 0, loads = 0;
	const owner = new PhotoLibraryDevelopPresentationV1({ beforePresent: barrier.promise, readPreview: async () => { reads++; return { outcome: 'missing' }; },
		loadProxy: async () => { loads++; throw Error('Not used'); }, clear() {} });
	owner.setView({ photoId: 'photo', develop, ...targets }); await settle(); assert.equal(reads, 0); assert.equal(loads, 0);
	const pausing = owner.pause(); barrier.resolve(); await pausing; assert.equal(reads, 0); await owner.close();
});

test('held source read joins and a replacement cannot publish or start before the prior owner settles', async () => {
	const held = deferred<Awaited<ReturnType<import('../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts').PixelPreviewPresentationReaderV1>>>();
	const calls: string[] = [];
	const owner = new PhotoLibraryDevelopPresentationV1({ readPreview: id => { calls.push(id); return calls.length === 1 ? held.promise : Promise.resolve({ outcome: 'missing' }); },
		loadProxy: async () => { throw Error('No body expected'); }, clear() {} });
	owner.setView({ photoId: 'first', develop, ...targets }); await settle(); owner.setView({ photoId: 'second', develop, ...targets });
	await settle(); assert.deepEqual(calls, ['first']); held.resolve({ outcome: 'ready', preview: { ...preview, photoId: 'first' }, cache: 'hit', notices: [] });
	await owner.drain(); assert.deepEqual(calls, ['first', 'second']); assert.equal(owner.snapshot().status, 'missing'); await owner.close();
});

test('held actual consumer and late non-cancellation cleanup failure block retirement and new surfaces', async () => {
	const held = deferred<void>(), entered = deferred<void>(), cleanup = new Error('Proxy cleanup failed');
	let reads = 0;
	const runtime: PhotoLibraryDevelopProxyRuntimeV1 = { withProxy: async request => {
		entered.resolve(); await held.promise; throw new AggregateError([request.signal.reason, cleanup], 'joined cleanup');
	} };
	const owner = new PhotoLibraryDevelopPresentationV1({ readPreview: async () => { reads++; return { outcome: 'ready', preview, cache: 'hit', notices: [] }; },
		loadProxy: async () => runtime, paint: () => ({ width: 2, height: 1, byteLength: 8 }), clear() {} });
	owner.setView({ photoId: 'photo', develop, ...targets }); await entered.promise;
	let joined = false; const pausing = owner.pause().then(() => { joined = true; }, error => { assert.ok(error instanceof AggregateError); joined = true; });
	await settle(); assert.equal(joined, false); held.resolve(); await pausing;
	owner.setView({ photoId: 'other', develop, ...targets }); await settle(); assert.equal(reads, 1);
	await assert.rejects(owner.close(), AggregateError);
});
