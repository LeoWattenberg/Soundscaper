/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import test from 'node:test';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import type { BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { validateStreamedAudioOutput } from '../src/common/editor/browser-streamed-audio-output-validation.ts';

const STOCK_FFMPEG = 'mwader/static-ffmpeg:9.0@sha256:b90574a4e2ae62b763c39c384526689e7eb435da6398f4fb3f6c3f1c6a14ce33';

// The reference deliberately generates 1.38 GB of PCM a packet at a time.
// Opt in because the stock decoder witness needs the pinned FFmpeg Docker image.
for (const format of ['mp3', 'flac'] as const) {
	test(`one hour of stereo 48 kHz ${format} is one independently readable continuous file`, {
		skip: process.env.SCAPE_LONG_AUDIO_ENCODE_REFERENCE !== '1', timeout: 300_000,
	}, async (context) => {
		const directory = await mkdtemp(join(tmpdir(), 'soundscaper-hour-encode-'));
		const path = join(directory, `hour.${format}`);
		const file = await open(path, 'wx');
		const frames = 48_000 * 3600;
		let session: Awaited<ReturnType<typeof openDedicatedAudioEncodeSession>>;
		try { session = await openDedicatedAudioEncodeSession({
			format, frameCount: frames, sampleRate: 48_000, channelCount: 2,
			settings: format === 'mp3' ? { bitrateKbps: 192 } : { compressionLevel: 5 },
		}, { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) });
		} catch (error) { await file.close(); await rm(directory, { recursive: true, force: true }); throw error; }
		let pcmPeak = 0;
		let encodedPeak = 0;
		let encodedTotal = 0;
		try {
			const pcm = new Uint8Array(16_384 * 8);
			for (let offset = 0; offset < frames;) {
				const count = Math.min(16_384, frames - offset);
				const packet = pcm.subarray(0, count * 8);
				const encoded = session.write(packet, count);
				pcmPeak = Math.max(pcmPeak, packet.byteLength);
				encodedPeak = Math.max(encodedPeak, encoded.byteLength);
				if (encoded.length) await file.write(encoded);
				encodedTotal += encoded.length;
				offset += count;
			}
			const final = session.finish();
			await file.write(final.bytes);
			encodedTotal += final.bytes.byteLength;
			if (final.prefixPatch.length) await file.write(final.prefixPatch, 0, final.prefixPatch.length, 0);
			await file.close();
			assert.ok(pcmPeak <= 16_384 * 8);
			assert.ok(encodedPeak <= 1024 ** 2);
			assert.ok(encodedTotal > 0 && encodedTotal <= 1_000_000_000);
			await validateStreamedAudioOutput(await openAsBlob(path), { format, frameCount: frames, channelCount: 2, sampleRate: 48_000 });
			context.diagnostic(`frames=${frames}, retainedPCMBytes=${pcmPeak}, retainedEncodedBytes=${encodedPeak}, fileBytes=${encodedTotal}`);
			const probe = spawnSync('docker', [
				'run', '--rm', '-v', `${directory}:/w:ro`, '--entrypoint', '/ffprobe', STOCK_FFMPEG,
				'-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,duration',
				'-of', 'json', `/w/hour.${format}`,
			], { encoding: 'utf8', timeout: 120_000 });
			assert.equal(probe.status, 0, probe.stderr);
			const metadata = JSON.parse(probe.stdout) as { streams: Array<{ codec_name: string; sample_rate: string; channels: number; duration: string }> };
			assert.equal(metadata.streams.length, 1);
			const audio = metadata.streams[0]!;
			assert.equal(audio.codec_name, format);
			assert.equal(Number(audio.sample_rate), 48_000);
			assert.equal(audio.channels, 2);
			assert.ok(Math.abs(Number(audio.duration) - 3600) < 0.1);
			const decoded = spawnSync('docker', [
				'run', '--rm', '-v', `${directory}:/w:ro`, STOCK_FFMPEG,
				'-v', 'error', '-i', `/w/hour.${format}`, '-f', 'null', '-',
			], { encoding: 'utf8', timeout: 120_000 });
			assert.equal(decoded.status, 0, decoded.stderr);
			assert.equal(decoded.stderr, '');
		} finally { session.close(); await file.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
	});
}
