/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerExternalFfmpegPreferenceMainIpc } from '../desktop/external-ffmpeg-preference-main-ipc.ts';

const CHANNELS = Object.freeze({
	externalFfmpegStatus: 'status', externalFfmpegChoose: 'choose',
	externalFfmpegClear: 'clear', externalFfmpegRescan: 'rescan',
	externalFfmpegInstall: 'install',
});

test('the FFmpeg preference IPC exposes five argument-free actions and nothing else', async () => {
	const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
	const calls: string[] = [];
	const registration = registerExternalFfmpegPreferenceMainIpc({
		channels: CHANNELS,
		handle(channel, listener) { handlers.set(channel, listener); },
		removeHandler(channel) { handlers.delete(channel); },
		service: {
			status: () => response(calls, 'status'), choose: () => response(calls, 'choose'),
			clear: () => response(calls, 'clear'), rescan: () => response(calls, 'rescan'),
			install: () => response(calls, 'install'),
		},
	});
	assert.deepEqual([...handlers.keys()], ['status', 'choose', 'clear', 'rescan', 'install']);
	for (const name of ['status', 'choose', 'clear', 'rescan', 'install']) {
		assert.deepEqual(await handlers.get(name)?.({ sender: 'trusted-main-wrapper' }), { state: name });
		await assert.rejects(
			Promise.resolve().then(() => handlers.get(name)?.({}, 'unexpected')),
			/does not accept renderer arguments/iu,
		);
	}
	assert.deepEqual(calls, ['status', 'choose', 'clear', 'rescan', 'install']);
	registration.dispose();
	assert.equal(handlers.size, 0);
	registration.dispose();
});

test('duplicate channels and malformed ports are rejected before registration', () => {
	assert.throws(() => registerExternalFfmpegPreferenceMainIpc({
		channels: { ...CHANNELS, externalFfmpegInstall: 'status' },
		handle() {}, removeHandler() {}, service: serviceFixture(),
	}), /unique/iu);
	assert.throws(() => registerExternalFfmpegPreferenceMainIpc({
		channels: CHANNELS, handle: null as never, removeHandler() {}, service: serviceFixture(),
	}), /ports/iu);
});

function serviceFixture() {
	return {
		status: () => Promise.resolve({ state: 'unconfigured' as const }),
		choose: () => Promise.resolve({ state: 'unconfigured' as const }),
		clear: () => Promise.resolve({ state: 'unconfigured' as const }),
		rescan: () => Promise.resolve({ state: 'unconfigured' as const }),
		install: () => Promise.resolve({ state: 'unconfigured' as const }),
	};
}

function response(calls: string[], name: string): Promise<{ readonly state: string }> {
	calls.push(name);
	return Promise.resolve(Object.freeze({ state: name }));
}
