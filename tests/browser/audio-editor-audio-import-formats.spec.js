/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, readFile } from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import {
	bootEditor, collectClientErrors, importFiles, registerAudioEditorHooks,
	sourcePeakChannels, waitForEditor, clipByName,
} from './audio-editor-test-helpers.js';

const FORMATS = [
	['MP3', 'mp3', 'libmp3lame', 'audio/mpeg'],
	['MP2', 'mp2', 'mp2', 'audio/mpeg'],
	['FLAC', 'flac', 'flac', 'audio/flac'],
	['Ogg Vorbis', 'ogg', 'libvorbis', 'audio/ogg'],
	['Opus', 'opus', 'libopus', 'audio/ogg'],
	['WavPack', 'wv', 'wavpack', 'audio/wavpack'],
	['AIFF', 'aiff', 'pcm_s16be', 'audio/aiff'],
	['AAC', 'aac', 'aac', 'audio/aac'],
	['M4A', 'm4a', 'aac', 'audio/mp4'],
];

async function encodedFixture(extension, codec, mimeType) {
	if (extension === 'opus' || extension === 'wv') {
		// WavPack's admitted profile is lossless float32. Use the maintained
		// encoder for that profile and for Opus (the test FFmpeg encoder traps).
		const format = extension === 'wv' ? 'wavpack' : 'opus';
		const pcm = new Float32Array(48000 * 2);
		for (let frame = 0; frame < 48000; frame++) {
			pcm[frame * 2] = Math.sin(2 * Math.PI * 330 * frame / 48000) * 0.3;
			pcm[frame * 2 + 1] = Math.sin(2 * Math.PI * 330 * frame / 48000 + Math.PI / 3) * 0.1;
		}
		const bytes = await encodeDedicatedAudioPcm({ format, input: new Uint8Array(pcm.buffer),
			frameCount: 48000, channelCount: 2, sampleRate: 48000,
			settings: format === 'opus' ? { bitrateKbps: 128, vbrMode: 1 } : { compressionLevel: 2 },
			maximumOutputBytes: 1024 * 1024,
		}, { loadPayload: async () => readFile(new URL(`../../src/common/editor/${format}/${format}.wasm`, import.meta.url)) });
		return { name: `import-tone.${extension}`, mimeType, buffer: Buffer.from(bytes) };
	}
	// Produce actual media with the pinned test dependency, independently of
	// the application's decoder. No external download or system FFmpeg needed.
	const core = await (async () => {
		const url = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
		globalThis.self ??= globalThis;
		globalThis.location ??= url;
		const [{ default: createCore }, wasmBinary] = await Promise.all([
			import(url.href), readFile(new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)),
		]);
		return createCore({ wasmBinary });
	})();
	const input = createWavFixture({ name: 'input.wav', frequency: 330,
		duration: 1, channelCount: 2, channelAmplitudes: [0.3, 0.1] });
	const name = `import-tone.${extension}`;
	const logs = [];
	core.setLogger(({ message }) => { logs.push(message); });
	try {
		core.FS.writeFile(input.name, input.buffer);
		const result = core.exec('-hide_banner', '-nostdin', '-y', '-i', input.name, '-c:a', codec, name);
		expect(result, logs.join('\n')).toBe(0);
		return { name, mimeType, buffer: Buffer.from(core.FS.readFile(name)) };
	} finally {
		core.reset();
		for (const path of [input.name, name]) { try { core.FS.unlink(path); } catch {} }
	}
}

test.describe('audio file import formats', () => {
	registerAudioEditorHooks();
	for (const [label, extension, codec, mimeType] of FORMATS) {
		test(`${label} imports stereo audio, plays, and survives reload`, async ({ page }) => {
			test.setTimeout(60000);
			const file = await encodedFixture(extension, codec, mimeType);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [file]);
			await expect(clipByName(editor, file.name)).toBeVisible();
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			const peaks = await sourcePeakChannels(page, file.name);
			expect(peaks.channelCount).toBe(2);
			expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
			expect(peaks.channels[0].minimum).toBeLessThan(-0.2);
			expect(peaks.channels[1].maximum).toBeGreaterThan(0.05);
			expect(peaks.channels[1].maximum).toBeLessThan(0.2);
			await editor.getByRole('button', { name: 'Play', exact: true }).click();
			await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await page.reload();
			const restored = await waitForEditor(page);
			await expect(clipByName(restored, file.name)).toBeVisible();
			expect(await sourcePeakChannels(page, file.name)).toEqual(peaks);
			expect(errors).toEqual([]);
		});
	}
});
