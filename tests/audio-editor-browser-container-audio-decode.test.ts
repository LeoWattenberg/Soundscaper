/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeBrowserContainerAudio,
	type BrowserContainerAudioDecodeSession,
	type BrowserContainerAudioSample,
} from '../src/common/editor/browser-container-audio-decode.ts';

test('browser container audio decode preserves timeline gaps and closes every resource', async () => {
	const samples = [
		sample(1, [[1, 2], [3, 4]]),
		sample(2, [[5, 6], [7, 8]]),
	];
	let disposed = false;
	const session: BrowserContainerAudioDecodeSession = {
		timelineOrigin: 1,
		sampleRate: 4,
		channelCount: 2,
		async *samples() { yield* samples; },
		dispose() { disposed = true; },
	};
	const decoded = await decodeBrowserContainerAudio(new Blob(['video']), {
		openSession: async () => session,
		maximumOutputBytes: 64,
		durationSeconds: 1.5,
	});

	assert.equal(decoded.sampleRate, 4);
	assert.equal(decoded.frameCount, 6);
	assert.deepEqual(decoded.channels.map((channel) => [...channel]), [
		[1, 2, 0, 0, 5, 6],
		[3, 4, 0, 0, 7, 8],
	]);
	assert.equal(samples.every(({ closed }) => closed), true);
	assert.equal(disposed, true);
});

test('browser container audio decode rejects output beyond its bound and observes abort', async () => {
	const tooLarge = sample(0, [[1, 2], [3, 4]]);
	let boundDisposed = false;
	await assert.rejects(() => decodeBrowserContainerAudio(new Blob(['video']), {
		maximumOutputBytes: 15,
		durationSeconds: 0.5,
		openSession: async () => ({
			timelineOrigin: 0,
			sampleRate: 4,
			channelCount: 2,
			async *samples() { yield tooLarge; },
			dispose() { boundDisposed = true; },
		}),
	}), /output bound/iu);
	assert.equal(tooLarge.closed, false, 'the bound refuses before acquiring a decoded sample');
	assert.equal(boundDisposed, true);

	const controller = new AbortController();
	const aborted = sample(0, [[1]]);
	let abortDisposed = false;
	aborted.afterCopy = () => controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(() => decodeBrowserContainerAudio(new Blob(['video']), {
		signal: controller.signal,
		durationSeconds: 0.25,
		openSession: async () => ({
			timelineOrigin: 0,
			sampleRate: 4,
			channelCount: 1,
			async *samples() { yield aborted; },
			dispose() { abortDisposed = true; },
		}),
	}), (error) => error instanceof Error && error.name === 'AbortError');
	assert.equal(aborted.closed, true);
	assert.equal(abortDisposed, true);
});

test('browser container audio decode trims millisecond timestamp jitter without duplicating samples', async () => {
	const sampleRate = 44_100;
	const first = sample(0, [Array.from({ length: 1_024 }, () => 1)], sampleRate);
	const second = sample(0.023, [Array.from({ length: 1_024 }, (_, index) => index + 1_000)], sampleRate);
	const decoded = await decodeBrowserContainerAudio(new Blob(['webm']), {
		durationSeconds: 0.05,
		openSession: async () => ({
			timelineOrigin: 0,
			sampleRate,
			channelCount: 1,
			async *samples() { yield first; yield second; },
			dispose() {},
		}),
	});

	assert.deepEqual(second.copies, [{ planeIndex: 0, frameOffset: 10, frameCount: 1_014 }]);
	assert.deepEqual([...decoded.channels[0]!.slice(1_022, 1_026)], [1, 1, 1_010, 1_011]);
	assert.equal(decoded.channels[0]![2_037], 2_023);
	assert.equal(decoded.channels[0]![2_038], 0);
	assert.equal(first.closed && second.closed, true);
});

test('browser container audio decode still rejects genuine timestamp overlap', async () => {
	const sampleRate = 44_100;
	const samples = [
		sample(0, [new Array(1_024).fill(1)], sampleRate),
		sample(0.02, [new Array(1_024).fill(2)], sampleRate),
	];
	await assert.rejects(() => decodeBrowserContainerAudio(new Blob(['webm']), {
		durationSeconds: 0.05,
		openSession: async () => ({
			timelineOrigin: 0,
			sampleRate,
			channelCount: 1,
			async *samples() { yield* samples; },
			dispose() {},
		}),
	}), /samples overlap/iu);
	assert.equal(samples.every(({ closed }) => closed), true);
});

function sample(timestamp: number, channels: readonly (readonly number[])[], sampleRate = 4): BrowserContainerAudioSample & {
	closed: boolean;
	afterCopy?: () => void;
	copies: Array<{ planeIndex: number; frameOffset: number; frameCount: number }>;
} {
	return {
		timestamp,
		sampleRate,
		numberOfFrames: channels[0]?.length ?? 0,
		numberOfChannels: channels.length,
		duration: (channels[0]?.length ?? 0) / sampleRate,
		closed: false,
		copies: [],
		copyTo(destination, options) {
			assert.equal(options.format, 'f32-planar');
			const frameOffset = options.frameOffset ?? 0;
			const frameCount = options.frameCount ?? (channels[options.planeIndex]?.length ?? 0) - frameOffset;
			this.copies.push({ planeIndex: options.planeIndex, frameOffset, frameCount });
			new Float32Array(
				destination.buffer, destination.byteOffset, destination.byteLength / Float32Array.BYTES_PER_ELEMENT,
			).set((channels[options.planeIndex] ?? []).slice(frameOffset, frameOffset + frameCount));
			this.afterCopy?.();
		},
		close() { this.closed = true; },
	};
}
