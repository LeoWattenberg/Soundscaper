import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEditorVideoThumbnailTimes,
	createAudioEditorVideoFrameExtractor,
	isAudioEditorVideoFile,
} from '../src/common/editor/video-media.js';

test('video-file detection accepts the initial MP4 and WebM containers', () => {
	assert.equal(isAudioEditorVideoFile({ name: 'clip.mp4', type: '' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'clip.M4V', type: 'application/octet-stream' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'clip.webm', type: 'video/webm' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'audio.webm', type: 'audio/webm' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'voice.wav', type: 'audio/wav' }), false);
});

test('video thumbnails use a five-second base grid and retain the final frame', () => {
	assert.deepEqual(audioEditorVideoThumbnailTimes(0), [0]);
	assert.deepEqual(audioEditorVideoThumbnailTimes(10), [0, 5, 9.95]);
	assert.deepEqual(audioEditorVideoThumbnailTimes(10.01), [0, 5, 10]);
	assert.deepEqual(audioEditorVideoThumbnailTimes(16, { maximum: 3 }), [0, 5, 10]);
});

test('the initial poster seeks before drawing so metadata timing cannot produce a black frame', async () => {
	const fixture = await videoExtractorFixture();
	const frame = await fixture.extractor.capture(0);
	fixture.extractor.dispose();
	assert.ok(fixture.seeks.some((value) => value > 0), 'the first capture should force a decoder seek');
	assert.equal(fixture.drawCount(), 1);
	assert.deepEqual([frame.width, frame.height], [320, 180]);
});

test('video preview capture rejects raised geometry before seeking or allocating a canvas', async () => {
	const fixture = await videoExtractorFixture();
	for (const captureOptions of [{ maximumWidth: 641 }, { maximumHeight: 361 }]) {
		await assert.rejects(
			fixture.extractor.capture(5, captureOptions),
			/video preview capture maximum (?:width|height)/iu,
		);
	}
	assert.equal(fixture.seeks.length, 0);
	assert.equal(fixture.canvasCount(), 0);
	fixture.extractor.dispose();
});

test('video preview capture rejects oversized source-frame geometry before seeking', async () => {
	const fixture = await videoExtractorFixture({ videoWidth: 16_385, videoHeight: 1 });
	await assert.rejects(
		fixture.extractor.capture(0),
		/video preview capture source.*maximum width/iu,
	);
	assert.equal(fixture.seeks.length, 0);
	assert.equal(fixture.canvasCount(), 0);
	fixture.extractor.dispose();
});

test('video preview capture admits the exact poster and encoded-payload boundaries', async () => {
	const fixture = await videoExtractorFixture({ encodedBytes: 4 * 1024 ** 2 });
	const frame = await fixture.extractor.capture(0, { maximumWidth: 640, maximumHeight: 360 });
	assert.deepEqual([frame.width, frame.height, frame.blob.size], [640, 360, 4 * 1024 ** 2]);
	fixture.extractor.dispose();
});

test('video preview capture rejects an oversized encoded payload', async () => {
	const fixture = await videoExtractorFixture({ encodedBytes: 4 * 1024 ** 2 + 1 });
	await assert.rejects(
		fixture.extractor.capture(0),
		/video preview encoded payload.*exceeds/iu,
	);
	assert.equal(fixture.drawCount(), 1);
	fixture.extractor.dispose();
});

test('video preview capture serializes canvas and encoder work within one extractor', async () => {
	const fixture = await videoExtractorFixture({ deferEncoding: true });
	const first = fixture.extractor.capture(0);
	await fixture.waitForEncodeCount(1);
	const second = fixture.extractor.capture(5);
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(fixture.canvasCount(), 1);
	assert.equal(fixture.encodeCount(), 1);
	fixture.releaseNextEncoding();
	await first;
	await fixture.waitForEncodeCount(2);
	assert.equal(fixture.canvasCount(), 2);
	fixture.releaseNextEncoding();
	await second;
	fixture.extractor.dispose();
});

