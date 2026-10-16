/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test.use({ browserCoverage: false });

for (const locked of [false, true]) test(`sound-activation timestamps preserve recording with ${locked ? 'a locked' : 'an unlocked'} existing annotation track`, async ({ page }) => {
	await installOscillatorMicrophone(page);
	await page.addInitScript(() => {
		globalThis.__timestampCapturedFrames = 0;
		globalThis.__timestampCapturedPeak = 0;
		const NativeAudioWorkletNode = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeAudioWorkletNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				this.port.addEventListener('message', ({ data }) => {
					if (data.type !== 'audio-chunk') return;
					globalThis.__timestampCapturedFrames += data.frames;
					for (const channel of data.channels) for (const value of channel) {
						globalThis.__timestampCapturedPeak = Math.max(globalThis.__timestampCapturedPeak, Math.abs(value));
					}
				});
				this.port.start();
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const audio = editor.locator('[data-track-row]').first();
	await audio.locator('.track-control-panel__track-name-text').click();
	await page.keyboard.press('Control+b');
	const input = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await input.fill('Protected annotation');
	await input.press('Enter');
	const annotations = editor.locator('[data-label-track]').first();
	await expect(annotations.locator('[data-label-id]')).toHaveCount(1);
	const annotationTrackId = await annotations.getAttribute('data-track-id');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const options = page.getByRole('dialog', { name: 'Record options', exact: true });
	await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
	await settings.getByRole('checkbox', { name: 'Add timestamps', exact: true }).click();
	await expect(settings.locator('[data-sound-activation-settings]')).toHaveAttribute('data-sound-activation-add-timestamps', 'true');
	await page.keyboard.press('Escape');
	if (await options.isVisible()) await page.keyboard.press('Escape');
	if (locked) await chooseTrackMenuAction(page, editor, annotations, 'Lock track');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await audio.locator('.track-control-panel__track-name-text').click();
	await expect(audio.locator('[data-track-header]')).toHaveAttribute('data-selected', 'true');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await options.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => page.evaluate(() => globalThis.__timestampCapturedFrames)).toBeGreaterThan(8_192);
	expect(await page.evaluate(() => globalThis.__timestampCapturedPeak)).toBeGreaterThan(0.05);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const saved = await persistedProject(page, projectId);
	expect(saved.sources[0].frameCount).toBeGreaterThan(4_096);
	const original = saved.tracks.find(track => track.id === annotationTrackId);
	expect(original.labels.filter(label => label.title === 'Protected annotation')).toHaveLength(1);
	expect(original.locked ?? false).toBe(locked);
	expect(original.labels).toHaveLength(locked ? 1 : 2);
	const destination = saved.tracks.find(track => track.type === 'label' && track.labels.some(label => /^\d{4}-\d{2}-\d{2}T/u.test(label.title)));
	expect(destination).toBeDefined();
	expect(destination.locked ?? false).toBe(false);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
});
