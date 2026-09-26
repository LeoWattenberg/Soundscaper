/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, readFile } from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import {
	bootEditor, chooseFileAction, collectClientErrors, registerAudioEditorHooks,
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
	['Ogg Vorbis (.oga alias)', 'oga', 'libvorbis', ''],
	['WavPack (.wavpack alias)', 'wavpack', 'wavpack', ''],
	['AIFF (.aif alias)', 'aif', 'pcm_s16be', ''],
];

async function encodedFixture(extension, codec, mimeType) {
	if (extension === 'opus' || extension === 'wv' || extension === 'wavpack') {
		// WavPack's admitted profile is lossless float32. Use the maintained
		// encoder for that profile and for Opus (the test FFmpeg encoder traps).
		const format = extension === 'wv' || extension === 'wavpack' ? 'wavpack' : 'opus';
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

async function importThroughFileMenu(page, editor, file) {
	const choosingFile = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosingFile).setFiles(file);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
}

function extendedWavFixture(signature) {
	const sampleRate = 48_000;
	const channelCount = 2;
	const frameCount = 4_800;
	const bytesPerSample = 2;
	const pcm = new Uint8Array(frameCount * channelCount * bytesPerSample);
	const pcmView = new DataView(pcm.buffer);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const amplitude = channel === 0 ? 0.3 : 0.1;
			const phase = channel === 0 ? 0 : Math.PI / 3;
			const sample = Math.sin(2 * Math.PI * 330 * frame / sampleRate + phase) * amplitude;
			pcmView.setInt16((frame * channelCount + channel) * bytesPerSample, Math.round(sample * 32767), true);
		}
	}
	const format = new Uint8Array(16);
	const formatView = new DataView(format.buffer);
	formatView.setUint16(0, 1, true);
	formatView.setUint16(2, channelCount, true);
	formatView.setUint32(4, sampleRate, true);
	formatView.setUint32(8, sampleRate * channelCount * bytesPerSample, true);
	formatView.setUint16(12, channelCount * bytesPerSample, true);
	formatView.setUint16(14, bytesPerSample * 8, true);
	const ds64 = new Uint8Array(28);
	const ds64View = new DataView(ds64.buffer);
	ds64View.setBigUint64(8, BigInt(pcm.byteLength), true);
	ds64View.setBigUint64(16, signature === 'RF64' ? BigInt(frameCount) : 0n, true);
	const chunks = [riffChunk('ds64', ds64), riffChunk('fmt ', format), riffChunk('data', pcm, 0xffff_ffff)];
	const bytes = new Uint8Array(12 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	writeAscii(bytes, 0, signature);
	const view = new DataView(bytes.buffer);
	view.setUint32(4, 0xffff_ffff, true);
	writeAscii(bytes, 8, 'WAVE');
	let offset = 12;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	view.setBigUint64(20, BigInt(bytes.byteLength - 8), true);
	return {
		name: signature === 'RF64' ? 'field-recording.rf64' : 'spatial-master.bw64',
		mimeType: '',
		buffer: Buffer.from(bytes),
	};
}

function riffChunk(id, payload, declaredSize = payload.byteLength) {
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(chunk, 0, id);
	new DataView(chunk.buffer).setUint32(4, declaredSize, true);
	chunk.set(payload, 8);
	return chunk;
}

function writeAscii(bytes, offset, text) {
	for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
}

