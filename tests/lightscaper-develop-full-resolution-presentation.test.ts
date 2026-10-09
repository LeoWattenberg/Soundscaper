/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV1 } from '../src/common/editor/photo-library-develop-proxy-port-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { createPixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const original = () => ({ descriptor: { schemaVersion: 1 as const, width: 2050, height: 1, sampleFormat: 'unorm8' as const,
	primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array(2050 * 4).fill(255) });
const targets = { before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement };
const settings = { photoId: 'photo', revision: 7, resolution: 'full' as const, develop: defaultPhotoDevelopV1(), ...targets };

test('full-resolution presentation bypasses fit-screen bodies and paints all original pixels through the named full renderer', async () => {
	const painted: number[] = [], source = original(); let proxyReads = 0, proxyRenders = 0, originalReads = 0, fullRenders = 0;
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume) => {
		originalReads++; assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 7 });
		try { return await consume({ photoId: 'photo', revision: 7, frame: source }); } finally { source.pixels.fill(0); }
	};
	const runtime: PhotoLibraryDevelopProxyRuntimeV1 = {
		withProxy: async () => { proxyRenders++; throw Error('Full zoom must not enter the proxy kernel'); },
		withFullResolution: async (request, consume) => {
			fullRenders++; assert.equal(request.frame.descriptor.width, 2050);
			return consume({ frame: request.frame, histogram: await createPixelFrameHistogramV1(request.frame, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render }) });
		},
	};
	const owner = new PhotoLibraryDevelopPresentationV1({ withOriginalFrame,
		readPreview: async () => { proxyReads++; throw Error('No disposable preview body in full zoom'); }, loadProxy: async () => runtime,
		paint: (_canvas, frame, options) => { painted.push(frame.descriptor.width); assert.ok(options?.limits); return { width: 2050, height: 1, byteLength: 8200 }; }, clear() {} });
	owner.setView(settings); await owner.drain();
	assert.equal(owner.snapshot().status, 'ready'); assert.deepEqual(painted, [2050, 2050]);
	assert.deepEqual([proxyReads, proxyRenders, originalReads, fullRenders], [0, 0, 1, 1]);
	assert.equal(owner.snapshot().after?.sampledPixels, 2050);
	assert.deepEqual(owner.snapshot().extent, { before: { width: 2050, height: 1 }, after: { width: 2050, height: 1 } });
	assert.equal(source.pixels.every(value => value === 0), true); await owner.close();
});

test('changing from held full-resolution source to proxy joins the old scope before admitting a derivative', async () => {
	const entered = deferred<void>(), release = deferred<void>(), source = original(), calls: string[] = [];
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (_request, consume, options) => {
		calls.push('original'); entered.resolve(); await release.promise;
		try { options?.signal?.throwIfAborted(); return await consume({ photoId: 'photo', revision: 7, frame: source }); }
		finally { source.pixels.fill(0); calls.push('release'); }
	};
	const owner = new PhotoLibraryDevelopPresentationV1({ withOriginalFrame,
		readPreview: async () => { calls.push('proxy'); return { outcome: 'missing' }; },
		loadProxy: async () => ({ withProxy: async () => { throw Error('No frame'); }, withFullResolution: async () => { throw Error('No frame'); } }), clear() {} });
	owner.setView(settings); await entered.promise;
	owner.setView({ ...settings, resolution: 'proxy' }); await settle();
	assert.deepEqual(calls, ['original']); assert.equal(await remainsPending(owner.drain()), true);
	release.resolve(); await owner.drain(); assert.deepEqual(calls, ['original', 'release', 'proxy']);
	assert.equal(owner.snapshot().status, 'missing'); assert.equal(source.pixels.every(value => value === 0), true); await owner.close();
});

test('a source with the wrong revision or identity cannot paint a full-resolution canvas', async () => {
	for (const changed of [{ photoId: 'other', revision: 7 }, { photoId: 'photo', revision: 8 }]) {
		const source = original(); let paints = 0;
		const owner = new PhotoLibraryDevelopPresentationV1({
			withOriginalFrame: async (_request, consume) => { try { return await consume({ ...changed, frame: source }); } finally { source.pixels.fill(0); } },
			readPreview: async () => { throw Error('No proxy'); },
			loadProxy: async () => ({ withProxy: async () => { throw Error('No proxy'); }, withFullResolution: async () => { throw Error('No render'); } }),
			paint: () => { paints++; return { width: 2050, height: 1, byteLength: 8200 }; }, clear() {} });
		owner.setView(settings); await owner.drain(); assert.equal(owner.snapshot().status, 'failed'); assert.equal(paints, 0);
		assert.equal(source.pixels.every(value => value === 0), true); await owner.close();
	}
});

