/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';

test('ordinary Guided review auditions retain Playback volume for original and enhanced audio', async ({ page }) => {
	await installMilestone7LocalAssistanceFixture(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const source = createWavFixture({ name: 'guided-audition-volume.wav', frequency: 330, duration: 2, channelCount: 1 });
	await importFiles(editor, [source]);
	const clip = clipByName(editor, source.name).first();
	await clip.focus();
	await page.keyboard.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	page.on('dialog', dialog => { void dialog.accept(); });
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	for (const gain of [1, 0]) {
		await volume.focus();
		await volume.press(gain === 1 ? 'End' : 'Home');
		await expect(volume).toHaveValue(String(gain));
		const assistance = await openAssistanceTask(page, editor, 'Enhance Dialogue');
		await assistance.getByRole('button', { name: 'Run locally', exact: true }).click();
		await expect(assistance.getByRole('status', { name: 'Processing status' })).toHaveText('Processing selected media locally');
		await completeMilestone7Run(page);
		await expect(assistance.getByRole('status', { name: 'Processing status' })).toContainText('Processing finished.');
		await assistance.getByRole('button', { name: 'Review result', exact: true }).click();
		const review = assistance.getByRole('region', { name: 'Guided workflow review', exact: true });
		await expect(review.locator('audio')).toHaveCount(2);
		for (const label of ['Original selection', 'Enhanced dialogue']) {
			const audio = review.locator('label', { hasText: label }).locator('audio');
			await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
			expect(await audio.evaluate(element => element.volume), label).toBe(gain);
			await audio.click({ position: { x: 16, y: 16 } });
			await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.05);
		}
		await assistance.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(assistance).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});
