/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	validateWebVcrCaptureStateRequestV1,
	validateWebVcrCommandV1,
	validateWebVcrHandshakeV1,
	validateWebVcrSnapshotV1,
} from '../desktop/framescaper-web-vcr-contract.ts';

const SESSION_ID = 'a'.repeat(32);

test('desktop contract reuses and strengthens frozen common Web VCR DTOs', () => {
	const handshake = validateWebVcrHandshakeV1({
		version: 1,
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		captureGrantTtlMs: 10_000,
	});
	assert.equal(Object.isFrozen(handshake), true);
	assert.equal(Object.isFrozen(handshake.capability), true);

	const snapshot = validateWebVcrSnapshotV1(readySnapshot());
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.crop), true);
	assert.equal(Object.isFrozen(snapshot.navigation), true);
	assert.deepEqual(snapshot.captureSurface, { width: 1920, height: 1080 });
	assert.doesNotMatch(JSON.stringify(snapshot), /title|cookie|file|path/iu);
});

test('desktop contract rejects unsupported capabilities and malformed snapshots', () => {
	assert.throws(() => validateWebVcrHandshakeV1({
		version: 1,
		capability: { status: 'available', resolutions: ['4k'] },
		captureGrantTtlMs: 10_000,
	}), /baseline|resolution/iu);
	assert.throws(() => validateWebVcrSnapshotV1({
		...readySnapshot(),
		captureSurface: { width: 1280, height: 720 },
	}), /surface/iu);
	assert.throws(() => validateWebVcrSnapshotV1({
		...readySnapshot(),
		sessionId: 'raw-session-id',
	}), /identity/iu);
	assert.throws(() => validateWebVcrSnapshotV1({
		...readySnapshot(),
		navigation: { ...readySnapshot().navigation, url: 'http://example.com/' },
	}), /url|https/iu);
	assert.throws(() => validateWebVcrSnapshotV1({
		...readySnapshot(),
		filesystemPath: '/tmp/capture',
	}), /closed shape/iu);
});

test('sessionless closed snapshots retain retired generation while opening stays generation zero', () => {
	const retired = validateWebVcrSnapshotV1({
		...readySnapshot(),
		sessionId: null,
		generation: 4,
		phase: 'closed',
		visible: false,
		target: null,
		outputSize: null,
	});
	assert.equal(retired.sessionId, null);
	assert.equal(retired.generation, 4);
	assert.throws(() => validateWebVcrSnapshotV1({
		...retired,
		phase: 'opening',
	}), /generation-zero opening/iu);
	assert.throws(() => validateWebVcrSnapshotV1({
		...retired,
		phase: 'ready',
	}), /sessionless/iu);
});

test('desktop command validation follows the common union and adds opaque ownership', () => {
	assert.deepEqual(validateWebVcrCommandV1({
		version: 1, kind: 'navigate', sessionId: SESSION_ID, generation: 4,
		url: 'https://example.com/watch',
	}), {
		version: 1, kind: 'navigate', sessionId: SESSION_ID, generation: 4,
		url: 'https://example.com/watch',
	});
	assert.deepEqual(validateWebVcrCommandV1({
		version: 1, kind: 'pointer-input', sessionId: SESSION_ID, generation: 4,
		action: 'down', x: 0.25, y: 0.75, button: 'left', deltaX: 0, deltaY: 0, modifiers: [],
	}), {
		version: 1, kind: 'pointer-input', sessionId: SESSION_ID, generation: 4,
		action: 'down', x: 0.25, y: 0.75, button: 'left', deltaX: 0, deltaY: 0, modifiers: [],
	});
	assert.deepEqual(validateWebVcrCommandV1({
		version: 1, kind: 'set-crop', sessionId: SESSION_ID, generation: 4,
		crop: { x: 0, y: 0.1, width: 1, height: 0.8 }, aspect: '16:9',
	}), {
		version: 1, kind: 'set-crop', sessionId: SESSION_ID, generation: 4,
		crop: { x: 0, y: 0.1, width: 1, height: 0.8 }, aspect: '16:9',
	});

	assert.throws(() => validateWebVcrCommandV1({
		version: 1, kind: 'navigate', sessionId: SESSION_ID, generation: 4,
		url: 'https://user:secret@example.com/',
	}), /credentials/iu);
	assert.throws(() => validateWebVcrCommandV1({
		version: 1, kind: 'pointer-input', sessionId: SESSION_ID, generation: 4,
		action: 'move', x: 1.01, y: 0, button: 'none', deltaX: 0, deltaY: 0, modifiers: [],
	}), /pointer x|finite number/iu);
	assert.throws(() => validateWebVcrCommandV1({
		version: 1, kind: 'set-crop', sessionId: SESSION_ID, generation: 4,
		crop: { x: 0.8, y: 0, width: 0.3, height: 1 }, aspect: 'free',
	}), /crop/iu);
	assert.throws(() => validateWebVcrCommandV1({
		version: 1, kind: 'close-session', sessionId: 'raw-session-id', generation: 4,
	}), /identity/iu);
});

test('preparing alone requires a closed fresh take-token field', () => {
	assert.deepEqual(validateWebVcrCaptureStateRequestV1({
		version: 1, sessionId: SESSION_ID, generation: 4,
		state: 'preparing', recordingToken: 'c'.repeat(32),
	}), {
		version: 1, sessionId: SESSION_ID, generation: 4,
		state: 'preparing', recordingToken: 'c'.repeat(32),
	});
	assert.throws(() => validateWebVcrCaptureStateRequestV1({
		version: 1, sessionId: SESSION_ID, generation: 4, state: 'preparing',
	}), /missing|recording/iu);
	assert.throws(() => validateWebVcrCaptureStateRequestV1({
		version: 1, sessionId: SESSION_ID, generation: 4,
		state: 'ready', recordingToken: 'c'.repeat(32),
	}), /unsupported/iu);
});

function readySnapshot() {
	return {
		version: 1,
		sessionId: SESSION_ID,
		generation: 4,
		phase: 'ready',
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		resolution: '1080p',
		aspect: 'free',
		crop: { x: 0, y: 0, width: 1, height: 1 },
		autoCrop: true,
		monitorMuted: false,
		autoStop: false,
		visible: true,
		navigation: {
			generation: 3,
			url: 'https://example.com/watch',
			canGoBack: false,
			canGoForward: false,
			isLoading: false,
		},
		target: {
			targetId: 'b'.repeat(32),
			generation: 9,
			mediaState: 'playing',
			aperture: { x: 0, y: 0, width: 1, height: 1 },
			intrinsicSize: { width: 1280, height: 720 },
		},
		targetEndedRecordingToken: null,
		captureSurface: { width: 1920, height: 1080 },
		outputSize: { width: 1280, height: 720 },
		metrics: null,
		failure: null,
	};
}
