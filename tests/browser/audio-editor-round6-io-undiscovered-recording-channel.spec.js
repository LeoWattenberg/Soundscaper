/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

for (const primed of [false, true]) {
	test(`a ${primed ? 'previously recorded' : 'fresh'} mono microphone records through Record to new track`, async ({ page }) => {
		await installOscillatorMicrophone(page);
		await page.addInitScript(() => {
			window.__recordingChunkCount = 0;
			const NativeAudioWorkletNode = AudioWorkletNode;
			window.AudioWorkletNode = class extends NativeAudioWorkletNode {
				constructor(context, name, options) {
					super(context, name, options);
					if (name !== 'kw-audio-recorder') return;
					this.port.addEventListener('message', ({ data }) => {
						if (data.type === 'audio-chunk') window.__recordingChunkCount++;
					});
					this.port.start();
				}
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		const projectId = await editor.getAttribute('data-project-id');
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		const stop = editor.getByRole('button', { name: 'Stop', exact: true });
		if (primed) {
			await record.click();
			await expect(record).toHaveAttribute('aria-pressed', 'true');
			await expect.poll(() => page.evaluate(() => window.__recordingChunkCount)).toBeGreaterThanOrEqual(2);
			await stop.click();
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		}
		const chunksBefore = await page.evaluate(() => window.__recordingChunkCount);
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Record to new track', exact: true }).click();
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => page.evaluate(() => window.__recordingChunkCount)).toBeGreaterThanOrEqual(chunksBefore + 2);
		await stop.click();
		await expect(editor).toHaveAttribute('data-clip-count', String(primed ? 2 : 1));
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await persistedProject(page, projectId);
		const newTrack = saved.tracks.at(-1);
		expect(newTrack.clipIds).toHaveLength(1);
		const clip = saved.clips.find(candidate => candidate.id === newTrack.clipIds[0]);
		const source = saved.sources.find(candidate => candidate.id === clip.sourceId);
		expect(source.channelCount).toBe(1);
		expect(source.frameCount).toBeGreaterThan(4096);
		expect(clip.sourceDurationFrames).toBeGreaterThan(4096);
		await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	});
}
