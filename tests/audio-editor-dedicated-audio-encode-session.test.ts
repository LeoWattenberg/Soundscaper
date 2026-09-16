/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import type { BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';

const profiles: ReadonlyArray<readonly [BrowserDedicatedAudioFormat, Readonly<Record<string, number>>]> = [
	['mp3', { bitrateKbps: 192 }], ['mp2', { bitrateKbps: 192 }],
	['flac', { compressionLevel: 5 }], ['opus', { bitrateKbps: 160, vbrMode: 1 }],
	['ogg-vorbis', { quality: 5 }], ['wavpack', { compressionLevel: 2 }],
];
const loadPayload = async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url));

for (const [format, settings] of profiles) {
	test(`incremental ${format} retains one continuous encoder across arbitrary PCM boundaries`, async () => {
		const session = await openDedicatedAudioEncodeSession({
			format, settings, frameCount: 50_123, channelCount: 2, sampleRate: 48_000,
		}, { loadPayload });
		const chunks: Uint8Array[] = [];
		try {
			for (let offset = 0; offset < 50_123;) {
				const frames = Math.min(offset % 2 ? 777 : 16_384, 50_123 - offset);
				const pcm = new Float32Array(frames * 2);
				for (let frame = 0; frame < frames; frame++) {
					pcm[frame * 2] = Math.sin((offset + frame) * 0.05) * 0.25;
					pcm[frame * 2 + 1] = Math.cos((offset + frame) * 0.03) * 0.25;
				}
				const bytes = session.write(new Uint8Array(pcm.buffer), frames);
				assert.ok(bytes.byteLength <= 1024 ** 2);
				chunks.push(bytes);
				offset += frames;
			}
			const final = session.finish();
			chunks.push(final.bytes);
			const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
			let offset = 0;
			for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
			output.set(final.prefixPatch);
			assert.ok(output.byteLength > 0);
			assert.throws(() => session.write(new Uint8Array(8), 1), /finished|closed/u);
			if (format === 'opus' || format === 'ogg-vorbis') {
				assert.equal(new TextDecoder().decode(output.subarray(0, 4)), 'OggS');
				// One logical stream's sequence must never restart at a PCM boundary.
				let page = 0;
				let sequence = 0;
				while (page < output.length) {
					const view = new DataView(output.buffer, page);
					assert.equal(view.getUint32(18, true), sequence++);
					const count = output[page + 26]!;
					let body = 0;
					for (let segment = 0; segment < count; segment++) body += output[page + 27 + segment]!;
					page += 27 + count + body;
				}
				assert.equal(page, output.length);
			}
		} finally { session.close(); }
	});
}

test('incremental encoding refuses geometry drift and missing samples before finish', async () => {
	const session = await openDedicatedAudioEncodeSession({
		format: 'mp3', settings: { bitrateKbps: 192 }, frameCount: 10, channelCount: 2, sampleRate: 48_000,
	}, { loadPayload });
	try {
		assert.throws(() => session.write(new Uint8Array(8), 2), /geometry/u);
		assert.throws(() => session.finish(), /frame count/u);
	} finally { session.close(); }
});
