/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { PixelPreviewPresentationV1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
const descriptor = Object.freeze({ schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const);
function ready(photoId: string, tier: 'thumbnail' | 'fit-screen' = 'thumbnail') {
	const bytes = new Uint8Array([11, 29, 43, 255]);
	return Object.freeze({ outcome: 'ready' as const, cache: 'hit' as const, notices: Object.freeze([]),
		preview: Object.freeze({ photoId, tier, descriptor, byteLength: 4, outputSha256: createHash('sha256').update(bytes).digest('hex'), body: new Blob([bytes]) }) });
}
function canvas(): HTMLCanvasElement { return { width: 0, height: 0 } as HTMLCanvasElement; }
function owner() {
	const painted: string[] = [], cleared: HTMLCanvasElement[] = [];
	const presentation = new PixelPreviewPresentationV1({
		paint: (target: HTMLCanvasElement, frame: PixelFrameV1) => {
			target.width = frame.descriptor.width; target.height = frame.descriptor.height;
			painted.push([...frame.pixels].join(','));
			return Object.freeze({ width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength });
		},
		clear: (target: HTMLCanvasElement) => { target.width = 0; target.height = 0; cleared.push(target); },
	});
	return { presentation, painted, cleared };
}

test('presentation remains inert without opt-in and queues scalar IDs instead of preview bodies', async () => {
	const { presentation, painted } = owner();
	const calls: string[] = [], first = deferred<ReturnType<typeof ready>>();
	const readPreview = (id: string) => { calls.push(id); return calls.length === 1 ? first.promise : Promise.resolve(ready(id)); };
	presentation.attach('photo-1', 'thumbnail', canvas());
	presentation.attach('photo-2', 'thumbnail', canvas());
	presentation.setView({ readPreview, photoIds: ['photo-1', 'photo-2'], thumbnailsVisible: false, fitScreenPhotoId: null });
	assert.deepEqual(calls, []);
	presentation.setView({ readPreview, photoIds: ['photo-1', 'photo-2'], thumbnailsVisible: true, fitScreenPhotoId: null });
	assert.deepEqual(calls, ['photo-1']);
	assert.equal(presentation.snapshot().active, true);
	first.resolve(ready('photo-1')); await presentation.drain();
	assert.deepEqual(calls, ['photo-1', 'photo-2']); assert.equal(painted.length, 2);
	assert.equal(presentation.snapshot().thumbnailBytes, 8);
	await presentation.close();
});

test('a generation waits for its cancelled predecessor and refuses late stale publication', async () => {
	const { presentation, painted } = owner(), first = deferred<ReturnType<typeof ready>>();
	const oldCanvas = canvas(), nextCanvas = canvas();
	const calls: string[] = [], signals: AbortSignal[] = [];
	const readPreview = (id: string, _tier: string, options: { signal: AbortSignal }) => {
		calls.push(id); signals.push(options.signal);
		return id === 'old' ? first.promise : Promise.resolve(ready(id));
	};
	presentation.attach('old', 'thumbnail', oldCanvas);
	presentation.setView({ readPreview, photoIds: ['old'], thumbnailsVisible: true, fitScreenPhotoId: null });
	presentation.attach('old', 'thumbnail', null);
	presentation.attach('new', 'thumbnail', nextCanvas);
	presentation.setView({ readPreview, photoIds: ['new'], thumbnailsVisible: true, fitScreenPhotoId: null });
	assert.equal(signals[0]!.aborted, true); assert.deepEqual(calls, ['old']);
	first.resolve(ready('old')); await presentation.drain();
	assert.deepEqual(calls, ['old', 'new']); assert.equal(painted.length, 1);
	assert.equal(oldCanvas.width, 0); assert.equal(nextCanvas.width, 1);
	await presentation.close(); assert.equal(nextCanvas.width, 0);
});

test('close joins a held body stage, preserves wipe and clears all surface backing', async () => {
	const held = deferred<void>(), entered = deferred<void>(), pixels = new Uint8Array([1, 2, 3, 255]);
	let released = false, painted = false;
	const presentation = new PixelPreviewPresentationV1({
		stage: async (_request, consume) => {
			entered.resolve(); await held.promise;
			try { await consume({ descriptor, pixels }); }
			finally { pixels.fill(0); released = true; }
		},
		paint: () => { painted = true; return { width: 1, height: 1, byteLength: 4 }; },
		clear: target => { target.width = 0; target.height = 0; },
	});
	const target = canvas(); presentation.attach('photo-1', 'thumbnail', target);
	presentation.setView({ readPreview: id => Promise.resolve(ready(id)), photoIds: ['photo-1'], thumbnailsVisible: true, fitScreenPhotoId: null });
	await entered.promise;
	let closed = false; const closing = presentation.close().then(() => { closed = true; });
	await Promise.resolve(); assert.equal(closed, false); assert.equal(target.width, 0);
	held.resolve(); await closing;
	assert.equal(released, true); assert.equal(painted, false); assert.deepEqual([...pixels], [0, 0, 0, 0]);
	assert.throws(() => presentation.setView({ readPreview: id => Promise.resolve(ready(id)), photoIds: [], thumbnailsVisible: false, fitScreenPhotoId: null }), /closed/u);
});

test('thumbnail and loupe targets are bounded, independent and released before replacement', async () => {
	const { presentation } = owner(), targets = Array.from({ length: 64 }, () => canvas());
	for (let index = 0; index < targets.length; index++) presentation.attach(`photo-${index}`, 'thumbnail', targets[index]!);
	assert.throws(() => presentation.attach('photo-64', 'thumbnail', canvas()), /64/u);
	const loupe = canvas(); presentation.attach('photo-0', 'fit-screen', loupe);
	assert.throws(() => presentation.attach('photo-1', 'fit-screen', canvas()), /one|1/u);
	assert.throws(() => presentation.setView({ readPreview: id => Promise.resolve(ready(id)), photoIds: Array.from({ length: 65 }, (_, index) => `photo-${index}`), thumbnailsVisible: true, fitScreenPhotoId: null }), /64/u);
	presentation.setView({ readPreview: (id, tier) => Promise.resolve(ready(id, tier)), photoIds: targets.map((_target, index) => `photo-${index}`), thumbnailsVisible: true, fitScreenPhotoId: 'photo-0' });
	await presentation.drain(); assert.equal(presentation.snapshot().thumbnailBytes, 256); assert.equal(presentation.snapshot().fitScreenBytes, 4);
	await presentation.pause(); assert.ok(targets.every(target => target.width === 0 && target.height === 0)); assert.equal(loupe.width, 0);
	await presentation.close();
});

test('a mismatched original-free outcome is refused and one preview failure continues later scalar demand', async () => {
	const { presentation, painted } = owner();
	for (const id of ['wrong', 'right']) presentation.attach(id, 'thumbnail', canvas());
	presentation.setView({ readPreview: id => Promise.resolve(ready(id === 'wrong' ? 'another' : id)), photoIds: ['wrong', 'right'], thumbnailsVisible: true, fitScreenPhotoId: null });
	await presentation.drain(); assert.equal(painted.length, 1);
	assert.equal(presentation.snapshot().targets.find(target => target.photoId === 'wrong')?.status, 'failed');
	assert.match(presentation.snapshot().targets.find(target => target.photoId === 'wrong')?.error ?? '', /identity/u);
	assert.equal(presentation.snapshot().targets.find(target => target.photoId === 'right')?.status, 'ready');
	await presentation.close();
});

test('view and payload admission reject accessors, sparse IDs and original-bearing fields without traversal', async () => {
	const { presentation, painted } = owner(); let touched = 0;
	const readPreview = (_id: string) => { touched++; return Promise.resolve(ready('photo-1')); };
	const options = { readPreview, photoIds: ['photo-1'], thumbnailsVisible: true, fitScreenPhotoId: null };
	assert.throws(() => presentation.setView({ ...options, photoIds: Array(1) as string[] }), /sparse|dense|own/u);
	assert.throws(() => presentation.setView(Object.defineProperty({ ...options }, 'photoIds', { get: () => { touched++; return ['photo-1']; } })), /accessor|data/u);
	assert.equal(touched, 0);
	presentation.attach('photo-1', 'thumbnail', canvas());
	const originalBearing = { ...ready('photo-1'), original: Object.defineProperty({}, 'bytes', { get: () => { touched++; throw new Error('Original traversal'); } }) };
	presentation.setView({ ...options, readPreview: () => Promise.resolve(originalBearing) });
	await presentation.drain(); assert.equal(painted.length, 0); assert.equal(touched, 0);
	assert.equal(presentation.snapshot().targets[0]!.status, 'failed');
	await presentation.close();
});

test('only bounded scalar persistence notices survive delivery and snapshots retain no payloads', async () => {
	const { presentation } = owner(); presentation.attach('photo-1', 'thumbnail', canvas());
	presentation.setView({ readPreview: id => Promise.resolve({ ...ready(id), cache: 'transient' as const,
		notices: Object.freeze(['persistence-failed', 'cleanup-failed'] as const) }), photoIds: ['photo-1'], thumbnailsVisible: true, fitScreenPhotoId: null });
	await presentation.drain();
	const snapshot = presentation.snapshot();
	assert.deepEqual(snapshot.targets[0]!.notices, ['persistence-failed', 'cleanup-failed']);
	assert.deepEqual(Object.keys(snapshot.targets[0]!), ['photoId', 'tier', 'status', 'error', 'notices']);
	assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.targets) && Object.isFrozen(snapshot.targets[0]!.notices));
	await presentation.close();
});

