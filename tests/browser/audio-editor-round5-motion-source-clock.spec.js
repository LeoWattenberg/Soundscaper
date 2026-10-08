/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('motion analysis source frame time uses the source clock', async ({ page }) => {
	const dialog = await authorTrackingStack(page);
	const end = dialog.getByRole('group', { name: 'End frame', exact: true });
	await showFilmFrames(page, end);
	const digits = end.locator('.timecode-digit');
	await digits.nth(await digits.count() - 2).click();
	await page.keyboard.type('15');
	await page.keyboard.press('Enter');
	await end.getByRole('button', { name: 'End frame: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'seconds + milliseconds', exact: true }).click();
	await expect(end.locator('.timecode__display')).toHaveText('000,001.000s');
});

test('a newly authored tracking stack initializes its full native analysis range', async ({ page }) => {
	const dialog = await authorTrackingStack(page);
	const end = dialog.getByRole('group', { name: 'End frame', exact: true });
	await showFilmFrames(page, end);
	await expect.poll(async () => (await end.locator('.timecode-digit').allTextContents()).join(''))
		.toBe('000000000032');
});

async function authorTrackingStack(page) {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('15fps-motion.webm')]);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Managed Color & Source Interpretation']);
	const color = page.getByRole('dialog', { name: 'Managed Color & Source Interpretation', exact: true });
	const colorState = JSON.parse(await color.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
	const sourceId = colorState.videoSourceColorInterpretations[0].sourceId;
	await color.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Analyze', 'Motion Tracking');
	const dialog = page.getByRole('dialog', { name: 'Motion Tracking', exact: true });
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	const state = JSON.parse(await document.inputValue());
	state.videoProcessorStacks = [{ schemaVersion: 1, id: 'motion-stack', sourceId, processors: [{
		schemaVersion: 1, id: 'tracking', kind: 'tracking', enabled: true,
		maximumFeatures: 32, quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
	}] }];
	await document.fill(JSON.stringify(state, null, 2));
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Finishing state updated.');
	return dialog;
}

async function showFilmFrames(page, end) {
	await end.getByRole('button', { name: 'End frame: format', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video frames/u }).hover();
	await page.getByRole('menuitem', { name: /^film frames/u }).click();
}
