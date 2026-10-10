/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

test.describe('ordinary microphone pause completion', () => {
	registerAudioEditorHooks();
	for (const activated of [false, true]) test(`${activated ? 'sound-activated' : 'ordinary'} Pause preserves captured partial microphone PCM`, async ({ page }) => {
		await installOscillatorMicrophone(page);
		await page.addInitScript(() => {
			const capture = { chunks: [], sampleRate: null, paused: false, currentTime: null };
			globalThis.__ordinaryPauseCapture = capture;
			const NativeAudioWorkletNode = AudioWorkletNode;
			globalThis.AudioWorkletNode = class extends NativeAudioWorkletNode {
				constructor(context, name, options) {
					super(context, name, options);
					if (name !== 'kw-audio-recorder') return;
					capture.sampleRate = context.sampleRate;
					capture.currentTime = () => context.currentTime;
					this.port.addEventListener('message', ({ data }) => {
						if (data.type === 'paused') capture.paused = true;
						if (data.type === 'audio-chunk') capture.chunks.push({ frameStart: data.frameStart,
							frames: data.frames, values: Array.from(new Float32Array(data.channels[0])) });
					});
					this.port.start();
				}
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		const projectId = await editor.getAttribute('data-project-id');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
		const offset = preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true });
		await offset.fill('-500');
		await offset.press('Tab');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		if (activated) {
			await editor.getByRole('button', { name: 'Record options', exact: true }).click();
			await page.getByRole('dialog', { name: 'Record options', exact: true })
				.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
		} else await record.click();
		await expect(record).toHaveAttribute('aria-label', 'Pause recording');
		await expect.poll(() => page.evaluate(() => globalThis.__ordinaryPauseCapture.chunks.length)).toBeGreaterThanOrEqual(3);
		await expect.poll(() => page.evaluate(() => {
			const capture = globalThis.__ordinaryPauseCapture;
			const last = capture.chunks.at(-1);
			return capture.currentTime() - (last.frameStart + last.frames) / capture.sampleRate;
		})).toBeGreaterThan(.02);
		await record.click();
		await expect(record).toHaveAttribute('aria-label', 'Resume recording');
		await expect.poll(() => page.evaluate(() => globalThis.__ordinaryPauseCapture.paused)).toBe(true);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const capture = await page.evaluate(() => {
			const { chunks, sampleRate } = globalThis.__ordinaryPauseCapture;
			const samples = chunks.flatMap(chunk => chunk.values);
			return { sampleRate, frames: samples.length, firstSound: samples.findIndex(value => Math.abs(value) >= .01),
				lastFrames: chunks.at(-1).frames, tailPeak: Math.max(...chunks.at(-1).values.map(Math.abs)) };
		});
		expect(capture.firstSound).toBeGreaterThanOrEqual(0);
		expect(capture.tailPeak).toBeGreaterThan(.01);
		expect(capture.lastFrames).toBeGreaterThan(0);
		expect(capture.lastFrames).toBeLessThan(4096);
		const project = await persistedProject(page, projectId);
		const clip = project.clips[0];
		const source = project.sources.find(candidate => candidate.id === clip.sourceId);
		expect(source.sampleRate).toBe(capture.sampleRate);
		expect(source.frameCount).toBe(activated ? capture.frames - capture.firstSound : capture.frames);
		expect(clip.sourceDurationFrames).toBe(source.frameCount);
	});
});
