/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionV16 } from '../src/framescaper/selected-finishing-exact-frame-execution-v16.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const PARSED = parseCubeLutV1(TEXT), BODY = new TextEncoder().encode(TEXT);
const REF = { storageKey: `lut-sha256:${PARSED.sha256}`, sha256: PARSED.sha256, byteLength: PARSED.byteLength,
	size: PARSED.size, domainMin: PARSED.domainMin, domainMax: PARSED.domainMax };
const CUBE = { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: REF } };
const SOURCE = [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
const EXPECTED = [0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255];
const rate = Object.freeze({ num: 10, den: 1 });
function context(two = false) {
	const project = createFramescaperProjectFinishing(PROFILE, {
		id: 'cube-export', title: 'Cube export', now: '2026-10-09T00:00:00.000Z',
		sources: [createVideoSource({ id: 'source', name: 'Pixels', storageKey: 'original', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			frameCount: 4800, sampleFrameCount: 4800, sourceFrameCount: 1, frameRate: rate, width: 2, height: 2 })],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'source', title: 'Pixels', sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null, videoEffects: [CUBE] },
			...(two ? [{ kind: 'video', id: 'other', sourceId: 'source', title: 'Other', sequenceId: 'main', sequenceStartFrame: 0,
				sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null, videoEffects: [] }] : [])],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false }),
			...(two ? [createVideoTrack({ id: 'second-track', name: 'Other', clipIds: ['other'], locked: false })] : [])],
		sequences: [{ id: 'main', rate, trackIds: two ? ['track', 'second-track'] : ['track'] }], primarySequenceId: 'main',
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] },
	});
	const timingViews = new Map([['source', { kind: 'cfr' as const, rate, frameCount: 1 }]]);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV16(PROFILE, project, { sequenceId: 'main', sampleStart: 0, sampleDuration: 4800,
		outputRate: rate, format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { width: 2, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#00000000' }, quality: 'balanced',
		includeAudio: false, audioLayout: null, timingViews, visualFreshnessByModelId: new Map() });
	return { project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, timingViews) };
}
function entry(clipId = 'clip', order = 0) {
	return { clipId, sourceId: 'source', presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
		displayWidth: 2, displayHeight: 2, effects: clipId === 'clip' ? [CUBE] : [], intervalProgress: 0,
		renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
			sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: order } };
}
function request(target: Uint8Array<ArrayBuffer>, signal: AbortSignal, two = false) {
	return { sequencePosition: { num: 0, den: 1 }, timelineSample: 0, outputOrdinal: 0, width: 2, height: 2, target, signal,
		layers: [{ trackId: 'track', entries: [entry()] }, ...(two ? [{ trackId: 'second-track', entries: [entry('other', 1)] }] : [])] };
}

test('the actual named16 selected path captures all active surfaces before LUT acquisition and composes the independent literal', async () => {
	const captures: string[] = [], source = new Uint8Array(SOURCE), other = new Uint8Array(16);
	const stop = new AbortController(), target = new Uint8Array(16); let loads = 0;
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(true), signal: stop.signal, assertCurrent() {},
		captureFrame(value) { captures.push(String(value.clipId)); return { width: 2, height: 2, pixels: value.clipId === 'clip' ? source : other }; },
		store: { async loadMediaAsset(key) { assert.equal(key, REF.storageKey); assert.deepEqual(captures, ['clip', 'other']); loads++;
			source.fill(0); other.fill(255); return new Blob([BODY]); } },
	});
	try {
		const result = await execution.render(request(target, stop.signal, true));
		assert.deepEqual(Array.from(target), EXPECTED); assert.equal(loads, 1);
		assert.deepEqual(result.consumedNodeIds, ['render:finishing:main']);
	} finally { await execution.dispose(); }
	await assert.rejects(createFramescaperSelectedExactFrameExecutionFinishing({ ...context(), signal: stop.signal, assertCurrent() {} } as never));
});

test('held LUT acquisition joins cancellation and retired capture bytes while preserving exact opaque reason and caller pixels', async () => {
	const source = new Uint8Array(SOURCE), before = source.slice(), held = deferred<void>(), entered = deferred<void>(), stop = new AbortController();
	let traps = 0, joined = false;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(), signal: stop.signal, assertCurrent() {},
		captureFrame() { return { width: 2, height: 2, pixels: source }; },
		store: { async loadMediaAsset() { entered.resolve(); await held.promise; joined = true; return new Blob([BODY]); } },
	});
	const target = new Uint8Array(16).fill(99), work = execution.render(request(target, stop.signal));
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); assert.equal(joined, false);
	held.resolve(); assert.equal((await outcome).error, reason); assert.equal(joined, true); assert.equal(traps, 0);
	assert.ok(target.every(value => value === 0)); assert.deepEqual(source, before); await execution.dispose();
});

