/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectVideoKeyframeVideoOutput, streamVideoKeyframeVideoOutput } from '../src/common/editor/video-keyframe-video-output.ts';

const MP4 = Uint8Array.of(0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0, 0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0);

test('exact video output warning is overrideable before collecting or publishing bytes', async () => {
	for (const streamed of [false, true]) for (const accept of [true, false]) {
		let reads = 0;
		let warnings = 0;
		let opened = false;
		const request = {
			source: {
				async statFile() { return { size: MP4.byteLength }; },
				async readFileRange(_path: string, offset: number, count: number) { reads++; return MP4.slice(offset, offset + count); },
			},
			path: 'video.mp4', format: 'mp4' as const, maximumBytes: 12,
			async confirmFileSizeWarning(warning: { byteLength: number; thresholdBytes: number }) {
				warnings++;
				assert.equal(reads, 0);
				assert.equal(opened, false);
				assert.equal(warning.byteLength, MP4.byteLength);
				assert.equal(warning.thresholdBytes, 12);
				return accept;
			},
		};
		const output = streamed ? streamVideoKeyframeVideoOutput(request, {
			async open() { opened = true; }, async write() {}, async close() { return 'saved'; }, async abort() {},
		}) : collectVideoKeyframeVideoOutput(request);
		if (accept) assert.equal((await output).byteLength, MP4.byteLength);
		else {
			await assert.rejects(output, { name: 'AbortError' });
			assert.equal(reads, 0);
		}
		assert.equal(warnings, 1);
	}
});
