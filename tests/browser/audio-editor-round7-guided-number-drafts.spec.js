/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';
import { openAssistanceTask } from './helpers/assistance-task-menu.js';

test('Reframe Target width retains normal typing drafts until the aspect ratio is committed', async ({ page }) => {
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installMilestone7LocalAssistanceFixture(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	const video = createDeterministicSilentVideoFixture('reframe-number-draft.webm');
	await editor.locator('[data-project-bin-input]').setInputFiles([video]);
	await editor.getByRole('button', { name: 'Add to timeline: reframe-number-draft', exact: true }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.focus();
	await page.keyboard.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	const guided = await openAssistanceTask(page, editor, 'Reframe');
	const width = guided.getByRole('spinbutton', { name: 'Target aspect width', exact: true });
	await expect(width).toHaveValue('9');
	await width.fill('');
	await expect(width).toHaveValue('');
	await width.pressSequentially('1');
	await expect(width).toHaveValue('1');
	await width.pressSequentially('6');
	await expect(width).toHaveValue('16');
	await width.press('Tab');
	await expect(width).toHaveValue('16');
	await expect(guided.getByRole('spinbutton', { name: 'Target aspect height', exact: true })).toHaveValue('16');
	await width.fill('65');
	await width.press('Tab');
	await expect(width).toHaveValue('16');
});

test('Text to Speech Speed accepts normal fractional typing and restores an invalid completed value', async ({ page }) => {
	await installMilestone7LocalAssistanceFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	const speech = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
	const speed = speech.getByRole('spinbutton', { name: 'Speed', exact: true });
	await expect(speed).toBeEnabled();
	await speed.fill('');
	await expect(speed).toHaveValue('');
	await speed.pressSequentially('0.75');
	await expect(speed).toHaveValue('0.75');
	await speed.press('Tab');
	await expect(speed).toHaveValue('0.75');
	await speed.fill('3');
	await speed.press('Tab');
	await expect(speed).toHaveValue('0.75');
});
