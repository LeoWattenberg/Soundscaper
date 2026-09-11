/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createVideoRetimeHtmlVideoSeekPort } from '../src/common/editor/video-retime-html-video-seek-port.ts';

class PausedVideo extends EventTarget {
	static readonly HAVE_CURRENT_DATA = 2;
	readonly src = 'https://example.test/fixture.webm';
	readonly currentSrc = this.src;
	readonly srcObject = null;
	readonly duration = 1;
	readonly readyState = 2;
	readonly error = null;
	readonly seeks: number[] = [];
	readonly callbacks = new Map<number, VideoFrameRequestCallback>();
	paused = true;
	seeking = false;
	#time = 0;
	#callbackId = 0;
	get currentTime(): number { return this.#time; }
	set currentTime(time: number) {
		assert.equal(this.seeking, false, 'the adapter must drain before starting another seek');
		this.#time = time;
		this.seeks.push(time);
		this.seeking = true;
	}
	pause(): void { this.paused = true; }
	requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
		this.callbacks.set(++this.#callbackId, callback);
		return this.#callbackId;
	}
	cancelVideoFrameCallback(id: number): void { this.callbacks.delete(id); }
	presentFrame(mediaTime: number): void {
		assert.equal(this.callbacks.size, 1, 'exactly one presentation callback is active');
		const next = this.callbacks.entries().next().value;
		assert.ok(next);
		const [id, callback] = next;
		this.callbacks.delete(id);
		callback(0, { mediaTime, presentedFrames: id, presentationTime: 0,
			expectedDisplayTime: 0, width: 64, height: 32 });
	}
	drain(): void {
		this.seeking = false;
		this.dispatchEvent(new Event('seeked'));
	}
}

function fixture(context: TestContext) {
	for (const name of ['HTMLVideoElement', 'HTMLMediaElement']) {
		const original = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, value: PausedVideo });
		context.after(() => {
			if (original) Object.defineProperty(globalThis, name, original);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
	const video = new PausedVideo();
	const controller = new AbortController();
	const port = createVideoRetimeHtmlVideoSeekPort(video as unknown as HTMLVideoElement, {
		assertCurrent: () => {}, timeoutMs: 1_000,
	});
	context.after(() => { controller.abort(); video.drain(); });
	const result = Promise.resolve(port.present({ drawableSourceFrame: 1,
		intervalStartSeconds: 0.04, intervalEndSeconds: 0.13, targetSeconds: 0.085,
		signal: controller.signal,
	})).then((value) => ({ value }), (error: unknown) => ({ error }));
	return { video, controller, result };
}

test('a forward-snapped paused frame retries only after the initial seek drains', async (context) => {
	const { video, result } = fixture(context);
	video.presentFrame(0.13);
	assert.deepEqual(video.seeks, [0.085]);
	video.dispatchEvent(new Event('seeked'));
	assert.deepEqual(video.seeks, [0.085], 'a stale seeked event cannot overlap the active seek');
	video.drain();
	assert.deepEqual(video.seeks, [0.085, 0.04], 'seeked must recover without another spontaneous paused-frame callback');
	video.presentFrame(0.04);
	video.drain();
	assert.deepEqual(await result, { value: { mediaTime: 0.04 } });
	assert.equal(video.callbacks.size, 0);
});

test('a boundary retry still rejects an out-of-interval decoded frame', async (context) => {
	const { video, result } = fixture(context);
	video.presentFrame(0.13);
	video.drain();
	assert.deepEqual(video.seeks, [0.085, 0.04]);
	video.presentFrame(0.13);
	video.drain();
	const outcome = await result;
	assert.ok('error' in outcome && outcome.error instanceof RangeError);
	assert.match(outcome.error.message, /outside.*half-open/iu);
	assert.deepEqual(video.seeks, [0.085, 0.04], 'an invalid boundary presentation never retries indefinitely');
	assert.equal(video.callbacks.size, 0);
});

test('cancelling a deferred boundary retry drains without issuing another seek', async (context) => {
	const { video, controller, result } = fixture(context);
	video.presentFrame(0.13);
	controller.abort();
	video.drain();
	const outcome = await result;
	assert.ok('error' in outcome && outcome.error instanceof DOMException);
	assert.equal(outcome.error.name, 'AbortError');
	assert.deepEqual(video.seeks, [0.085]);
	assert.equal(video.callbacks.size, 0);
});
