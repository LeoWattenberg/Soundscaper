/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureDesktopPortV1,
	type FramescaperCaptureDesktopPortV1,
} from '../desktop/framescaper-capture-desktop-port.ts';

const OWNER = Object.freeze(Object.create(null)) as object;
const OTHER_OWNER = Object.freeze(Object.create(null)) as object;

test('lists a bounded pathless source inventory and consumes its opaque selection once', async () => {
	const harness = port({
		sources: Array.from({ length: 70 }, (_, index) => ({
			id: index % 2 === 0 ? `screen:${String(index)}:0` : `window:${String(index)}:0`,
			name: index === 0 ? 'Entire\u0000 Screen' : `Window ${String(index)}`,
		})),
	});
	const listed = await harness.value.listSources(OWNER, 1);

	assert.equal(listed.sources.length, 64);
	assert.deepEqual(listed.sources[0], {
		token: '00000000000000000000000000000001',
		name: 'Entire Screen',
		kind: 'screen',
	});
	assert.doesNotMatch(JSON.stringify(listed), /screen:0:0|window:1:0/u);
	const granted = harness.value.grant(OWNER, {
		generation: 1,
		roles: ['camera', 'microphone', 'display', 'system-audio'],
		sourceToken: listed.sources[0]?.token,
	});
	assert.equal(granted.generation, 1);
	assert.deepEqual(granted.roles, ['camera', 'microphone', 'display', 'system-audio']);
	assert.equal(harness.value.allowsMedia(OWNER, ['video', 'audio']), true,
		'permission checks observe without consuming camera or microphone authority');
	assert.equal(harness.value.allowsDisplayPermission(OWNER), true);
	assert.equal(harness.value.consumeMediaGrant(OWNER, ['video', 'audio']), true);
	assert.equal(harness.value.allowsMedia(OWNER, ['video']), false);
	assert.equal(harness.value.allowsMedia(OWNER, ['audio']), false);
	assert.equal(harness.value.consumeMediaGrant(OWNER, ['video', 'audio']), false);

	const first = harness.value.consumeDisplayGrant(OWNER, {
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	});
	assert.deepEqual(first, {
		video: { id: 'screen:0:0', name: 'Entire\u0000 Screen' },
		audio: 'loopback',
	});
	assert.equal(harness.value.allowsDisplayPermission(OWNER), false);
	assert.equal(harness.value.consumeDisplayGrant(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: true,
	}), null);
	assert.throws(() => harness.value.grant(OWNER, {
		generation: 1, roles: ['display'], sourceToken: listed.sources[0]?.token,
	}), /stale|consumed/iu);
});

test('camera and microphone authority are independently single-use and consume atomically', () => {
	const harness = port();
	harness.value.grant(OWNER, {
		generation: 1,
		roles: ['camera', 'microphone'],
		sourceToken: null,
	});

	assert.equal(harness.value.consumeMediaGrant(OWNER, ['video']), true);
	assert.equal(harness.value.allowsMedia(OWNER, ['video']), false);
	assert.equal(harness.value.allowsMedia(OWNER, ['audio']), true);
	assert.equal(harness.value.consumeMediaGrant(OWNER, ['video', 'audio']), false,
		'a partially unavailable combined request must consume no remaining role');
	assert.equal(harness.value.allowsMedia(OWNER, ['audio']), true);
	assert.equal(harness.value.consumeMediaGrant(OWNER, ['audio']), true);
	assert.equal(harness.value.consumeMediaGrant(OWNER, ['audio']), false);
});

test('generation, owner, expiry, gesture, and requested media stay fail-closed', async () => {
	const harness = port();
	const listed = await harness.value.listSources(OWNER, 4);
	assert.throws(() => harness.value.grant(OTHER_OWNER, {
		generation: 4, roles: ['display'], sourceToken: listed.sources[0]?.token,
	}), /generation|inventory/iu);
	assert.throws(() => harness.value.grant(OWNER, {
		generation: 3, roles: ['display'], sourceToken: listed.sources[0]?.token,
	}), /generation/iu);
	harness.value.grant(OWNER, {
		generation: 4, roles: ['camera', 'display'], sourceToken: listed.sources[0]?.token,
	});
	assert.equal(harness.value.allowsMedia(OWNER, ['audio']), false);
	assert.equal(harness.value.consumeDisplayGrant(OWNER, {
		userGesture: false, videoRequested: true, audioRequested: false,
	}), null);
	assert.equal(harness.value.allowsDisplayPermission(OWNER), true,
		'a rejected non-gesture request must not consume the one-shot grant');

	harness.advance(15_001);
	assert.equal(harness.value.allowsMedia(OWNER, ['video']), false);
	assert.equal(harness.value.allowsDisplayPermission(OWNER), false);
	assert.equal(harness.value.consumeDisplayGrant(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: false,
	}), null);
	assert.equal(harness.value.teardown(OWNER, 4), false, 'expiry already retired the generation');
});