test.describe('audio file import formats', () => {
	registerAudioEditorHooks();
	test('File > Import and Project Bin advertise maintained audio suffixes and import .wave aliases', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-workspace-panel="project-bin"]')).toBeVisible();
		const requiredExtensions = [
			'.aac', '.aif', '.aiff', '.bw64', '.flac', '.m4a', '.mp2', '.mp3',
			'.oga', '.ogg', '.opus', '.rf64', '.wav', '.wave', '.wavpack', '.wv',
		];
		const projectBinChoosingFile = page.waitForEvent('filechooser');
		await editor.getByText('Add audio to Project bin', { exact: true }).click();
		const projectBinChooser = await projectBinChoosingFile;
		const projectBinAccepted = new Set((await projectBinChooser.element().getAttribute('accept')).split(','));
		for (const extension of requiredExtensions) {
			expect(projectBinAccepted, `Project Bin must advertise ${extension}`).toContain(extension);
		}
		const wav = createWavFixture({ name: 'source.wav', frequency: 330, channelAmplitudes: [0.3, 0.1] });
		await projectBinChooser.setFiles({ ...wav, name: 'project-bin-field-recording.wave', mimeType: '' });
		await expect(editor.locator('[data-project-bin-name]')).toHaveValue('project-bin-field-recording');
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		const chooser = await choosingFile;
		const accepted = new Set((await chooser.element().getAttribute('accept')).split(','));
		for (const extension of requiredExtensions) {
			expect(accepted, `File > Import must advertise ${extension}`).toContain(extension);
		}
		await chooser.setFiles({ ...wav, name: 'field-recording.wave', mimeType: '' });
		await expect(clipByName(editor, 'field-recording.wave')).toBeVisible();
		const peaks = await sourcePeakChannels(page, 'field-recording.wave');
		expect(peaks.channelCount).toBe(2);
		expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
		expect(peaks.channels[1].maximum).toBeGreaterThan(0.05);
	});

	test('File > Import bypasses a visible Project bin and creates one track per file', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-workspace-panel="project-bin"]')).toBeVisible();
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		const first = createWavFixture({ name: 'first-track.wav', frequency: 220 });
		const second = createWavFixture({ name: 'second-track.wav', frequency: 440 });
		await (await choosingFile).setFiles([first, second]);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
		const firstClip = clipByName(editor, first.name);
		const secondClip = clipByName(editor, second.name);
		await expect(firstClip).toBeVisible();
		await expect(secondClip).toBeVisible();
		expect(await firstClip.getAttribute('data-track-index'))
			.not.toBe(await secondClip.getAttribute('data-track-index'));
	});

	for (const signature of ['RF64', 'BW64']) {
		test(`${signature} imports through File > Import and survives reload`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const file = extendedWavFixture(signature);
			const editor = await bootEditor(page, '/embed/en/');
			await importThroughFileMenu(page, editor, file);
			await expect(clipByName(editor, file.name)).toBeVisible();
			const peaks = await sourcePeakChannels(page, file.name);
			expect(peaks.channelCount).toBe(2);
			expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
			expect(peaks.channels[1].maximum).toBeGreaterThan(0.05);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await page.reload();
			await expect(clipByName(await waitForEditor(page), file.name)).toBeVisible();
			expect(await sourcePeakChannels(page, file.name)).toEqual(peaks);
			expect(errors).toEqual([]);
		});
	}

	test('a failed dedicated FLAC decode leaves the project untouched and the next import succeeds', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const initialProjectId = await editor.getAttribute('data-project-id');
		const choosingBadFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		await (await choosingBadFile).setFiles({
			name: 'broken-import.flac',
			mimeType: 'audio/flac',
			buffer: Buffer.from('fLaCbroken-payload'),
		});
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]'))
			.toContainText('1 failed', { timeout: 20_000 });
		await expect(editor).toHaveAttribute('data-project-id', initialProjectId);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(editor.locator('[data-project-bin-item]')).toHaveCount(0);

		const valid = await encodedFixture('flac', 'flac', 'audio/flac');
		await importThroughFileMenu(page, editor, valid);
		await expect(clipByName(editor, valid.name)).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	});

	for (const [label, extension, codec, mimeType] of FORMATS) {
		test(`${label} imports stereo audio, plays, and survives reload`, async ({ page }) => {
			test.setTimeout(60000);
			const file = await encodedFixture(extension, codec, mimeType);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importThroughFileMenu(page, editor, file);
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
