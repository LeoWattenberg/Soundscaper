/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const frozen of [false, true]) test(`EDL discloses ordinary ${frozen ? 'frozen' : 'continuous'} video source timing`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('Camera.webm'));
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clip).toHaveCount(1);
	if (frozen) {
		await clip.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video retime']);
		const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
		await dialog.getByRole('textbox', { name: 'Source frame', exact: true }).fill('2');
		await dialog.getByRole('button', { name: 'Apply freeze', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Video retime updated.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export edit list (EDL)']);
	const download = await downloading;
	let text;
	try {
		const path = await download.path();
		expect(path).not.toBeNull();
		text = await readFile(path, 'utf8');
	} finally { await download.delete(); }
	const events = text.split('\n').filter(line => /^\d{3}\s/u.test(line));
	expect(events).toHaveLength(1);
	expect(events[0].trim().split(/\s+/u)[4]).toBe('00:00:00:00');
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toBeVisible();
	if (frozen) await expect(report.locator('[data-severity="warning"]')).toContainText(/motion|time.effect|retime|unity/iu);
	else await expect(report).not.toContainText(/motion|time.effect|retime|unity/iu);
});