test('same-turn close inside a read port joins that operation before resolving', async () => {
	const { presentation, painted } = owner(), held = deferred<ReturnType<typeof ready>>();
	let closing!: Promise<void>, closed = false;
	presentation.attach('photo-1', 'thumbnail', canvas());
	presentation.setView({ readPreview: () => {
		closing = presentation.close(); void closing.then(() => { closed = true; }); return held.promise;
	}, photoIds: ['photo-1'], thumbnailsVisible: true, fitScreenPhotoId: null });
	try { await Promise.resolve(); await Promise.resolve(); assert.equal(closed, false); }
	finally { held.resolve(ready('photo-1')); await closing; }
	assert.equal(painted.length, 0); assert.equal(presentation.snapshot().active, false);
});

test('an observer closing reentrantly receives the same pre-registered close promise', async () => {
	const { presentation } = owner(); let armed = false, nested: Promise<void> | undefined;
	presentation.subscribe(() => { if (armed) { armed = false; nested = presentation.close(); } });
	armed = true; const closing = presentation.close();
	await closing; await nested;
	assert.equal(nested, closing);
});

test('read ports cannot replace native cancellation observation with signal accessors', async () => {
	const { presentation, painted } = owner(); let touched = 0;
	presentation.attach('photo-1', 'thumbnail', canvas());
	presentation.setView({ readPreview: (id, _tier, options) => {
		Object.defineProperty(options.signal, 'aborted', { get: () => { touched++; throw new Error('Signal getter tripwire'); } });
		return Promise.resolve(ready(id));
	}, photoIds: ['photo-1'], thumbnailsVisible: true, fitScreenPhotoId: null });
	try { await presentation.drain(); assert.equal(touched, 0); assert.equal(painted.length, 1); }
	finally { await presentation.close().catch(() => undefined); }
});
