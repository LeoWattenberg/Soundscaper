/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

interface Bridge {
	beginWrite(value: unknown): Promise<unknown>;
	beginDesktopVideoCodecOperation(value: unknown): Promise<unknown>;
	statDesktopVideoCodecOutput(value: unknown): Promise<{ byteLength: number }>;
	runDesktopAudioCodecStreamCommand(value: unknown): Promise<unknown>;
	chooseLinkedVideoOriginal(): Promise<{ size: number }>;
	loadLinkedVideoOriginal(value: unknown): Promise<{ descriptor: { size: number } }>;
}

async function preload(invoke: (channel: string, value: unknown) => Promise<unknown>): Promise<Bridge> {
	const exposed = new Map<string, unknown>();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AbortSignal, ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name: string, value: unknown) { exposed.set(name, value); } },
			ipcRenderer: { invoke, send() {}, on() {}, removeListener() {}, postMessage() {} },
		}),
	});
	return (exposed.get('soundscaperDesktop') as { v1: Bridge }).v1;
}

test('save declarations reach main-process warning admission above 65 GiB while unsafe counts fail before IPC', async () => {
	const calls: unknown[] = [];
	const bridge = await preload(async (_channel, value) => { calls.push(value); return true; });
	await bridge.beginWrite({ targetId: 'a'.repeat(48), size: 65 * 1024 ** 3 + 1 });
	assert.equal((calls[0] as { size: number }).size, 65 * 1024 ** 3 + 1);
	for (const size of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5]) {
		assert.throws(() => bridge.beginWrite({ targetId: 'a'.repeat(48), size }));
	}
	assert.equal(calls.length, 1);
});

test('preload carries native-approved large locator and range/materialization metadata', async () => {
	const size = 66 * 1024 ** 3;
	const locatorId = 'a'.repeat(64), locatorRevision = 'b'.repeat(64);
	const choice = { locatorId, locatorRevision, name: 'large.mov', size, mimeType: 'video/quicktime', lastModified: 3 };
	const bridge = await preload(async (channel, request) => {
		if (channel.endsWith(':choose')) return choice;
		const profile = (request as { playback: boolean }).playback ? 'linked-video-range-v1' : 'materialized-v1';
		return { locatorRevision, descriptor: { id: 'c'.repeat(64), readProfile: profile,
			url: `soundscaper-app://bundle/_desktop/read/${profile}/${'c'.repeat(64)}/large.mov`,
			name: choice.name, mimeType: choice.mimeType, size, lastModified: 3 } };
	});
	assert.equal((await bridge.chooseLinkedVideoOriginal()).size, size);
	for (const playback of [true, false]) {
		assert.equal((await bridge.loadLinkedVideoOriginal({ locatorId, expectedRevision: locatorRevision, playback })).descriptor.size, size);
	}
});

test('desktop video and audio transports accept approved large files while retaining primitive and packet checks', async () => {
	const videoId = `desktop-video-${'1'.repeat(32)}`;
	const audioId = `desktop-audio-stream-${'1'.repeat(32)}`;
	const bridge = await preload(async (channel) => channel.endsWith(':begin')
		? { operationId: videoId } : channel.endsWith(':stat') ? { byteLength: 2 * 1024 ** 3 + 1 } : true);
	const plan = {
		schemaVersion: 1, format: 'mp4', quality: 'balanced', width: 2, height: 2,
		frameRate: { num: 1, den: 1 }, frameCount: 2, sampleRate: 48_000,
		durationFrames: 96_000, videoInputBytes: 32, audioInputBytes: 2 * 1024 ** 3 + 44,
		ringCapacityBytes: 4096, audioRingCapacityBytes: 4096, maximumOutputBytes: 3 * 1024 ** 3,
	};
	await bridge.beginDesktopVideoCodecOperation(plan);
	assert.equal((await bridge.statDesktopVideoCodecOutput({ operationId: videoId })).byteLength, 2 * 1024 ** 3 + 1);
	await bridge.runDesktopAudioCodecStreamCommand({ type: 'begin', plan: {
		schemaVersion: 1, frameCount: 48_000, maximumOutputBytes: 1_000_000_001,
		tuple: { operation: 'audio-encode', format: 'mp3', sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 192 } },
	} });
	await bridge.runDesktopAudioCodecStreamCommand({ type: 'read', operationId: audioId, offset: 1_000_000_001, maximumBytes: 1 });
	await assert.rejects(bridge.runDesktopAudioCodecStreamCommand({ type: 'read', operationId: audioId, offset: 0, maximumBytes: 1024 ** 2 + 1 }));
	await assert.rejects(bridge.beginDesktopVideoCodecOperation({ ...plan, maximumOutputBytes: Number.MAX_SAFE_INTEGER + 1 }));
});
