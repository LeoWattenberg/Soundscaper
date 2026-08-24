/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorCodecRuntime as createBrowserRuntime } from '../src/common/editor/editor-codec-runtime.ts';
import {
	DesktopCodecRuntimeUnavailableError,
	createEditorCodecRuntime as createDesktopRuntime,
} from '../src/common/editor/editor-codec-runtime.desktop.ts';
import {
	createDesktopAudioCodecResult,
	type DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';

test('browser codec composition retains the lazy browser FFmpeg runtime', () => {
	const runtime = createBrowserRuntime({ idleTimeoutMs: false });
	assert.equal(typeof runtime.load, 'function');
	assert.equal(typeof runtime.decode, 'function');
	assert.equal(typeof runtime.encodeFileToSink, 'function');
	runtime.dispose();
});

test('desktop codec composition fails closed without a main-process operation bridge', async () => {
	const runtime = createDesktopRuntime();
	const capabilities = runtime.capabilities();
	const formats = capabilities.formats as Readonly<Record<string, Readonly<{ available: boolean }>>>;
	assert.equal(formats.wav?.available, true);
	assert.equal(formats.mp3?.available, false);
	await assert.rejects(
		() => runtime.load(),
		(error) => error instanceof DesktopCodecRuntimeUnavailableError
			&& error.code === 'DESKTOP_CODEC_RUNTIME_UNAVAILABLE',
	);
	await assert.rejects(() => runtime.decode(new Blob()), /desktop codec providers are unavailable/iu);
	assert.equal(runtime.dispose(), undefined);
});

test('desktop codec composition routes audio through file service while video stays closed', async () => {
	const requests: DesktopAudioCodecRequest[] = [];
	const cancelled: string[] = [];
	const runtime = createDesktopRuntime({
		fileService: {
			getDesktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
				return {
					schemaVersion: 1,
					capabilities: query.operations.map((operation) => ({
						...operation, available: true, provider: 'external-ffmpeg', reason: null,
					})),
				};
			},
			runDesktopAudioCodecOperation(request: DesktopAudioCodecRequest) {
				requests.push(request);
				return createDesktopAudioCodecResult(
					request, interleavedF32([0.25, -0.5]),
					{ sampleRate: 44_100, channelCount: 1, frameCount: 2 },
				);
			},
			cancelDesktopAudioCodecOperation(requestId: string) { cancelled.push(requestId); return true; },
		},
	});
	assert.equal(await runtime.load(), runtime);
	const decoded = await runtime.decode(new File([Uint8Array.of(1, 2, 3)], 'voice.flac'), {
		sampleRate: 48_000, channelCount: 1, maximumOutputBytes: 64,
	});
	assert.deepEqual(decoded.channels.map((channel) => [...channel]), [[0.25, -0.5]]);
	assert.equal(decoded.sampleRate, 44_100);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.operation, 'audio-decode');
	assert.equal(requests[0]?.format, 'flac');
	assert.equal(requests[0]?.sampleRate, null);
	assert.equal(requests[0]?.channelCount, null);
	assert.deepEqual(cancelled, []);
	await assert.rejects(() => runtime.encodeVideo({}, null, {}, {}), /video/iu);
	await assert.rejects(() => runtime.runProxyMediaOperation({}), /video/iu);
	assert.equal(requests.length, 1, 'video operations must not reach the audio bridge');
	runtime.dispose();
});

function interleavedF32(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	for (const [index, sample] of samples.entries()) view.setFloat32(index * 4, sample, true);
	return bytes;
}
