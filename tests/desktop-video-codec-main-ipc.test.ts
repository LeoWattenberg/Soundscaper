/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerDesktopVideoCodecMainIpc } from '../desktop/desktop-video-codec-main-ipc.ts';

const CHANNELS = Object.freeze({
	desktopVideoCodecCapabilities: 'video:capabilities', desktopVideoCodecBegin: 'video:begin',
	desktopVideoCodecWrite: 'video:write', desktopVideoCodecClose: 'video:close',
	desktopVideoCodecExecute: 'video:execute', desktopVideoCodecStat: 'video:stat',
	desktopVideoCodecRead: 'video:read', desktopVideoCodecDelete: 'video:delete',
	desktopVideoCodecCancel: 'video:cancel',
});

test('desktop video IPC exposes only closed primitive DTOs and forwards renderer ownership', async () => {
	const handlers = new Map<string, (event: unknown, ...arguments_: unknown[]) => unknown>();
	const owner = {};
	const calls: Array<readonly [string, unknown, unknown]> = [];
	const service = Object.freeze({
		async capabilities() {
			return {
				schemaVersion: 1 as const,
				formats: {
					mp4: { available: false, provider: null, reason: 'test unavailable' },
					webm: { available: false, provider: null, reason: 'test unavailable' },
				},
			};
		},
		async begin(owner_: object, value: unknown) { calls.push(['begin', owner_, value]); return { operationId: `desktop-video-${'1'.repeat(32)}` }; },
		async writeInput(owner_: object, value: unknown) { calls.push(['write', owner_, value]); return { offset: 1 }; },
		async closeInput(owner_: object, value: unknown) { calls.push(['close', owner_, value]); return { offset: 1 }; },
		async execute(owner_: object, value: unknown) { calls.push(['execute', owner_, value]); return { exitCode: 0 as const }; },
		async statOutput(owner_: object, value: unknown) { calls.push(['stat', owner_, value]); return { byteLength: 1 }; },
		async readOutput(owner_: object, value: unknown) { calls.push(['read', owner_, value]); return Uint8Array.of(1); },
		async delete(owner_: object, value: unknown) { calls.push(['delete', owner_, value]); return true; },
		async cancel(owner_: object, value: unknown) { calls.push(['cancel', owner_, value]); return true; },
		revokeOwner: async () => false,
		async dispose() {},
	});
	const registration = registerDesktopVideoCodecMainIpc({
		channels: CHANNELS,
		handle(channel, listener) { handlers.set(channel, listener); },
		removeHandler(channel) { handlers.delete(channel); },
		ownerFor: () => owner,
		service,
	});
	const id = `desktop-video-${'1'.repeat(32)}`;
	await handlers.get(CHANNELS.desktopVideoCodecWrite)?.({}, {
		operationId: id, role: 'video', offset: 0, bytes: Uint8Array.of(1),
	});
	assert.deepEqual(calls[0], ['write', owner, {
		operationId: id, role: 'video', offset: 0, bytes: Uint8Array.of(1),
	}]);
	await assert.rejects(
		async () => handlers.get(CHANNELS.desktopVideoCodecExecute)?.({}, {
			operationId: id, executablePath: '/tmp/ffmpeg',
		}),
		/unsupported field/u,
	);
	await assert.rejects(
		async () => handlers.get(CHANNELS.desktopVideoCodecWrite)?.({}, {
			operationId: id, role: 'video', offset: 0, bytes: new Uint8Array(1024 * 1024 + 1),
		}),
		/chunk/u,
	);
	registration.dispose();
	assert.equal(handlers.size, 0);
});
