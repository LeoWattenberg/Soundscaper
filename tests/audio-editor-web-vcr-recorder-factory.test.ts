/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebVcrRecorderFactory } from '../src/common/editor/controller/web-vcr-recorder-factory.ts';

test('Web VCR recorder exposes only the frozen cropped track to the 8A encoder', async () => {
	const rawTrack = { kind: 'video', stop() {} };
	const croppedTrack = { kind: 'video', stop() {} };
	let encodedTrack: unknown = null;
	let cropDisposals = 0;
	let dimensions: unknown = null;
	const factory = createWebVcrRecorderFactory({
		base(request) {
			encodedTrack = request.source.track;
			return recorder();
		},
		frozenCrop: () => ({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }),
		openCrop(request) {
			assert.equal(request.source, rawTrack);
			assert.deepEqual(request.crop, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
			return {
				track: croppedTrack,
				firstFrame: Promise.resolve({
					inputSize: { width: 1_920, height: 1_080 },
					outputSize: { width: 960, height: 540 },
				}),
				async dispose() { cropDisposals += 1; },
			};
		},
		createStream: (tracks) => ({
			getTracks: () => tracks, getVideoTracks: () => tracks, getAudioTracks: () => [],
		}),
		onDimensions: (value) => { dimensions = value; },
	});
	const result = await factory(request(rawTrack));

	assert.equal(encodedTrack, croppedTrack);
	assert.deepEqual(dimensions, {
		inputSize: { width: 1_920, height: 1_080 }, outputSize: { width: 960, height: 540 },
	});
	await result.stop();
	await result.stop();
	await result.dispose();
	await result.dispose();
	assert.equal(cropDisposals, 1, 'stop and dispose share one crop teardown');
});

test('Web VCR page audio uses the unchanged 8A audio recorder path', async () => {
	const track = { kind: 'audio', stop() {} };
	let openedCrop = false;
	const factory = createWebVcrRecorderFactory({
		base: (value) => { assert.equal(value.source.track, track); return recorder(); },
		frozenCrop: () => ({ x: 0, y: 0, width: 1, height: 1 }),
		openCrop() { openedCrop = true; throw new Error('not reached'); },
		createStream: () => { throw new Error('not reached'); },
	});
	await factory(request(track, 'system-audio'));
	assert.equal(openedCrop, false);
});

test('Web VCR refuses a first-frame geometry mismatch before constructing the encoder', async () => {
	const rawTrack = { kind: 'video', stop() {} };
	let constructed = false;
	let cropDisposals = 0;
	const factory = createWebVcrRecorderFactory({
		base: () => { constructed = true; return recorder(); },
		frozenCrop: () => ({ x: 0, y: 0, width: 1, height: 1 }),
		openCrop: () => ({
			track: rawTrack,
			firstFrame: Promise.resolve({
				inputSize: { width: 1_280, height: 720 }, outputSize: { width: 1_280, height: 720 },
			}),
			async dispose() { cropDisposals += 1; },
		}),
		createStream: (tracks) => ({
			getTracks: () => tracks, getVideoTracks: () => tracks, getAudioTracks: () => [],
		}),
		onDimensions: () => { throw new Error('frozen surface mismatch'); },
	});
	await assert.rejects(async () => factory(request(rawTrack)), /surface mismatch/iu);
	assert.equal(constructed, false);
	assert.equal(cropDisposals, 1);
});

function request(track: { kind: string; stop(): void }, role: 'display' | 'system-audio' = 'display') {
	const stream = {
		getTracks: () => [track],
		getVideoTracks: () => role === 'display' ? [track] : [],
		getAudioTracks: () => role === 'system-audio' ? [track] : [],
	};
	return {
		sessionId: 'session', streamId: 'stream', sourceId: 'source', monitoring: false, inputGain: 1,
		source: { sourceId: 'source', role, track, stream, settings: {}, capabilities: {} },
		async onPacket() {}, onError() {}, onBackpressure() {},
	};
}

function recorder() {
	return {
		format: { kind: 'encoded-media' as const, mimeType: 'video/webm' },
		start() {}, pause: () => true, resume: () => true, stop() {}, dispose() {},
	};
}
