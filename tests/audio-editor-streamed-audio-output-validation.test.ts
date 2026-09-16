/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { validateStreamedAudioOutput } from '../src/common/editor/browser-streamed-audio-output-validation.ts';

for (const format of ['mp3', 'mp2', 'flac', 'opus', 'ogg-vorbis', 'wavpack'] as const) {
	test(`streamed ${format} publication checks exact codec geometry using bounded file reads`, async () => {
		const frameCount = 50_123;
		const settings: Readonly<Record<string, number>> = format === 'mp3' || format === 'mp2' ? { bitrateKbps: 192 } : format === 'opus' ? { bitrateKbps: 128, vbrMode: 0 } : format === 'ogg-vorbis' ? { quality: 5 } : { compressionLevel: format === 'wavpack' ? 2 : 5 };
		const request = { format, frameCount, channelCount: 2, sampleRate: 48_000, settings };
		const session = await openDedicatedAudioEncodeSession(request, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
		const parts: Uint8Array<ArrayBuffer>[] = [];
		try {
			for (let offset = 0; offset < frameCount;) {
				const count = Math.min(16_384, frameCount - offset);
				parts.push(session.write(new Uint8Array(count * 8), count)); offset += count;
			}
			const final = session.finish(); parts.push(final.bytes);
			const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
			bytes.set(final.prefixPatch);
			let largestRead = 0;
			const blob = new Blob([bytes]);
			const originalSlice = blob.slice.bind(blob);
			blob.arrayBuffer = () => { throw new Error('Whole-file read is forbidden.'); };
			blob.slice = (start, end, type) => { largestRead = Math.max(largestRead, (end ?? blob.size) - (start ?? 0)); return originalSlice(start, end, type); };
			await validateStreamedAudioOutput(blob, request);
			assert.ok(largestRead <= 1024 ** 2);
			await assert.rejects(validateStreamedAudioOutput(blob, { ...request, channelCount: 1 }), /geometry|channel/iu);
			await assert.rejects(validateStreamedAudioOutput(new Blob([bytes.subarray(0, bytes.length - 1)]), request));
		} finally { session.close(); }
	});
}
