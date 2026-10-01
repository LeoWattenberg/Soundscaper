/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopAudioCodecResult } from '../desktop/desktop-audio-codec-operation-contract.ts';
import { createDesktopAudioCodecRuntime, type DesktopAudioCodecRendererBridge } from '../src/common/editor/desktop-audio-codec-runtime.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('desktop FFmpeg imports larger than 32 MiB reach main without a fixed decoded-output cap', async () => {
	class RangeBlob extends Blob {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Read the selected file in ranges.'); }
		override slice(start?: number, end?: number, type?: string): Blob {
			assert.ok((end ?? this.size) - (start ?? 0) <= 4 * 1024 ** 2);
			return super.slice(start, end, type);
		}
	}
	let executions = 0;
	const runtime = createDesktopAudioCodecRuntime({
		execute(request) {
			executions += 1;
			assert.equal(request.input.byteLength, 32 * 1024 ** 2 + 1);
			assert.equal(request.maximumOutputBytes, Number.MAX_SAFE_INTEGER);
			return createDesktopAudioCodecResult(request, new Uint8Array(8), {
				sampleRate: 48_000, channelCount: 2, frameCount: 1,
			});
		},
		cancel() {},
	});
	const result = await runtime.decode(new RangeBlob([new Uint8Array(32 * 1024 ** 2 + 1)]), { format: 'aac-m4a' });
	assert.equal(executions, 1);
	assert.equal(result.sampleRate, 48_000);
});

test('large external-only exports use FFmpeg instead of the bundled-only streaming bridge', async () => {
	let executions = 0;
	const bridge: DesktopAudioCodecRendererBridge = {
		capabilities(query) { return { schemaVersion: 2,
			capabilities: query.operations.map((tuple) => ({ ...tuple,
				available: true, provider: 'external-ffmpeg', reason: null })),
		}; },
		stream() { throw new Error('An external FFmpeg export cannot use the bundled stream bridge.'); },
		execute(request) {
			executions += 1;
			assert.equal(request.input.byteLength, 32 * 1024 ** 2 + 4);
			assert.equal(request.maximumOutputBytes, Number.MAX_SAFE_INTEGER);
			return createDesktopAudioCodecResult(request, Uint8Array.of(1, 2, 3));
		},
		cancel() {},
	};
	const runtime = createDesktopAudioCodecRuntime(bridge);
	const wav = encodeWav([new Float32Array(8 * 1024 ** 2 + 1)], {
		sampleRate: 48_000, bitDepth: 32, float: true,
	});
	const result = await runtime.encodeFile(new Blob([new Uint8Array(wav)]), 'aac-m4a', { bitRate: 192 });
	assert.equal(executions, 1);
	assert.deepEqual(result.bytes, Uint8Array.of(1, 2, 3));
});
