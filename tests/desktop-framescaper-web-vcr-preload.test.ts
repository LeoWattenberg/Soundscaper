/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_WEB_VCR_CHANNELS,
} from '../desktop/framescaper-web-vcr-main-channels.ts';
import {
	createFramescaperWebVcrPreloadBridgeV1,
} from '../desktop/framescaper-web-vcr-preload.ts';
import {
	registerFramescaperWebVcrTrustedPreloadV1,
} from '../desktop/framescaper-web-vcr-preload-registration.ts';

const SESSION_ID = 'a'.repeat(32);

test('trusted preload exposes six frozen pathless operations with double validation', async () => {
	const calls: Array<Readonly<{ channel: string; value: unknown }>> = [];
	const subscription: {
		listener: ((event: unknown, payload: unknown) => void) | null;
	} = { listener: null };
	const bridge = createFramescaperWebVcrPreloadBridgeV1({
		invoke: async (channel, value) => {
			calls.push({ channel, value });
			switch (channel) {
				case FRAMESCAPER_WEB_VCR_CHANNELS.handshake: return handshake();
				case FRAMESCAPER_WEB_VCR_CHANNELS.open: return snapshot();
				case FRAMESCAPER_WEB_VCR_CHANNELS.dispatch:
					return { version: 1, kind: 'snapshot', snapshot: snapshot() };
				case FRAMESCAPER_WEB_VCR_CHANNELS.prepareCapture:
					return {
						version: 1, grantId: 'b'.repeat(32), sessionId: SESSION_ID,
						generation: 1, expiresAtMs: 12_000,
					};
				case FRAMESCAPER_WEB_VCR_CHANNELS.setCaptureState: return true;
				case FRAMESCAPER_WEB_VCR_CHANNELS.dispose: return true;
				default: throw new Error(`Unexpected ${channel}`);
			}
		},
		on: (_channel, listener) => { subscription.listener = listener; },
		removeListener: (_channel, listener) => {
			if (subscription.listener === listener) subscription.listener = null;
		},
	});
	assert.deepEqual(Object.keys(bridge).sort(), [
		'dispatch', 'dispose', 'handshake', 'open', 'prepareCapture', 'setCaptureState', 'subscribe',
	]);
	assert.equal(Object.isFrozen(bridge), true);
	assert.deepEqual(await bridge.handshake(), handshake());
	assert.equal((await bridge.open({ resolution: '1080p' })).sessionId, SESSION_ID);
	assert.equal((await bridge.dispatch({
		version: 1, kind: 'set-visibility', sessionId: SESSION_ID, generation: 1, visible: false,
	})).kind, 'snapshot');
	assert.equal((await bridge.prepareCapture({
		version: 1, sessionId: SESSION_ID, generation: 1,
	})).grantId, 'b'.repeat(32));
	assert.equal(await bridge.setCaptureState({
		version: 1, sessionId: SESSION_ID, generation: 1, state: 'preparing',
		recordingToken: 'c'.repeat(32),
	}), true);

	const updates: unknown[] = [];
	const unsubscribe = bridge.subscribe((value) => updates.push(value));
	assert.equal(typeof subscription.listener, 'function');
	subscription.listener?.({}, snapshot());
	assert.equal(updates.length, 1);
	unsubscribe();
	assert.equal(subscription.listener, null);
	assert.equal(await bridge.dispose({ version: 1, sessionId: SESSION_ID, generation: 1 }), true);
	assert.equal(calls.length, 6);
});

test('trusted preload rejects malformed values on both sides of IPC', async () => {
	let calls = 0;
	const local = createFramescaperWebVcrPreloadBridgeV1({
		invoke: async () => { calls += 1; return null; },
		on: () => undefined,
		removeListener: () => undefined,
	});
	await assert.rejects(() => local.open({ resolution: '8k' }), /resolution/iu);
	await assert.rejects(() => local.prepareCapture({
		version: 1, sessionId: 'raw-id', generation: 1,
	}), /session/iu);
	await assert.rejects(() => local.dispose({
		version: 1, sessionId: SESSION_ID, generation: 0,
	}), /generation/iu);
	assert.equal(calls, 0);

	const remote = createFramescaperWebVcrPreloadBridgeV1({
		invoke: async () => ({ ...handshake(), filesystemPath: '/tmp/leak' }),
		on: () => undefined,
		removeListener: () => undefined,
	});
	await assert.rejects(() => remote.handshake(), /unsupported fields/iu);
});

test('preload registration is Framescaper-only, versioned, and independently disposable', () => {
	const registered: unknown[] = [];
	const removed: string[] = [];
	const registration = registerFramescaperWebVcrTrustedPreloadV1({
		productId: 'framescaper',
		preloadPath: '/app/framescaper-web-vcr-sandbox-preload.cjs',
		trustedAppSession: {
			registerPreloadScript: (value) => { registered.push(value); return 'preload-1'; },
			unregisterPreloadScript: (id) => { removed.push(id); },
		},
	});
	assert.deepEqual(registered, [{
		type: 'frame', filePath: '/app/framescaper-web-vcr-sandbox-preload.cjs',
	}]);
	registration.dispose();
	registration.dispose();
	assert.deepEqual(removed, ['preload-1']);
	assert.throws(() => registerFramescaperWebVcrTrustedPreloadV1({
		productId: 'soundscaper',
		preloadPath: '/app/framescaper-web-vcr-sandbox-preload.cjs',
		trustedAppSession: {
			registerPreloadScript: () => 'never', unregisterPreloadScript: () => undefined,
		},
	}), /Framescaper/iu);
});

function handshake() {
	return {
		version: 1,
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		captureGrantTtlMs: 10_000,
	};
}

function snapshot() {
	return {
		version: 1, sessionId: SESSION_ID, generation: 1, phase: 'ready',
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		resolution: '1080p', aspect: 'free',
		crop: { x: 0, y: 0, width: 1, height: 1 },
		autoCrop: true, monitorMuted: false, autoStop: false, visible: true,
		navigation: {
			generation: 1, url: 'about:blank', canGoBack: false,
			canGoForward: false, isLoading: false,
		},
		target: null,
		targetEndedRecordingToken: null,
		captureSurface: { width: 1920, height: 1080 },
		outputSize: null,
		metrics: null,
		failure: null,
	};
}
