/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, disableNativeSavePicker,
	openExportDialog, readDownloadBytes, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

test.describe('ordinary sound-activated recording completion', () => {
	registerAudioEditorHooks();

	test('Stop saves the final audible microphone chunk before closing its activation gate', async ({ page }, testInfo) => {
		await installOscillatorMicrophone(page);
		await disableNativeSavePicker(page);
		await page.addInitScript(() => {
			window.__recordedMicrophone = { chunks: [], startFrame: null, sampleRate: null };
			const NativeAudioWorkletNode = AudioWorkletNode;
			window.AudioWorkletNode = class extends NativeAudioWorkletNode {
				constructor(context, name, options) {
					super(context, name, options);
					if (name !== 'kw-audio-recorder') return;
					window.__recordedMicrophone.sampleRate = context.sampleRate;
					window.__recordedMicrophone.currentTime = () => context.currentTime;
					this.port.addEventListener('message', ({ data }) => {
						if (data.type === 'started') window.__recordedMicrophone.startFrame = data.startFrame;
						if (data.type === 'audio-chunk') {
							window.__recordedMicrophone.chunks.push({ frameStart: data.frameStart, frames: data.frames,
								values: Array.from(new Float32Array(data.channels[0])) });
						}
					});
					this.port.start();
				}
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		const projectId = await editor.getAttribute('data-project-id');
		// A normally available negative offset leaves the microphone PCM untrimmed;
		// compare native captured samples directly with the saved source inventory.
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
		const offset = preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true });
		await offset.fill('-500');
		await offset.press('Tab');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button'))
			.toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => page.evaluate(() => window.__recordedMicrophone.chunks.length)).toBeGreaterThanOrEqual(3);
		await expect.poll(() => page.evaluate(() => {
			const capture = window.__recordedMicrophone;
			const last = capture.chunks.at(-1);
			return capture.currentTime() - (last.frameStart + last.frames) / capture.sampleRate;
		})).toBeGreaterThan(0.02);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const capture = await page.evaluate(() => {
			const { chunks, sampleRate } = window.__recordedMicrophone;
			const samples = chunks.flatMap(chunk => chunk.values);
			const firstSound = samples.findIndex(value => Math.abs(value) >= 0.01);
			return { sampleRate, firstSound, frames: samples.length, expectedFrames: samples.length - firstSound,
				chunkLengths: chunks.map(chunk => chunk.frames), tailPeak: Math.max(...chunks.at(-1).values.map(Math.abs)) };
		});
		await testInfo.attach('captured-microphone-frames.json', { body: JSON.stringify(capture), contentType: 'application/json' });
		expect(capture.firstSound).toBeGreaterThanOrEqual(0);
		expect(capture.tailPeak).toBeGreaterThan(0.01);
		expect(capture.chunkLengths.at(-1)).toBeLessThan(4096);
		const project = await persistedProject(page, projectId);
		const [clip] = project.clips;
		const source = project.sources.find(candidate => candidate.id === clip.sourceId);
		expect(source.sampleRate).toBe(capture.sampleRate);
		expect(source.frameCount).toBe(capture.expectedFrames);
		expect(clip.sourceDurationFrames).toBe(capture.expectedFrames);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible();
		const wav = Buffer.from(await readDownloadBytes(page, download));
		const dataOffset = wav.indexOf(Buffer.from('data'));
		const formatOffset = wav.indexOf(Buffer.from('fmt '));
		expect(dataOffset).toBeGreaterThan(0);
		expect(formatOffset).toBeGreaterThan(0);
		const blockAlign = wav.readUInt16LE(formatOffset + 20);
		const deliveredFrames = wav.readUInt32LE(dataOffset + 4) / blockAlign;
		expect(deliveredFrames).toBe(clip.timelineStartFrame + clip.durationFrames);
	});
});
