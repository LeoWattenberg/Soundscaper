/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';

test('guided Reframe crop context input preserves the authored position', async ({ page }) => {
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installMilestone7LocalAssistanceFixture(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	const video = createDeterministicSilentVideoFixture('crop-context.webm');
	await editor.locator('[data-project-bin-input]').setInputFiles([video]);
	await editor.getByRole('button', { name: 'Add to timeline: crop-context', exact: true }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.focus();
	await clip.press('Enter');
	await openAssistanceTask(page, editor, 'Reframe');
	const dialog = page.locator('[data-local-assistance]');
	page.on('dialog', async nativeDialog => { await nativeDialog.accept(); });
	await dialog.getByRole('button', { name: 'Run locally', exact: true }).click();
	await expect(dialog.getByRole('status', { name: 'Processing status' })).toHaveText('Processing selected media locally');
	await completeMilestone7Run(page);
	await expect(dialog.getByRole('status', { name: 'Processing status' })).toContainText('Processing finished.');
	await dialog.getByRole('button', { name: 'Review result', exact: true }).click();
	const review = dialog.getByRole('region', { name: 'Guided workflow review', exact: true });
	const horizontal = review.getByRole('slider', { name: 'Horizontal position', exact: true });
	await horizontal.fill('0.2');
	await expect(horizontal).toHaveValue('0.2');
	const overlay = review.locator('.kw-local-assistance__crop-overlay');
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	await overlay.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
	const authored = await horizontal.inputValue();
	expect(Number(authored)).toBeGreaterThan(0.2);
	await overlay.click({ button: 'right', position: { x: box.width * 0.25, y: box.height * 0.5 } });
	await expect(horizontal).toHaveValue(authored);
});
