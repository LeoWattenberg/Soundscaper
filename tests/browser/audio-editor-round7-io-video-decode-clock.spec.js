/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { AudioSample, AudioSampleSource, BlobSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, MovOutputFormat, Output } from 'mediabunny';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });
async function ordinaryPcmVideo(frequency) {
	const input = new Input({ source: new BlobSource(new Blob([videoRetimePreviewMedia.file.buffer])), formats: [MP4] });
	try {
		const track = await input.getPrimaryVideoTrack(); assert.ok(track);
		const codec = await track.getCodec(); const decoderConfig = await track.getDecoderConfig(); assert.ok(codec); assert.ok(decoderConfig);
		const duration = await track.computeDuration();
		const target = new BufferTarget(); const output = new Output({ target, format: new MovOutputFormat({ fastStart: 'in-memory' }) });
		const video = new EncodedVideoPacketSource(codec); const audio = new AudioSampleSource({ codec: 'pcm-s16' });
		output.addVideoTrack(video); output.addAudioTrack(audio); await output.start();
		for await (const packet of new EncodedPacketSink(track).packets()) await video.add(packet, { decoderConfig });
		const data = Float32Array.from({ length: Math.ceil(duration * 48_000) }, (_, frame) => .2 * Math.sin(2 * Math.PI * frequency * frame / 48_000));
		const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 1, sampleRate: 48_000, timestamp: 0 });
		try { await audio.add(sample); } finally { sample.close(); }
		await output.finalize(); assert.ok(target.buffer);
		return Buffer.from(target.buffer);
	} finally { input.dispose(); }
}
function amplitude(data, rate, frequency) {
	const first = Math.round(rate * .05), last = Math.min(data.length, Math.round(rate * .2));
	let sine = 0; let cosine = 0;
	for (let frame = first; frame < last; frame++) { const phase = 2 * Math.PI * frequency * frame / rate;
		sine += data[frame] * Math.sin(phase); cosine += data[frame] * Math.cos(phase); }
	return 2 * Math.hypot(sine, cosine) / (last - first);
}
for (const frequency of [3_000, 23_000]) test(`ordinary 48kHz PCM camera import preserves its ${frequency}Hz recording band`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = await ordinaryPcmVideo(frequency);
	const decode = async bytes => page.evaluate(async data => {
		const context = new OfflineAudioContext(1, 1, 48_000);
		const decoded = await context.decodeAudioData(new Uint8Array(data).buffer);
		return { rate: decoded.sampleRate, samples: Array.from(decoded.getChannelData(0)) };
	}, Array.from(bytes));
	const input = await decode(bytes); expect(input.rate).toBe(48_000);
	expect(amplitude(input.samples, input.rate, frequency)).toBeGreaterThan(.19);
	await importFiles(editor, [{ name: 'camera-take.mov', mimeType: 'video/quicktime', buffer: bytes }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const dialog = await openExportDialog(page, editor); await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
	const downloading = page.waitForEvent('download'); await link.click(); const download = await downloading;
	const delivered = await downloadBytes(download); await download.delete();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const result = await decode(delivered); expect(result.rate).toBe(48_000);
	expect(amplitude(result.samples, result.rate, frequency)).toBeGreaterThan(.13);
});