test('named16 retires its private checked media copies after held cancellation and successful target delivery', async () => {
	const slice = Uint8Array.prototype.slice, copies: Uint8Array[] = [];
	Object.defineProperty(Uint8Array.prototype, 'slice', { configurable: true, writable: true,
		value(this: Uint8Array, ...args: Parameters<typeof slice>) {
			const copy = Reflect.apply(slice, this, args) as Uint8Array;
			// This fixed fixture has16-byte RGBA frames;32-byte digest results
			// are scalar authentication evidence, outside this frame lifetime.
			if (copy.byteLength === SOURCE.length) copies.push(copy); return copy;
		} });
	try {
		for (const cancel of [true, false]) {
			copies.length = 0;
			const source = new Uint8Array(SOURCE), held = deferred<void>(), entered = deferred<void>(), stop = new AbortController();
			const reason = Object.freeze({ cancel: true });
			const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(), signal: stop.signal, assertCurrent() {},
				captureFrame() { return { width: 2, height: 2, pixels: source }; },
				store: { async loadMediaAsset() { entered.resolve(); await held.promise; return new Blob([BODY]); } } });
			const target = new Uint8Array(16), work = execution.render(request(target, stop.signal));
			const observed = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
			await entered.promise; assert.ok(copies.some(copy => copy.some(value => value !== 0)));
			if (cancel) stop.abort(reason);
			assert.equal(await remainsPending(work), true); held.resolve();
			assert.equal((await observed).error, cancel ? reason : undefined);
			assert.ok(copies.every(copy => copy.every(value => value === 0)));
			assert.deepEqual(Array.from(source), SOURCE);
			assert.deepEqual(Array.from(target), cancel ? new Array<number>(16).fill(0) : EXPECTED);
			await execution.dispose();
		}
	} finally { Object.defineProperty(Uint8Array.prototype, 'slice', { configurable: true, writable: true, value: slice }); }
});

test('the real picture encoder consumes named16 pixels and retains the declared identical YUV/H264 codec reference', async () => {
	const stop = new AbortController(), execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(), signal: stop.signal,
		assertCurrent() {}, captureFrame() { return { width: 2, height: 2, pixels: new Uint8Array(SOURCE) }; },
		store: { async loadMediaAsset() { return new Blob([BODY]); } } });
	const encoder = await createPinnedExportEncoderV1();
	try {
		const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: 48000, startFrame: 0, endFrame: 4800,
			canvas: { width: 2, height: 2, frameRate: rate, fit: 'contain', backgroundColor: '#000000' } });
		const encoded = await encodeVideoKeyframeVideo(encoder.editor, { frameSource, format: 'mp4', signal: stop.signal,
			producer: { width: 2, height: 2, byteLength: 16,
				async produce(_frame, target) { await execution.render(request(target, stop.signal)); assert.deepEqual(Array.from(target), EXPECTED); },
				dispose() { return execution.dispose(); } } });
		assert.deepEqual(encoder.inputCopies, [EXPECTED]); assert.ok(encoder.calls[0]!.includes('libx264')); assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// This codec is lossy and drops alpha; it is qualified against identical
		// declared parameters, separately from the exact pre-encode RGBA oracle.
		assert.deepEqual(encoder.decode(encoded.bytes), encoder.decode(encoder.referenceEncode(new Uint8Array(EXPECTED))));
	} finally { await execution.dispose(); encoder.close(); }
});

test('named16 retirement seals admission and joins the actual held source before disposal, with one cached retirement promise', async () => {
	const held = deferred<void>(), entered = deferred<void>(), stop = new AbortController(); let joined = false;
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(), signal: stop.signal, assertCurrent() {},
		captureFrame() { return { width: 2, height: 2, pixels: new Uint8Array(SOURCE) }; },
		store: { async loadMediaAsset() { entered.resolve(); await held.promise; joined = true; return new Blob([BODY]); } } });
	const target = new Uint8Array(16), work = execution.render(request(target, stop.signal));
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	await entered.promise;
	const closing = execution.dispose(); void closing.catch(() => undefined);
	const repeated = execution.dispose(); void repeated.catch(() => undefined);
	try {
		assert.equal(repeated, closing);
		assert.equal(await remainsPending(closing), true); assert.equal(joined, false);
		await assert.rejects(execution.render(request(new Uint8Array(16), stop.signal)), /closed|retired/iu);
		held.resolve(); const result = await outcome; assert.ok(result.error instanceof DOMException);
		await closing; assert.equal(joined, true); assert.ok(target.every(value => value === 0));
		assert.equal(execution.dispose(), closing);
	} finally { held.resolve(); await outcome; await closing.catch(() => undefined); await repeated.catch(() => undefined); }
});