test('retirement joins a held full-resolution consumer and cleanup failure blocks replacement', async () => {
	const entered = deferred<void>(), release = deferred<void>(), source = original(); let reads = 0, observed: PixelFrameV1 | null = null;
	const failure = new Error('Full-resolution cleanup failed');
	const owner = new PhotoLibraryDevelopPresentationV1({
		withOriginalFrame: async (_request, consume) => { try { return await consume({ photoId: 'photo', revision: 7, frame: source }); } finally { source.pixels.fill(0); } },
		readPreview: async () => { reads++; return { outcome: 'missing' }; },
		loadProxy: async () => ({ withProxy: async () => { throw Error('No proxy'); }, withFullResolution: async request => {
			observed = request.frame; entered.resolve(); await release.promise;
			throw new AggregateError([request.signal.reason, failure], 'Full scope failed to retire');
		} }), paint: () => ({ width: 2050, height: 1, byteLength: 8200 }), clear() {} });
	owner.setView(settings); await entered.promise; const closing = owner.pause();
	const rejected = assert.rejects(closing, AggregateError);
	assert.equal(await remainsPending(closing), true); release.resolve(); await rejected;
	assert.ok(observed); assert.equal((observed as PixelFrameV1).pixels.every(value => value === 0), true);
	owner.setView({ ...settings, resolution: 'proxy' }); await settle(); assert.equal(reads, 0);
	await assert.rejects(owner.close(), AggregateError);
});

test('post-consumer original revision refusal clears painted canvases and never publishes an authorized ready view', async () => {
	const source = original(), painted: HTMLCanvasElement[] = [], cleared: HTMLCanvasElement[] = [], states: string[] = [];
	const owner = new PhotoLibraryDevelopPresentationV1({
		withOriginalFrame: async (_request, consume) => {
			try { await consume({ photoId: 'photo', revision: 7, frame: source }); throw new PhotoCatalogRevisionConflictError('photo'); }
			finally { source.pixels.fill(0); }
		},
		readPreview: async () => { throw Error('No proxy fallback'); },
		loadProxy: async () => ({ withProxy: async () => { throw Error('No proxy'); }, withFullResolution: async (request, consume) =>
			consume({ frame: request.frame, histogram: await createPixelFrameHistogramV1(request.frame, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render }) }) }),
		paint: (canvas, frame) => { painted.push(canvas); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; },
		clear: canvas => { cleared.push(canvas); },
	});
	owner.subscribe(snapshot => { states.push(snapshot.status); }); owner.setView(settings);
	try {
		await owner.drain(); assert.equal(owner.snapshot().status, 'failed'); assert.deepEqual(painted, [targets.before, targets.after]);
		assert.deepEqual(cleared, [targets.before, targets.after]); assert.equal(states.includes('ready'), false);
		assert.equal(owner.snapshot().before, null); assert.equal(owner.snapshot().after, null); assert.equal(owner.snapshot().extent, null);
		assert.ok(source.pixels.every(byte => byte === 0));
	} finally { await owner.close(); }
});

test('ready follows successful final original settlement, after source retirement rather than a held callback', async () => {
	const source = original(), entered = deferred<void>(), release = deferred<void>(), states: string[] = [];
	const owner = new PhotoLibraryDevelopPresentationV1({
		withOriginalFrame: async (_request, consume) => {
			try { const result = await consume({ photoId: 'photo', revision: 7, frame: source }); entered.resolve(); await release.promise; return result; }
			finally { source.pixels.fill(0); }
		}, readPreview: async () => { throw Error('No proxy'); },
		loadProxy: async () => ({ withProxy: async () => { throw Error('No proxy'); }, withFullResolution: async (request, consume) =>
			consume({ frame: request.frame, histogram: await createPixelFrameHistogramV1(request.frame, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render }) }) }),
		paint: (_canvas, frame) => ({ width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }), clear() {},
	});
	owner.subscribe(snapshot => { states.push(snapshot.status); if (snapshot.status === 'ready') assert.ok(source.pixels.every(byte => byte === 0)); });
	owner.setView(settings);
	try {
		await Promise.race([entered.promise, owner.drain()]); assert.equal(owner.snapshot().status, 'pending'); assert.equal(states.includes('ready'), false);
		assert.equal(await remainsPending(owner.drain()), true); release.resolve(); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.equal(owner.snapshot().after?.sampledPixels, 2050);
	} finally { release.resolve(); await owner.close(); }
});
