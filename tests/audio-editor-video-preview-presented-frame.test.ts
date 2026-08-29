/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoPreviewPresentedFrameGate,
	type VideoPreviewPresentedFrameSource,
} from '../src/common/editor/controller/video-preview-presented-frame.ts';

test('presented-frame gate coalesces readiness until the browser authenticates one picture', () => {
	const gate = createVideoPreviewPresentedFrameGate();
	const source = fakeSource();
	const frame = {};
	let presented = 0;
	const onPresented = (): void => { presented += 1; };

	gate.request(source, frame, onPresented);
	gate.request(source, frame, onPresented);
	gate.request(source, frame, onPresented);
	assert.equal(source.requested.length, 1);
	assert.equal(presented, 0);

	source.present(1);
	assert.equal(presented, 1);
	gate.request(source, frame, onPresented);
	assert.equal(source.requested.length, 2);
	gate.cancel();
	gate.cancel();
	assert.deepEqual(source.cancelled, [2]);
});

test('presented-frame gate cancels replaced sources and ignores their late callbacks', () => {
	const gate = createVideoPreviewPresentedFrameGate();
	const first = fakeSource();
	const second = fakeSource();
	let presented = 0;
	gate.request(first, {}, () => { presented += 1; });
	const stale = first.requested[0]!;

	gate.request(second, {}, () => { presented += 1; });
	assert.deepEqual(first.cancelled, [1]);
	stale(0, metadata());
	assert.equal(presented, 0);
	second.present(1);
	assert.equal(presented, 1);
});

test('presented-frame gate replaces stale evidence for a newer frame on the same source', () => {
	const gate = createVideoPreviewPresentedFrameGate();
	const source = fakeSource();
	let presented = 0;
	gate.request(source, {}, () => { presented += 1; });
	const stale = source.requested[0]!;

	gate.request(source, {}, () => { presented += 1; });
	assert.deepEqual(source.cancelled, [1]);
	stale(0, metadata());
	assert.equal(presented, 0);
	source.present(2);
	assert.equal(presented, 1);
});

test('presented-frame gate falls back when the browser callback is unavailable or throws', () => {
	const gate = createVideoPreviewPresentedFrameGate();
	let presented = 0;
	gate.request({}, {}, () => { presented += 1; });
	gate.request({
		requestVideoFrameCallback: () => { throw new Error('detached'); },
		cancelVideoFrameCallback: () => undefined,
	}, {}, () => { presented += 1; });
	gate.request({
		requestVideoFrameCallback: (callback) => {
			callback(0, metadata());
			return 1;
		},
		cancelVideoFrameCallback: () => undefined,
	}, {}, () => { presented += 1; });
	assert.equal(presented, 3);
	gate.cancel();
});

interface FakeSource extends VideoPreviewPresentedFrameSource {
	readonly requested: VideoFrameRequestCallback[];
	readonly cancelled: number[];
	present(id: number): void;
}

function fakeSource(): FakeSource {
	const callbacks = new Map<number, VideoFrameRequestCallback>();
	const requested: VideoFrameRequestCallback[] = [];
	const cancelled: number[] = [];
	let nextId = 1;
	return {
		requested,
		cancelled,
		requestVideoFrameCallback: (callback) => {
			const id = nextId;
			nextId += 1;
			callbacks.set(id, callback);
			requested.push(callback);
			return id;
		},
		cancelVideoFrameCallback: (id) => {
			callbacks.delete(id);
			cancelled.push(id);
		},
		present: (id) => {
			const callback = callbacks.get(id);
			assert.ok(callback);
			callbacks.delete(id);
			callback(0, metadata());
		},
	};
}

function metadata(): VideoFrameCallbackMetadata {
	return {
		expectedDisplayTime: 0,
		height: 1,
		mediaTime: 0,
		presentationTime: 0,
		presentedFrames: 1,
		width: 1,
	};
}