test('source inventories expire, reject replays, and a newer generation revokes the older one', async () => {
	const harness = port();
	const first = await harness.value.listSources(OWNER, 1);
	await assert.rejects(() => harness.value.listSources(OWNER, 1), /newer generation/iu);
	harness.advance(300_001);
	assert.throws(() => harness.value.grant(OWNER, {
		generation: 1, roles: ['display'], sourceToken: first.sources[0]?.token,
	}), /expired|generation/iu);

	const second = await harness.value.listSources(OWNER, 2);
	harness.value.grant(OWNER, {
		generation: 2, roles: ['display'], sourceToken: second.sources[0]?.token,
	});
	assert.equal(harness.value.teardown(OWNER, 1), false);
	assert.equal(harness.value.teardown(OWNER, 2), true);
	assert.equal(harness.value.allowsDisplayPermission(OWNER), false);
});

test('macOS 15 uses the native picker while system audio remains truthfully unavailable', () => {
	const harness = port({ platform: 'darwin', systemVersion: '15.4.1' });
	assert.deepEqual(harness.value.status(), {
		version: 1,
		available: true,
		unavailableReason: null,
		selectionMode: 'system-picker',
		systemAudio: 'unavailable',
		sourceLimit: 64,
		sourceListTtlMs: 300_000,
		grantTtlMs: 15_000,
	});
	assert.throws(() => harness.value.grant(OWNER, {
		generation: 1,
		roles: ['display', 'system-audio'],
		sourceToken: null,
	}), /system audio/iu);
	const granted = harness.value.grant(OWNER, {
		generation: 1, roles: ['display'], sourceToken: null,
	});
	assert.equal(granted.generation, 1);
	assert.equal(harness.value.allowsDisplayPermission(OWNER), true);
	assert.equal(harness.value.consumeSystemPickerGrant(OWNER), true);
	assert.equal(harness.value.consumeSystemPickerGrant(OWNER), false);
	assert.equal(harness.value.allowsDisplayPermission(OWNER), false);
	assert.equal(harness.value.consumeDisplayGrant(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: false,
	}), null, 'the native picker, not the fallback handler, owns source delivery');
});

test('the port is Framescaper-only and reports unsupported desktop platforms without probing', async () => {
	let probes = 0;
	const soundscaper = port({ productId: 'soundscaper', onList: () => { probes += 1; } });
	assert.equal(soundscaper.value.status().unavailableReason, 'unsupported-product');
	await assert.rejects(() => soundscaper.value.listSources(OWNER, 1), /unavailable/iu);
	const unsupported = port({ platform: 'freebsd', onList: () => { probes += 1; } });
	assert.equal(unsupported.value.status().unavailableReason, 'unsupported-platform');
	await assert.rejects(() => unsupported.value.listSources(OWNER, 1), /unavailable/iu);
	assert.equal(probes, 0);
});

test('revocation and disposal retire every generation without leaking source authority', async () => {
	const harness = port();
	const first = await harness.value.listSources(OWNER, 1);
	harness.value.grant(OWNER, {
		generation: 1, roles: ['display'], sourceToken: first.sources[0]?.token,
	});
	assert.equal(harness.value.revokeOwner(OWNER), true);
	assert.equal(harness.value.allowsDisplayPermission(OWNER), false);
	const second = await harness.value.listSources(OTHER_OWNER, 1);
	harness.value.grant(OTHER_OWNER, {
		generation: 1, roles: ['display'], sourceToken: second.sources[0]?.token,
	});
	harness.value.dispose();
	assert.equal(harness.value.allowsDisplayPermission(OTHER_OWNER), false);
	await assert.rejects(() => harness.value.listSources(OTHER_OWNER, 2), /disposed/iu);
});

function port(options: {
	readonly productId?: string;
	readonly platform?: string;
	readonly systemVersion?: string;
	readonly sources?: readonly Readonly<{ id: string; name: string }>[];
	readonly onList?: () => void;
} = {}): {
	readonly value: FramescaperCaptureDesktopPortV1;
	readonly advance: (milliseconds: number) => void;
} {
	let nowMs = 10_000;
	let nextId = 1;
	const value = createFramescaperCaptureDesktopPortV1({
		productId: options.productId ?? 'framescaper',
		platform: options.platform ?? 'win32',
		systemVersion: options.systemVersion ?? '11.0.0',
		now: () => nowMs,
		createOpaqueId: () => (nextId++).toString(16).padStart(32, '0'),
		listDesktopSources: async () => {
			options.onList?.();
			return options.sources ?? [{ id: 'screen:1:0', name: 'Screen 1' }];
		},
	});
	return {
		value,
		advance: (milliseconds) => { nowMs += milliseconds; },
	};
}
