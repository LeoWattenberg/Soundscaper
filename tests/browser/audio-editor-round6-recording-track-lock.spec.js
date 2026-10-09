/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const multitrack of [false, true]) test(`a ${multitrack ? 'multitrack' : 'focused'} native recording respects track locking`, async ({ page }) => {
	await installOscillatorMicrophone(page);
	await page.addInitScript(() => {
		window.__recordingChunkCount = 0;
		window.__recordingChunkPeak = 0;
		const NativeAudioWorkletNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeAudioWorkletNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				this.port.addEventListener('message', ({ data }) => {
					if (data.type === 'audio-chunk') {
						window.__recordingChunkCount++;
						for (const channel of data.channels) for (const value of channel) window.__recordingChunkPeak = Math.max(window.__recordingChunkPeak, Math.abs(value));
					}
				});
				this.port.start();
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	const stop = editor.getByRole('button', { name: 'Stop', exact: true });
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => page.evaluate(() => window.__recordingChunkCount)).toBeGreaterThanOrEqual(2);
	await stop.click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect(await page.evaluate(() => window.__recordingChunkPeak)).toBeGreaterThan(0.05);
	const healthy = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(healthy.sources[0].frameCount).toBeGreaterThan(4096);
	if (multitrack) await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Lock track');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	expect((await persistedProject(page, projectId)).tracks[0].locked).toBe(true);
	await expect(record).toBeDisabled();
	const before = await persistedProject(page, projectId);
	const chunksBefore = await page.evaluate(() => window.__recordingChunkCount);
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Record to new track', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => page.evaluate(() => window.__recordingChunkCount)).toBeGreaterThanOrEqual(chunksBefore + 2);
	await stop.click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const after = await persistedProject(page, projectId);
	expect(after.tracks[0]).toEqual(before.tracks[0]);
	expect(after.clips.find(clip => clip.id === before.clips[0].id)).toEqual(before.clips[0]);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
