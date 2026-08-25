/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ID = `desktop-video-${'1'.repeat(32)}`;
const PLAN = Object.freeze({
	schemaVersion: 1, format: 'mp4', quality: 'balanced', width: 2, height: 2,
	frameRate: Object.freeze({ num: 1, den: 1 }), frameCount: 2,
	sampleRate: 48_000, durationFrames: 96_000, videoInputBytes: 32,
	audioInputBytes: null, ringCapacityBytes: 4_096, audioRingCapacityBytes: null,
	maximumOutputBytes: 1024 * 1024,
});
const CAPABILITIES = Object.freeze({
	schemaVersion: 1,
	formats: Object.freeze({
		mp4: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
		webm: Object.freeze({ available: false, provider: null, reason: 'Configure FFmpeg.' }),
	}),
});

test('preload exposes closed primitive video session DTOs without path or argv authority', async () => {
	const fixture = await preload((channel, value) => {
		if (channel.endsWith(':capabilities')) return CAPABILITIES;
		if (channel.endsWith(':begin')) return { operationId: ID };
		if (channel.endsWith(':write')) return { offset: value.offset + value.bytes.byteLength };
		if (channel.endsWith(':close')) return { offset: value.offset };
		if (channel.endsWith(':execute')) return { exitCode: 0 };
		if (channel.endsWith(':stat')) return { byteLength: 24 };
		if (channel.endsWith(':read')) return Uint8Array.of(1, 2, 3);
		return true;
	});
	assert.equal(JSON.stringify(await fixture.bridge.getDesktopVideoExportCapabilities()), JSON.stringify(CAPABILITIES));
	assert.equal((await fixture.bridge.beginDesktopVideoCodecOperation(PLAN)).operationId, ID);
	assert.equal((await fixture.bridge.writeDesktopVideoCodecInput({
		operationId: ID, role: 'video', offset: 0, bytes: Uint8Array.of(1, 2),
	})).offset, 2);
	assert.equal((await fixture.bridge.closeDesktopVideoCodecInput({
		operationId: ID, role: 'video', offset: 2,
	})).offset, 2);
	assert.equal((await fixture.bridge.executeDesktopVideoCodecOperation({ operationId: ID })).exitCode, 0);
	assert.equal((await fixture.bridge.statDesktopVideoCodecOutput({ operationId: ID })).byteLength, 24);
	assert.deepEqual([...(await fixture.bridge.readDesktopVideoCodecOutput({
		operationId: ID, offset: 0, maximumBytes: 3,
	}))], [1, 2, 3]);
	assert.equal(await fixture.bridge.deleteDesktopVideoCodecOperation({ operationId: ID }), true);
	assert.equal(await fixture.bridge.cancelDesktopVideoCodecOperation(ID), true);
	assert.equal(fixture.invocations.some(([, request]) => request?.executablePath || request?.arguments), false);
});

test('preload refuses video authority expansion, oversized transfer, and malformed main results', async () => {
	const fixture = await preload((channel) => channel.endsWith(':begin')
		? { operationId: ID, outputPath: '/private/output.mp4' }
		: true);
	await assert.rejects(
		() => fixture.bridge.beginDesktopVideoCodecOperation({ ...PLAN, executablePath: '/tmp/ffmpeg' }),
		/fields|plan/iu,
	);
	await assert.rejects(() => fixture.bridge.beginDesktopVideoCodecOperation(PLAN), /begin result/iu);
	await assert.rejects(() => fixture.bridge.writeDesktopVideoCodecInput({
		operationId: ID, role: 'video', offset: 0, bytes: new Uint8Array(1024 * 1024 + 1),
	}), /input write/iu);
	await assert.rejects(() => fixture.bridge.readDesktopVideoCodecOutput({
		operationId: ID, offset: 0, maximumBytes: 1024 * 1024 + 1,
	}), /output read/iu);
	assert.equal(fixture.invocations.length, 1, 'only the valid plan may reach main');
});

async function preload(response) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer, clearTimeout, Date, Float32Array, JSON, Map, Number, Object, Promise,
		RangeError, Reflect, Set, setTimeout, String, structuredClone, TextEncoder,
		TypeError, Uint8Array, URL,
		window: { postMessage() {} },
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) { if (name === 'soundscaperDesktop') bridge = value.v1; },
			},
			ipcRenderer: {
				invoke(channel, value) { invocations.push([channel, value]); return Promise.resolve(response(channel, value)); },
				send() {}, on() {}, removeListener() {}, postMessage() {},
			},
		}),
	});
	assert.ok(bridge);
	return { bridge, invocations };
}
