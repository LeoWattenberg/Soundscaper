/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PixelPreviewPresentationV1, PIXEL_PREVIEW_PRESENTATION_LIMITS_V1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { withPixelFrameBodyV1 } from '../src/common/editor/imaging/pixel-frame-body-v1.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
function canvas(): HTMLCanvasElement { return { width: 0, height: 0 } as HTMLCanvasElement; }
const samples = Object.freeze({ reference: [255, 0, 0, 255, 0, 255, 0, 127, 0, 0, 255, 0, 19, 23, 29, 255],
	candidate: [7, 11, 13, 255, 17, 19, 23, 0, 29, 31, 37, 127, 41, 43, 47, 255] });
function ready(photoId: string, width = 2, height = 2) {
	const pixels = width === 2 && height === 2 ? new Uint8Array(samples[photoId === 'candidate' ? 'candidate' : 'reference']) : new Uint8Array(width * height * 4);
	const descriptor = Object.freeze({ schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const);
	return Object.freeze({ outcome: 'ready' as const, cache: 'hit' as const, notices: Object.freeze([]),
		preview: Object.freeze({ photoId, tier: 'fit-screen' as const, descriptor, byteLength: pixels.byteLength,
			outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([pixels]) }) });
}
type Stage = NonNullable<NonNullable<ConstructorParameters<typeof PixelPreviewPresentationV1>[0]>['stage']>;
function owner(options: Readonly<{ stage?: Stage; paint?: (canvas: HTMLCanvasElement, frame: PixelFrameV1) => void }> = {}) {
	const painted = new Map<HTMLCanvasElement, number[]>(), borrowed: PixelFrameV1['pixels'][] = [];
	const presentation = new PixelPreviewPresentationV1({
		...(options.stage ? { stage: options.stage } : {}),
		paint: (target, frame) => {
			borrowed.push(frame.pixels); painted.set(target, [...frame.pixels]); options.paint?.(target, frame);
			target.width = frame.descriptor.width; target.height = frame.descriptor.height;
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
		},
		clear: target => { target.width = 0; target.height = 0; painted.delete(target); },
	});
	return { presentation, painted, borrowed };
}
const readPreview = (id: string) => Promise.resolve(ready(id));

test('two preregistered compare refs stage authentic independent asymmetric alpha pixels serially', async () => {
	let active = 0, maximum = 0;
	const { presentation, painted, borrowed } = owner({ stage: async (request, consume, options) => {
		active++; maximum = Math.max(maximum, active);
		try { return await withPixelFrameBodyV1(request, consume, options); } finally { active--; }
	} });
	const reference = canvas(), candidate = canvas();
	presentation.attachCompare('reference', reference); presentation.attachCompare('candidate', candidate);
	assert.equal(painted.size, 0);
	presentation.setCompareView({ readPreview, photoIds: ['reference', 'candidate'] }); await presentation.drain();
	assert.deepEqual(painted.get(reference), samples.reference); assert.deepEqual(painted.get(candidate), samples.candidate);
	assert.equal(maximum, 1); assert.equal(borrowed.length, 2); assert.ok(borrowed.every(bytes => bytes.every(byte => byte === 0)));
	assert.equal(presentation.snapshot().fitScreenBytes, 32); assert.equal(presentation.snapshot().thumbnailBytes, 0);
	assert.deepEqual(presentation.snapshot().targets.map(target => [target.photoId, target.tier, target.status]), [['reference', 'fit-screen', 'ready'], ['candidate', 'fit-screen', 'ready']]);
	assert.deepEqual(Object.keys(presentation.snapshot().targets[0]!), ['photoId', 'tier', 'status', 'error', 'notices']);
	await presentation.close(); assert.equal(painted.size, 0);
});

test('compare admission is closed, exactly two distinct IDs and excludes mixed registrations without changing normal limits', async () => {
	const { presentation } = owner(); let traversed = 0;
	const pair = { readPreview, photoIds: ['reference', 'candidate'] };
	for (const ids of [[], ['reference'], ['reference', 'reference'], ['reference', 'candidate', 'third'], Array(2) as string[]]) {
		assert.throws(() => presentation.setCompareView({ ...pair, photoIds: ids }), /two|2|unique|distinct|dense|sparse|own/u);
	}
	assert.throws(() => presentation.setCompareView(Object.defineProperty({ ...pair }, 'photoIds', { get: () => { traversed++; return pair.photoIds; } })), /accessor|data/u);
	assert.throws(() => presentation.setCompareView({ ...pair, thumbnailsVisible: true } as never), /unknown|unexpected|field/u);
	assert.equal(traversed, 0);
	presentation.attach('ordinary', 'thumbnail', canvas());
	assert.throws(() => presentation.attachCompare('reference', canvas()), /mixed|ordinary|detach/u);
	assert.throws(() => presentation.setCompareView(pair), /mixed|ordinary|detach/u);
	presentation.attach('ordinary', 'thumbnail', null);
	presentation.attachCompare('reference', canvas()); presentation.attachCompare('candidate', canvas());
	assert.throws(() => presentation.attachCompare('third', canvas()), /two|2/u);
	assert.throws(() => presentation.attach('other', 'thumbnail', canvas()), /mixed|compare|detach/u);
	assert.throws(() => presentation.setView({ readPreview, photoIds: ['reference'], thumbnailsVisible: false, fitScreenPhotoId: 'reference' }), /mixed|compare|detach/u);
	assert.deepEqual(PIXEL_PREVIEW_PRESENTATION_LIMITS_V1, { maximumThumbnailTargets: 64, maximumFitScreenTargets: 1, maximumThumbnailBytes: 67_108_864, maximumFitScreenBytes: 16_777_216 });
	await presentation.close();
});

test('compare verifies each digest, reports independent failure and continues the other target', async () => {
	const { presentation, painted } = owner(), reference = canvas(), candidate = canvas();
	presentation.attachCompare('reference', reference); presentation.attachCompare('candidate', candidate);
	presentation.setCompareView({ readPreview: id => Promise.resolve(id === 'reference' ? { ...ready(id), preview: { ...ready(id).preview, outputSha256: 'f'.repeat(64) } } : ready(id)), photoIds: ['reference', 'candidate'] });
	await presentation.drain(); assert.equal(painted.has(reference), false); assert.deepEqual(painted.get(candidate), samples.candidate);
	assert.match(presentation.snapshot().targets[0]!.error ?? '', /digest/u); assert.equal(presentation.snapshot().targets[1]!.status, 'ready');
	await presentation.close();
});

test('compare mode joins cancelled ordinary read before acquiring either new body', async () => {
	const { presentation, painted } = owner(), held = deferred<ReturnType<typeof ready>>();
	const calls: string[] = []; let oldSignal: AbortSignal | undefined;
	const reader = (id: string, _tier: string, options: { signal: AbortSignal }) => {
		calls.push(id); if (id === 'old') { oldSignal = options.signal; return held.promise; } return Promise.resolve(ready(id));
	};
	const old = canvas(); presentation.attach('old', 'fit-screen', old);
	presentation.setView({ readPreview: reader, photoIds: ['old'], thumbnailsVisible: false, fitScreenPhotoId: 'old' });
	presentation.attach('old', 'fit-screen', null);
	presentation.attachCompare('reference', canvas()); presentation.attachCompare('candidate', canvas());
	presentation.setCompareView({ readPreview: reader, photoIds: ['reference', 'candidate'] });
	assert.equal(oldSignal?.aborted, true); assert.equal(old.width, 0); assert.deepEqual(calls, ['old']);
	held.resolve(ready('old')); await presentation.drain(); assert.deepEqual(calls, ['old', 'reference', 'candidate']); assert.equal(painted.size, 2);
	await presentation.close();
});

test('held compare stage and cleanup joins replacement before new demand and never publishes stale status', async () => {
	const entered = deferred<void>(), held = deferred<void>(), cleaned = deferred<void>();
	const calls: string[] = []; let stages = 0;
	const { presentation, painted } = owner({ stage: async (request, consume, options) => {
		stages++;
		if (stages === 1) { entered.resolve(); await held.promise; }
		try { await withPixelFrameBodyV1(request, consume, options); }
		finally { if (stages === 1) await cleaned.promise; }
	} });
	const reader = (id: string) => { calls.push(id); return Promise.resolve(ready(id)); };
	const old = canvas(); presentation.attachCompare('old', old); presentation.attachCompare('candidate', canvas());
	presentation.setCompareView({ readPreview: reader, photoIds: ['old', 'candidate'] }); await entered.promise;
	presentation.attachCompare('old', null); presentation.attachCompare('reference', canvas());
	presentation.setCompareView({ readPreview: reader, photoIds: ['reference', 'candidate'] });
	assert.deepEqual(calls, ['old']); held.resolve(); await Promise.resolve(); await Promise.resolve(); assert.deepEqual(calls, ['old']);
	cleaned.resolve(); await presentation.drain(); assert.deepEqual(calls, ['old', 'reference', 'candidate']);
	assert.equal(old.width, 0); assert.equal(painted.has(old), false); assert.ok(presentation.snapshot().targets.every(target => target.photoId !== 'old' && target.status === 'ready'));
	await presentation.close();
});

test('compare close joins held stage cleanup and same-turn reentrant close without painting', async () => {
	const entered = deferred<void>(), held = deferred<void>(); let cleaned = false;
	const { presentation, painted } = owner({ stage: async (request, consume, options) => {
		entered.resolve(); await held.promise;
		try { await withPixelFrameBodyV1(request, consume, options); } finally { cleaned = true; }
	} });
	presentation.attachCompare('reference', canvas()); presentation.attachCompare('candidate', canvas());
	presentation.setCompareView({ readPreview, photoIds: ['reference', 'candidate'] }); await entered.promise;
	let complete = false; const closing = presentation.close(); void closing.then(() => { complete = true; });
	assert.equal(presentation.close(), closing); await Promise.resolve(); assert.equal(complete, false);
	held.resolve(); await closing; assert.equal(cleaned, true); assert.equal(painted.size, 0); assert.equal(presentation.snapshot().fitScreenBytes, 0);
});

test('two maximum admitted compare frames retain exactly32MiB and oversized bodies refuse before paint', async () => {
	let paints = 0;
	const presentation = new PixelPreviewPresentationV1({ paint: (_target, frame) => {
		paints++; return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
	}, clear: target => { target.width = 0; target.height = 0; } });
	presentation.attachCompare('reference', canvas()); presentation.attachCompare('candidate', canvas());
	presentation.setCompareView({ readPreview: id => Promise.resolve(ready(id, 2048, 2048)), photoIds: ['reference', 'candidate'] });
	await presentation.drain(); assert.equal(paints, 2); assert.equal(presentation.snapshot().fitScreenBytes, 33_554_432);
	presentation.setCompareView({ readPreview: id => Promise.resolve(ready(id, 2049, 2048)), photoIds: ['reference', 'candidate'] });
	assert.equal(presentation.snapshot().fitScreenBytes, 0); await presentation.drain();
	assert.equal(paints, 2); assert.ok(presentation.snapshot().targets.every(target => target.status === 'failed'));
	assert.equal(presentation.snapshot().fitScreenBytes, 0); await presentation.close();
});

test('a trusted staging seam cannot paint an over-budget frame or retain a lying canvas receipt', async () => {
	let paints = 0;
	const presentation = new PixelPreviewPresentationV1({ stage: (_request, consume) => {
		consume({ descriptor: { ...ready('reference', 2049, 2048).preview.descriptor }, pixels: new Uint8Array(2049 * 2048 * 4) }); return Promise.resolve();
	}, paint: () => { paints++; return { width: 1, height: 1, byteLength: 4 }; }, clear: target => { target.width = 0; target.height = 0; } });
	presentation.attachCompare('reference', canvas()); presentation.attachCompare('candidate', canvas());
	presentation.setCompareView({ readPreview, photoIds: ['reference', 'candidate'] }); await presentation.drain();
	assert.equal(paints, 0); assert.equal(presentation.snapshot().fitScreenBytes, 0); await presentation.close();
	const lying = new PixelPreviewPresentationV1({ paint: () => ({ width: 2, height: 2, byteLength: 1 }), clear: target => { target.width = 0; target.height = 0; } });
	lying.attachCompare('reference', canvas()); lying.attachCompare('candidate', canvas());
	lying.setCompareView({ readPreview, photoIds: ['reference', 'candidate'] }); await lying.drain();
	assert.ok(lying.snapshot().targets.every(target => target.status === 'failed')); assert.equal(lying.snapshot().fitScreenBytes, 0); await lying.close();
});

test('React ref handoff survives layout pause and returns the same owner to ordinary loupe limits', async () => {
	const { presentation, painted } = owner(), normal = canvas(), reference = canvas(), candidate = canvas();
	presentation.attach('reference', 'fit-screen', normal);
	presentation.setView({ readPreview, photoIds: ['reference', 'candidate'], thumbnailsVisible: false, fitScreenPhotoId: 'reference' });
	await presentation.drain(); assert.equal(normal.width, 2);
	presentation.attach('reference', 'fit-screen', null);
	presentation.attachCompare('reference', reference); presentation.attachCompare('candidate', candidate);
	await presentation.pause(); presentation.setCompareView({ readPreview, photoIds: ['reference', 'candidate'] });
	// A retired normal ref cleanup for the same ID cannot detach the new Compare ref.
	presentation.attach('reference', 'fit-screen', null); await presentation.drain();
	assert.equal(normal.width, 0); assert.deepEqual(painted.get(reference), samples.reference); assert.deepEqual(painted.get(candidate), samples.candidate);
	presentation.attachCompare('reference', null); presentation.attachCompare('candidate', null);
	presentation.attach('reference', 'fit-screen', normal); await presentation.pause();
	presentation.setView({ readPreview, photoIds: ['reference', 'candidate'], thumbnailsVisible: false, fitScreenPhotoId: 'reference' });
	presentation.attachCompare('reference', null); await presentation.drain();
	assert.equal(normal.width, 2); assert.equal(reference.width, 0); assert.equal(candidate.width, 0);
	assert.throws(() => presentation.attach('candidate', 'fit-screen', canvas()), /one|1/u); await presentation.close();
});

test('close attempts both canvas cleanups and joins held stage before acknowledging a cleanup failure', async () => {
	const entered = deferred<void>(), held = deferred<void>(), reference = canvas(), candidate = canvas();
	const failure = new Error('Native backing cleanup failed'); let armed = false, completed = false, wiped = false;
	const cleared: HTMLCanvasElement[] = [];
	const presentation = new PixelPreviewPresentationV1({ stage: async (request, consume, options) => {
		entered.resolve(); await held.promise;
		try { await withPixelFrameBodyV1(request, consume, options); } finally { wiped = true; }
	}, paint: () => { throw new Error('Cancelled stage must not paint'); }, clear: target => {
		cleared.push(target); if (armed && target === reference) throw failure; target.width = 0; target.height = 0;
	} });
	presentation.attachCompare('reference', reference); presentation.attachCompare('candidate', candidate);
	presentation.setCompareView({ readPreview, photoIds: ['reference', 'candidate'] }); await entered.promise;
	armed = true; cleared.length = 0;
	const closing = presentation.close().then(() => { completed = true; return null; }, error => { completed = true; return error as unknown; });
	await Promise.resolve(); assert.equal(completed, false); assert.deepEqual(cleared, [reference, candidate]);
	held.resolve(); assert.equal(await closing, failure); assert.equal(wiped, true); assert.match(presentation.snapshot().cleanupErrors.join(' '), /cleanup failed/u);
});

test('reentrant observer retirement cannot start Compare reads after the registered pending owner', async () => {
	const { presentation, painted } = owner(), held = deferred<ReturnType<typeof ready>>(); let closing: Promise<void> | undefined;
	const calls: string[] = []; let armed = false;
	presentation.attachCompare('reference', canvas()); presentation.attachCompare('candidate', canvas());
	presentation.subscribe(snapshot => { if (armed && snapshot.active) { armed = false; closing = presentation.close(); } });
	armed = true;
	presentation.setCompareView({ readPreview: id => { calls.push(id); return held.promise; }, photoIds: ['reference', 'candidate'] });
	assert.ok(closing); assert.deepEqual(calls, []); held.resolve(ready('reference')); await closing;
	assert.equal(painted.size, 0); assert.equal(presentation.snapshot().active, false);
});
