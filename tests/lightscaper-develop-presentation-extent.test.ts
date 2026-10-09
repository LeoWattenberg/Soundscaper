/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PhotoLibraryDevelopPresentationV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createPixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV1 } from '../src/common/editor/photo-library-develop-proxy-port-v1.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const descriptor = { schemaVersion: 1 as const, width: 2, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
const pixels = new Uint8Array([0, 64, 255, 255, 128, 128, 128, 255]);
const preview = { photoId: 'photo', tier: 'fit-screen' as const, descriptor, byteLength: 8,
	outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([pixels]) };
const targets = { before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement };
const limits = { maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 };

test('split layout receives detached source/output dimensions only after both authenticated paintings finish', async () => {
	const held = deferred<void>(), entered = deferred<void>(); let source: ArrayBuffer | null = null;
	const output = { descriptor: { ...descriptor, width: 1, height: 3 }, pixels: new Uint8Array(12).fill(128) };
	const runtime: PhotoLibraryDevelopProxyRuntimeV1 = { withProxy: async (request, consume) => {
		source = request.frame.pixels.buffer; entered.resolve(); await held.promise;
		return consume({ frame: output, histogram: await createPixelFrameHistogramV1(output, { limits }) });
	} };
	const owner = new PhotoLibraryDevelopPresentationV1({ readPreview: async () => ({ outcome: 'ready', preview, cache: 'hit', notices: [] }),
		loadProxy: async () => runtime, paint: (_canvas, value) => ({ width: value.descriptor.width, height: value.descriptor.height, byteLength: value.pixels.byteLength }), clear() {} });
	try {
		assert.equal(owner.snapshot().extent, null);
		owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...targets }); await entered.promise;
		assert.equal(owner.snapshot().status, 'pending'); assert.equal(owner.snapshot().extent, null);
		held.resolve(); await owner.drain();
		const extent = owner.snapshot().extent;
		assert.deepEqual(extent, { before: { width: 2, height: 1 }, after: { width: 1, height: 3 } });
		assert.ok(Object.isFrozen(extent)); assert.ok(Object.isFrozen(extent?.before)); assert.ok(Object.isFrozen(extent?.after));
		assert.ok(source); assert.equal(new Uint8Array(source).every(byte => byte === 0), true);
		output.descriptor.width = 2; assert.equal(extent?.after.width, 1);
		await owner.pause(); assert.equal(owner.snapshot().extent, null);
	} finally { held.resolve(); await owner.close(); }
});

test('replacement clears an old split extent before a missing or failing source can retain its layout', async () => {
	let outcome: 'ready' | 'missing' | 'failed' = 'ready';
	const runtime: PhotoLibraryDevelopProxyRuntimeV1 = { withProxy: async (request, consume) => consume({ frame: request.frame,
		histogram: await createPixelFrameHistogramV1(request.frame, { limits }) }) };
	const owner = new PhotoLibraryDevelopPresentationV1({ readPreview: async () => {
		if (outcome === 'failed') throw Error('Opaque source failure.');
		return outcome === 'missing' ? { outcome: 'missing' } : { outcome: 'ready', preview, cache: 'hit', notices: [] };
	}, loadProxy: async () => runtime, paint: () => ({ width: 2, height: 1, byteLength: 8 }), clear() {} });
	try {
		for (const next of ['missing', 'failed'] as const) {
			outcome = 'ready'; owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...targets }); await owner.drain();
			assert.ok(owner.snapshot().extent); outcome = next;
			owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...targets });
			assert.equal(owner.snapshot().extent, null); await owner.drain();
			assert.equal(owner.snapshot().status, next); assert.equal(owner.snapshot().extent, null);
		}
	} finally { await owner.close(); }
});

test('closing a held split render cannot publish its dimensions or retain native backing ownership', async () => {
	const held = deferred<void>(), entered = deferred<void>(); const cleared: HTMLCanvasElement[] = [];
	const runtime: PhotoLibraryDevelopProxyRuntimeV1 = { withProxy: async (request, consume) => {
		entered.resolve(); await held.promise;
		return consume({ frame: request.frame, histogram: await createPixelFrameHistogramV1(request.frame, { limits }) });
	} };
	const owner = new PhotoLibraryDevelopPresentationV1({ readPreview: async () => ({ outcome: 'ready', preview, cache: 'hit', notices: [] }),
		loadProxy: async () => runtime, paint: () => ({ width: 2, height: 1, byteLength: 8 }), clear(canvas) { cleared.push(canvas); } });
	owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...targets }); await entered.promise;
	let closed = false; const closing = owner.close().then(() => { closed = true; }); await settle(); assert.equal(closed, false);
	held.resolve(); await closing;
	assert.equal(owner.snapshot().extent, null); assert.equal(owner.snapshot().status, 'idle'); assert.deepEqual(cleared, [targets.before, targets.after]);
});
