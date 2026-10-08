/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PixelPreviewPresentationV1, PIXEL_PREVIEW_PRESENTATION_LIMITS_V1, PIXEL_SURVEY_PRESENTATION_LIMITS_V1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryPreviewTierV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { withPixelFrameBodyV1 } from '../src/common/editor/imaging/pixel-frame-body-v1.ts';

const MIB = 1024 * 1024;
type Stage = NonNullable<NonNullable<ConstructorParameters<typeof PixelPreviewPresentationV1>[0]>['stage']>;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
function canvas(): HTMLCanvasElement { return { width: 0, height: 0 } as HTMLCanvasElement; }
function pixels(id: string): Uint8Array<ArrayBuffer> { return new Uint8Array([id.charCodeAt(0), 19, 29, 255, 31, 37, 41, 127, 43, 47, 53, 0, 59, 61, 67, 255]); }
function ready(photoId: string, tier: PhotoLibraryPreviewTierV1, width = 2, height = 2) {
	const bytes = width === 2 && height === 2 ? pixels(photoId) : new Uint8Array(width * height * 4).fill(photoId.charCodeAt(0));
	return Object.freeze({ outcome: 'ready' as const, cache: 'hit' as const, notices: Object.freeze([]),
		preview: Object.freeze({ photoId, tier, descriptor: Object.freeze({ schemaVersion: 1, width, height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const), byteLength: bytes.byteLength,
			outputSha256: createHash('sha256').update(bytes).digest('hex'), body: new Blob([bytes]) }) });
}
const readPreview = (id: string, tier: PhotoLibraryPreviewTierV1) => Promise.resolve(ready(id, tier));
function owner(stage?: Stage) {
	const painted = new Map<HTMLCanvasElement, Uint8Array>(), borrowed: PixelFrameV1['pixels'][] = [];
	const presentation = new PixelPreviewPresentationV1({ ...(stage ? { stage } : {}),
		paint: (target, frame) => {
			borrowed.push(frame.pixels); painted.set(target, new Uint8Array(frame.pixels));
			target.width = frame.descriptor.width; target.height = frame.descriptor.height;
			return { width: target.width, height: target.height, byteLength: frame.pixels.byteLength };
		}, clear: target => { target.width = 0; target.height = 0; painted.delete(target); } });
	return { presentation, painted, borrowed };
}

test('Survey preregistered refs stage one fit and independent asymmetric alpha thumbnails serially', async () => {
	let active = 0, maximum = 0;
	const { presentation, painted, borrowed } = owner(async (request, consume, options) => {
		active++; maximum = Math.max(maximum, active);
		try { await withPixelFrameBodyV1(request, consume, options); } finally { active--; }
	});
	const focus = canvas(), b = canvas(), c = canvas();
	presentation.attachSurvey('a', 'fit-screen', focus); presentation.attachSurvey('b', 'thumbnail', b); presentation.attachSurvey('c', 'thumbnail', c);
	assert.equal(painted.size, 0);
	presentation.setSurveyView({ readPreview, photoIds: ['a', 'b', 'c'], focusedPhotoId: 'a' }); await presentation.drain();
	assert.deepEqual(painted.get(focus), pixels('a')); assert.deepEqual(painted.get(b), pixels('b')); assert.deepEqual(painted.get(c), pixels('c'));
	assert.equal(maximum, 1); assert.ok(borrowed.every(bytes => bytes.every(byte => byte === 0)));
	assert.deepEqual(presentation.snapshot().targets.map(target => [target.photoId, target.tier, target.status]),
		[['a', 'fit-screen', 'ready'], ['b', 'thumbnail', 'ready'], ['c', 'thumbnail', 'ready']]);
	assert.equal(presentation.snapshot().thumbnailBytes, 32); assert.equal(presentation.snapshot().fitScreenBytes, 16);
	assert.deepEqual(Object.keys(presentation.snapshot().targets[0]!), ['photoId', 'tier', 'status', 'error', 'notices']);
	await presentation.close(); assert.equal(painted.size, 0);
});

test('Survey closed admission requires a unique visible focus, with null focus only for an empty view', async () => {
	const { presentation } = owner(); let touched = 0;
	const view = { readPreview, photoIds: ['a', 'b'], focusedPhotoId: 'a' };
	for (const invalid of [{ photoIds: ['a', 'a'], focusedPhotoId: 'a' }, { photoIds: Array(2) as string[], focusedPhotoId: 'a' },
		{ photoIds: Array.from({ length: 65 }, (_, i) => `p${i}`), focusedPhotoId: 'p0' }, { photoIds: ['a'], focusedPhotoId: null },
		{ photoIds: ['a'], focusedPhotoId: 'b' }, { photoIds: [], focusedPhotoId: 'a' }]) {
		assert.throws(() => presentation.setSurveyView({ ...view, ...invalid }), /64|unique|focus|empty|visible|sparse|dense|own/u);
	}
	assert.throws(() => presentation.setSurveyView(Object.defineProperty({ ...view }, 'focusedPhotoId', { get: () => { touched++; return 'a'; } })), /accessor|data/u);
	assert.throws(() => presentation.setSurveyView({ ...view, thumbnailsVisible: true } as never), /unknown|unexpected|field/u);
	assert.equal(touched, 0);
	presentation.setSurveyView({ readPreview: () => { touched++; return Promise.resolve({ outcome: 'missing' as const }); }, photoIds: [], focusedPhotoId: null });
	assert.deepEqual(presentation.snapshot().targets, []); assert.equal(touched, 0); await presentation.close();
});

test('Survey replaces its focused thumbnail and caps registration without changing ordinary or Compare limits', async () => {
	const { presentation } = owner();
	for (let index = 0; index < 63; index++) presentation.attachSurvey(`p${index}`, 'thumbnail', canvas());
	assert.throws(() => presentation.attachSurvey('p63', 'thumbnail', canvas()), /63|thumbnail/u);
	assert.throws(() => presentation.attachSurvey('p0', 'fit-screen', canvas()), /same|replace|tier|thumbnail/u);
	presentation.attachSurvey('focus', 'fit-screen', canvas());
	assert.throws(() => presentation.attachSurvey('other', 'fit-screen', canvas()), /one|1|fit/u);
	assert.throws(() => presentation.attach('ordinary', 'thumbnail', canvas()), /mixed|detach/u);
	assert.throws(() => presentation.attachCompare('compare', canvas()), /mixed|detach/u);
	assert.throws(() => presentation.setCompareView({ readPreview, photoIds: ['a', 'b'] }), /mixed|detach/u);
	assert.deepEqual(PIXEL_PREVIEW_PRESENTATION_LIMITS_V1, { maximumThumbnailTargets: 64, maximumFitScreenTargets: 1,
		maximumThumbnailBytes: 64 * MIB, maximumFitScreenBytes: 16 * MIB });
	assert.deepEqual(PIXEL_SURVEY_PRESENTATION_LIMITS_V1, { maximumThumbnailTargets: 63, maximumFitScreenTargets: 1,
		maximumThumbnailBytes: 63 * MIB, maximumFitScreenBytes: 16 * MIB, maximumBackingBytes: 79 * MIB });
	assert.equal(Object.isFrozen(PIXEL_SURVEY_PRESENTATION_LIMITS_V1), true);
	await presentation.close();
});

test('Survey focus replacement clears and detaches displaced tier registrations before new bodies', async () => {
	const { presentation, painted } = owner(), oldFit = canvas(), oldThumb = canvas(), c = canvas();
	presentation.attachSurvey('a', 'fit-screen', oldFit); presentation.attachSurvey('b', 'thumbnail', oldThumb); presentation.attachSurvey('c', 'thumbnail', c);
	presentation.setSurveyView({ readPreview, photoIds: ['a', 'b', 'c'], focusedPhotoId: 'a' }); await presentation.drain();
	presentation.setSurveyView({ readPreview, photoIds: ['a', 'b', 'c'], focusedPhotoId: 'b' });
	assert.equal(oldFit.width, 0); assert.equal(oldThumb.width, 0);
	const nextFit = canvas(), nextThumb = canvas();
	presentation.attachSurvey('b', 'fit-screen', nextFit); presentation.attachSurvey('a', 'thumbnail', nextThumb); await presentation.drain();
	assert.equal(painted.has(oldFit), false); assert.equal(painted.has(oldThumb), false);
	assert.deepEqual(painted.get(nextFit), pixels('b')); assert.deepEqual(painted.get(nextThumb), pixels('a'));
	assert.deepEqual(presentation.snapshot().targets.map(target => [target.photoId, target.tier]), [['b', 'fit-screen'], ['a', 'thumbnail'], ['c', 'thumbnail']]);
	await presentation.close();
});

test('the same Survey view authentically restages a recreated fit ref without retaining old backing', async () => {
	const { presentation, painted } = owner(), old = canvas(), next = canvas(), thumb = canvas(), calls: string[] = [];
	const reader = (id: string, tier: PhotoLibraryPreviewTierV1) => { calls.push(`${id}:${tier}`); return readPreview(id, tier); };
	presentation.attachSurvey('a', 'fit-screen', old); presentation.attachSurvey('b', 'thumbnail', thumb);
	presentation.setSurveyView({ readPreview: reader, photoIds: ['a', 'b'], focusedPhotoId: 'a' }); await presentation.drain();
	presentation.attachSurvey('a', 'fit-screen', null); presentation.attachSurvey('a', 'fit-screen', next); await presentation.drain();
	assert.deepEqual(calls, ['a:fit-screen', 'b:thumbnail', 'a:fit-screen']);
	assert.equal(old.width, 0); assert.equal(painted.has(old), false); assert.deepEqual(painted.get(next), pixels('a')); assert.deepEqual(painted.get(thumb), pixels('b'));
	assert.equal(presentation.snapshot().fitScreenBytes, 16); assert.equal(presentation.snapshot().thumbnailBytes, 16); await presentation.close();
});

test('one owner joins held Compare reads before Survey, preserves new refs through pause, and ignores old-profile null refs', async () => {
	const { presentation, painted } = owner(), held = deferred<ReturnType<typeof ready>>(), calls: string[] = [];
	let oldSignal: AbortSignal | undefined;
	const reader = (id: string, tier: PhotoLibraryPreviewTierV1, options: { signal: AbortSignal }) => {
		calls.push(`${id}:${tier}`); if (id === 'old') { oldSignal = options.signal; return held.promise; } return Promise.resolve(ready(id, tier));
	};
	const old = canvas(), focus = canvas(), thumb = canvas();
	presentation.attachCompare('old', old); presentation.attachCompare('a', canvas());
	presentation.setCompareView({ readPreview: reader, photoIds: ['old', 'a'] });
	presentation.attachCompare('old', null); presentation.attachCompare('a', null);
	presentation.attachSurvey('a', 'fit-screen', focus); presentation.attachSurvey('b', 'thumbnail', thumb);
	const pausing = presentation.pause(); presentation.setSurveyView({ readPreview: reader, photoIds: ['a', 'b'], focusedPhotoId: 'a' });
	presentation.attachCompare('a', null); presentation.attach('b', 'thumbnail', null);
	assert.equal(oldSignal?.aborted, true); assert.equal(old.width, 0); assert.deepEqual(calls, ['old:fit-screen']);
	held.resolve(ready('old', 'fit-screen')); await pausing; await presentation.drain();
	assert.deepEqual(calls, ['old:fit-screen', 'a:fit-screen', 'b:thumbnail']); assert.deepEqual(painted.get(focus), pixels('a')); assert.deepEqual(painted.get(thumb), pixels('b'));
	presentation.attachSurvey('a', 'fit-screen', null); presentation.attachSurvey('b', 'thumbnail', null);
	const ordinary = canvas(); presentation.attach('b', 'thumbnail', ordinary); await presentation.pause();
	presentation.setView({ readPreview: reader, photoIds: ['b'], thumbnailsVisible: true, fitScreenPhotoId: null });
	presentation.attachSurvey('b', 'thumbnail', null); await presentation.drain(); assert.deepEqual(painted.get(ordinary), pixels('b'));
	await presentation.close();
});

test('held Survey staging and final wipe join focus replacement without stale paint or statuses', async () => {
	const entered = deferred<void>(), held = deferred<void>(), cleaned = deferred<void>(); let stages = 0;
	const calls: string[] = [], { presentation, painted } = owner(async (request, consume, options) => {
		const first = ++stages === 1; if (first) { entered.resolve(); await held.promise; }
		try { await withPixelFrameBodyV1(request, consume, options); } finally { if (first) await cleaned.promise; }
	});
	const reader = (id: string, tier: PhotoLibraryPreviewTierV1) => { calls.push(`${id}:${tier}`); return readPreview(id, tier); };
	const old = canvas(); presentation.attachSurvey('a', 'fit-screen', old); presentation.attachSurvey('b', 'thumbnail', canvas());
	presentation.setSurveyView({ readPreview: reader, photoIds: ['a', 'b'], focusedPhotoId: 'a' }); await entered.promise;
	presentation.setSurveyView({ readPreview: reader, photoIds: ['a', 'b'], focusedPhotoId: 'b' });
	presentation.attachSurvey('b', 'fit-screen', canvas()); presentation.attachSurvey('a', 'thumbnail', canvas());
	held.resolve(); await Promise.resolve(); await Promise.resolve(); assert.deepEqual(calls, ['a:fit-screen']);
	cleaned.resolve(); await presentation.drain(); assert.deepEqual(calls, ['a:fit-screen', 'b:fit-screen', 'a:thumbnail']);
	assert.equal(old.width, 0); assert.equal(painted.has(old), false); assert.ok(presentation.snapshot().targets.every(target => target.status === 'ready'));
	await presentation.close();
});

test('64 real staged Survey frames retain exactly79MiB, bounded to one2048fit and63 independent512 thumbnails', async () => {
	const backings = new Map<HTMLCanvasElement, Uint8Array>(), sizes: number[] = []; let borrowed: PixelFrameV1['pixels'] | null = null;
	const presentation = new PixelPreviewPresentationV1({ stage: async (request, consume, options) => {
		try { await withPixelFrameBodyV1(request, frame => { borrowed = frame.pixels; consume(frame); }, options); }
		finally { if (borrowed) assert.ok(borrowed.every(byte => byte === 0)); borrowed = null; }
	}, paint: (target, frame) => {
		backings.set(target, new Uint8Array(frame.pixels)); sizes.push(frame.pixels.byteLength);
		return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
	}, clear: target => { backings.delete(target); target.width = 0; target.height = 0; } });
	const ids = ['focus', ...Array.from({ length: 63 }, (_, i) => `tile${i}`)];
	for (const id of ids) presentation.attachSurvey(id, id === 'focus' ? 'fit-screen' : 'thumbnail', canvas());
	presentation.setSurveyView({ readPreview: (id, tier) => Promise.resolve(ready(id, tier, tier === 'fit-screen' ? 2048 : 512, tier === 'fit-screen' ? 2048 : 512)), photoIds: ids, focusedPhotoId: 'focus' });
	await presentation.drain(); assert.equal(backings.size, 64); assert.equal(sizes.filter(size => size === 16 * MIB).length, 1); assert.equal(sizes.filter(size => size === MIB).length, 63);
	assert.equal([...backings.values()].reduce((total, bytes) => total + bytes.byteLength, 0), 79 * MIB);
	assert.equal(presentation.snapshot().thumbnailBytes, 63 * MIB); assert.equal(presentation.snapshot().fitScreenBytes, 16 * MIB);
	assert.equal(presentation.snapshot().targets.length, 64); assert.ok(presentation.snapshot().targets.every(target => target.status === 'ready'));
	await presentation.close(); assert.equal(backings.size, 0);
});

test('Survey refuses oversized, forged staging and lying paint receipts, and continues independent valid tiles', async () => {
	const { presentation, painted } = owner(); presentation.attachSurvey('a', 'fit-screen', canvas()); presentation.attachSurvey('b', 'thumbnail', canvas());
	presentation.setSurveyView({ readPreview: (id, tier) => Promise.resolve(id === 'a' ? ready(id, tier, 2049, 2048) : ready(id, tier)), photoIds: ['a', 'b'], focusedPhotoId: 'a' });
	await presentation.drain(); assert.equal(painted.size, 1); assert.equal(presentation.snapshot().fitScreenBytes, 0); assert.equal(presentation.snapshot().targets[0]!.status, 'failed');
	presentation.setSurveyView({ readPreview: (id, tier) => Promise.resolve(id === 'b' ? ready(id, tier, 513, 512) : ready(id, tier)), photoIds: ['a', 'b'], focusedPhotoId: 'a' });
	await presentation.drain(); assert.equal(painted.size, 1); assert.equal(presentation.snapshot().thumbnailBytes, 0); assert.equal(presentation.snapshot().targets[1]!.status, 'failed'); await presentation.close();
	let paints = 0;
	const forged = new PixelPreviewPresentationV1({ stage: (_request, consume) => { consume({ descriptor: ready('a', 'fit-screen', 2049, 2048).preview.descriptor, pixels: new Uint8Array(2049 * 2048 * 4) }); return Promise.resolve(); },
		paint: () => { paints++; return { width: 2, height: 2, byteLength: 16 }; }, clear: target => { target.width = 0; target.height = 0; } });
	forged.attachSurvey('a', 'fit-screen', canvas()); forged.setSurveyView({ readPreview, photoIds: ['a'], focusedPhotoId: 'a' }); await forged.drain();
	assert.equal(paints, 0); assert.equal(forged.snapshot().targets[0]!.status, 'failed'); await forged.close();
	const lying = new PixelPreviewPresentationV1({ paint: () => ({ width: 2, height: 2, byteLength: 1 }), clear: target => { target.width = 0; target.height = 0; } });
	lying.attachSurvey('a', 'fit-screen', canvas()); lying.setSurveyView({ readPreview, photoIds: ['a'], focusedPhotoId: 'a' }); await lying.drain();
	assert.equal(lying.snapshot().fitScreenBytes, 0); assert.equal(lying.snapshot().targets[0]!.status, 'failed'); await lying.close();
});

test('Survey does not traverse original-bearing payloads and leaves other preview demand available', async () => {
	const { presentation, painted } = owner(); let originals = 0;
	presentation.attachSurvey('a', 'fit-screen', canvas()); presentation.attachSurvey('b', 'thumbnail', canvas());
	presentation.setSurveyView({ readPreview: (id, tier) => Promise.resolve(id === 'a' ? { ...ready(id, tier), original: Object.defineProperty({}, 'bytes', { get: () => { originals++; throw new Error('Original traversal'); } }) } : ready(id, tier)),
		photoIds: ['a', 'b'], focusedPhotoId: 'a' });
	await presentation.drain(); assert.equal(originals, 0); assert.equal(painted.size, 1); assert.equal(presentation.snapshot().targets[0]!.status, 'failed'); await presentation.close();
});

test('Survey close clears every target despite one native failure and joins held staging cleanup before rejection', async () => {
	const entered = deferred<void>(), held = deferred<void>(), focus = canvas(), thumb = canvas(), cleared: HTMLCanvasElement[] = [];
	const failure = new Error('Native Survey backing cleanup failed'); let armed = false, settled = false, wiped = false;
	const presentation = new PixelPreviewPresentationV1({ stage: async (request, consume, options) => {
		entered.resolve(); await held.promise; try { await withPixelFrameBodyV1(request, consume, options); } finally { wiped = true; }
	}, paint: () => { throw new Error('Cancelled Survey must not paint'); }, clear: target => {
		cleared.push(target); if (armed && target === focus) throw failure; target.width = 0; target.height = 0;
	} });
	presentation.attachSurvey('a', 'fit-screen', focus); presentation.attachSurvey('b', 'thumbnail', thumb);
	presentation.setSurveyView({ readPreview, photoIds: ['a', 'b'], focusedPhotoId: 'a' }); await entered.promise;
	armed = true; cleared.length = 0;
	const closing = presentation.close().then(() => { settled = true; return null; }, error => { settled = true; return error as unknown; });
	await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(cleared, [focus, thumb]);
	held.resolve(); assert.equal(await closing, failure); assert.equal(wiped, true); assert.match(presentation.snapshot().cleanupErrors.join(' '), /cleanup failed/u);
});

test('Survey observer retirement cannot acquire a body after same-turn close reentry', async () => {
	const { presentation, painted } = owner(); let armed = false, closing: Promise<void> | undefined, reads = 0;
	presentation.attachSurvey('a', 'fit-screen', canvas());
	presentation.subscribe(snapshot => { if (armed && snapshot.active) { armed = false; closing = presentation.close(); } });
	armed = true; presentation.setSurveyView({ readPreview: (id, tier) => { reads++; return readPreview(id, tier); }, photoIds: ['a'], focusedPhotoId: 'a' });
	assert.ok(closing); await closing; assert.equal(reads, 0); assert.equal(painted.size, 0); assert.equal(presentation.snapshot().active, false);
});
