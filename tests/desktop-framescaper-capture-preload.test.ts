/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureDesktopPreloadBridgeV1,
} from '../desktop/framescaper-capture-preload.ts';
import {
	FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS,
} from '../desktop/framescaper-capture-main-channels.js';

test('preload exposes four bounded pathless operations and revalidates every result', async () => {
	const calls: Array<Readonly<{ channel: string; value: unknown }>> = [];
	const bridge = createFramescaperCaptureDesktopPreloadBridgeV1({
		invoke: async (channel, value) => {
			calls.push({ channel, value });
			switch (channel) {
				case FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.status:
					return status();
				case FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.listSources:
					return {
						generation: 7, selectionMode: 'source-list', expiresAtMs: 301_000,
						sources: [{ token: 'a'.repeat(32), name: 'Screen 1', kind: 'screen' }],
					};
				case FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.grant:
					return {
						grantId: 'b'.repeat(32), generation: 7, expiresAtMs: 16_000,
						roles: ['display', 'system-audio'],
					};
				case FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.teardown:
					return true;
				default:
					throw new Error(`Unexpected ${channel}`);
			}
		},
	});

	assert.deepEqual(Object.keys(bridge).sort(), ['grant', 'listSources', 'status', 'teardown']);
	assert.equal(Object.isFrozen(bridge), true);
	assert.deepEqual(await bridge.status(), status());
	const listed = await bridge.listSources(7);
	assert.equal(Object.isFrozen(listed), true);
	assert.equal(Object.isFrozen(listed.sources), true);
	assert.equal(Object.isFrozen(listed.sources[0]), true);
	const grant = await bridge.grant({
		generation: 7, roles: ['display', 'system-audio'], sourceToken: 'a'.repeat(32),
	});
	assert.equal(Object.isFrozen(grant), true);
	assert.equal(await bridge.teardown(7), true);
	assert.deepEqual(calls, [
		{ channel: FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.status, value: undefined },
		{ channel: FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.listSources, value: 7 },
		{
			channel: FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.grant,
			value: { generation: 7, roles: ['display', 'system-audio'], sourceToken: 'a'.repeat(32) },
		},
		{ channel: FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.teardown, value: 7 },
	]);
});

test('preload rejects malformed requests before IPC and malformed main responses after IPC', async () => {
	let calls = 0;
	const local = createFramescaperCaptureDesktopPreloadBridgeV1({
		invoke: async () => { calls += 1; return null; },
	});
	await assert.rejects(() => local.listSources(0), /generation/iu);
	await assert.rejects(() => local.grant({
		generation: 1, roles: ['system-audio'], sourceToken: null,
	}), /requires display/iu);
	await assert.rejects(() => local.grant({
		generation: 1, roles: ['display'], sourceToken: 'raw-screen-id',
	}), /token/iu);
	await assert.rejects(() => local.teardown(Number.NaN), /generation/iu);
	assert.equal(calls, 0);

	const remote = createFramescaperCaptureDesktopPreloadBridgeV1({
		invoke: async (channel) => channel === FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.status
			? { ...status(), rawSourceId: 'screen:0:0' }
			: false,
	});
	await assert.rejects(() => remote.status(), /unsupported fields/iu);
	await assert.rejects(() => remote.listSources(1), /source list/iu);
	await assert.rejects(() => remote.grant({ generation: 1, roles: ['camera'], sourceToken: null }), /grant/iu);
});

function status() {
	return {
		version: 1,
		available: true,
		unavailableReason: null,
		selectionMode: 'source-list',
		systemAudio: 'windows-loopback',
		sourceLimit: 64,
		sourceListTtlMs: 300_000,
		grantTtlMs: 15_000,
	};
}