test('video preview capture fences cancellation before seek and after encoding', async () => {
	const preAborted = await videoExtractorFixture();
	const earlyController = new AbortController();
	earlyController.abort();
	await assert.rejects(
		preAborted.extractor.capture(0, { signal: earlyController.signal }),
		(error) => error?.name === 'AbortError',
	);
	assert.equal(preAborted.seeks.length, 0);
	assert.equal(preAborted.canvasCount(), 0);
	preAborted.extractor.dispose();

	const duringEncode = await videoExtractorFixture({ deferEncoding: true });
	const lateController = new AbortController();
	const capture = duringEncode.extractor.capture(0, { signal: lateController.signal });
	await duringEncode.waitForEncodeCount(1);
	lateController.abort();
	duringEncode.releaseNextEncoding();
	await assert.rejects(capture, (error) => error?.name === 'AbortError');
	duringEncode.extractor.dispose();
});

test('disposing the extractor promptly fences a stalled seek', async () => {
	const fixture = await videoExtractorFixture({ deferSeek: true });
	const capture = fixture.extractor.capture(0);
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(fixture.seeks.length, 1);
	fixture.extractor.dispose();
	await assert.rejects(capture, (error) => error?.name === 'AbortError');
	assert.equal(fixture.canvasCount(), 0);
});

test('disposing the extractor fences active encoding and every queued capture', async () => {
	const fixture = await videoExtractorFixture({ deferEncoding: true });
	const active = fixture.extractor.capture(0);
	await fixture.waitForEncodeCount(1);
	const queued = [
		fixture.extractor.capture(5),
		fixture.extractor.capture(6),
	];
	fixture.extractor.dispose();
	await Promise.all(queued.map(async (capture) => {
		await assert.rejects(capture, (error) => error?.name === 'AbortError');
	}));
	assert.equal(fixture.canvasCount(), 1);
	fixture.releaseNextEncoding();
	await assert.rejects(active, (error) => error?.name === 'AbortError');
	assert.equal(fixture.encodeCount(), 1);
});

async function videoExtractorFixture(options = {}) {
	const seeks = [];
	const canvases = [];
	const pendingEncodes = [];
	const encodeWaiters = [];
	let encodeCount = 0;
	let drawCount = 0;
	const notifyEncodeWaiters = () => {
		for (let index = encodeWaiters.length - 1; index >= 0; index -= 1) {
			const waiter = encodeWaiters[index];
			if (encodeCount < waiter.expected) continue;
			encodeWaiters.splice(index, 1);
			waiter.resolve();
		}
	};
	const video = {
		preload: '',
		muted: false,
		playsInline: false,
		currentTime: 0,
		duration: 10,
		videoWidth: options.videoWidth ?? 640,
		videoHeight: options.videoHeight ?? 360,
		addEventListener(type, listener) {
			this.listeners ||= new Map();
			this.listeners.set(type, listener);
		},
		removeEventListener(type) { this.listeners?.delete(type); },
		set src(value) {
			this.source = value;
			queueMicrotask(() => this.listeners?.get('loadedmetadata')?.());
		},
		removeAttribute() {},
		load() {},
		pause() {},
	};
	Object.defineProperty(video, 'currentTime', {
		get() { return this._currentTime || 0; },
		set(value) {
			this._currentTime = value;
			seeks.push(value);
			if (!options.deferSeek) queueMicrotask(() => this.listeners?.get('seeked')?.());
		},
	});
	const document = {
		createElement(type) {
			if (type === 'video') return video;
			if (type === 'canvas') {
				const canvas = {
					width: 0,
					height: 0,
					getContext() { return { drawImage() { drawCount += 1; } }; },
					toBlob(callback, mimeType) {
						const complete = () => callback(new Blob([
							options.encodedBytes == null ? 'thumbnail' : new Uint8Array(options.encodedBytes),
						], { type: mimeType }));
						encodeCount += 1;
						notifyEncodeWaiters();
						if (options.deferEncoding) pendingEncodes.push(complete);
						else complete();
					},
				};
				canvases.push(canvas);
				return canvas;
			}
			throw new Error(`Unexpected element: ${type}`);
		},
	};
	const urlApi = {
		createObjectURL() { return 'blob:video'; },
		revokeObjectURL() {},
	};
	const extractor = await createAudioEditorVideoFrameExtractor(
		new Blob(['video'], { type: 'video/mp4' }),
		{ document, urlApi, timeoutMs: 100 },
	);
	return {
		extractor,
		seeks,
		canvasCount: () => canvases.length,
		drawCount: () => drawCount,
		encodeCount: () => encodeCount,
		releaseNextEncoding: () => pendingEncodes.shift()?.(),
		waitForEncodeCount: (expected) => encodeCount >= expected
			? Promise.resolve()
			: new Promise((resolve) => { encodeWaiters.push({ expected, resolve }); }),
	};
}
