/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const contract of [false, true]) test(`a selected Title retains its native range through ${contract ? 'Contract selection' : 'All tracks'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clip).toBeVisible();
	const action = () => chooseNestedCommandAction(page, editor, 'Select', contract
		? ['Region', 'Contract selection from right'] : ['Tracks', 'Select all tracks']);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await action();
	const overlays = editor.locator('[data-time-selection-overlay]');
	await expect(overlays).not.toHaveCount(0);
	const healthy = await overlays.first().boundingBox();
	expect(healthy).not.toBeNull();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Home');
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await action();
	await expect(overlays).not.toHaveCount(0);
	const current = await overlays.first().boundingBox();
	expect(current).not.toBeNull();
	expect(current.width).toBeCloseTo(healthy.width, 0);
});
