/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup3Fixture, expect, test, monoTone, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeClipProperties, chooseCommandAction, chooseFileAction, chooseNestedCommandAction,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('resampling a clip scales its authored warp source positions', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const clipId = await clip.getAttribute('data-clip-id');
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	let warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await expect(warp.getByRole('table', { name: 'Warp map points', exact: true }).getByRole('row')).toHaveCount(3);
	await page.keyboard.press('Escape');
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	await properties.getByRole('button', { name: 'Resample', exact: true }).click();
	const resample = page.locator('[data-clip-resample-dialog]');
	await resample.getByRole('textbox').fill('24000');
	await resample.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(properties.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value')).toHaveText('24000');
	await closeClipProperties(properties);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await expect(warp.getByRole('table', { name: 'Warp map points', exact: true }).getByRole('row').last()).toContainText('19200/1');
	await page.keyboard.press('Escape');
	await expect(editor.locator(`[data-clip-id="${clipId}"]`)).toHaveAccessibleName(/0\.8 seconds long$/u);
});

test('a copied warped clip conforms to a normally opened Audacity project rate', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await clipByName(editor, monoTone.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	let warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	const bytes = await createAup3Fixture({ sampleRate: 44_100, tracks: [
		{ name: '44.1 kHz recording', clips: [{ samples: Array.from({ length: 4410 }, (_, index) => Math.sin(index / 17) * 0.25) }] },
	] });
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: '44.1 kHz recording.aup3',
		mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	const pasted = clipByName(editor, monoTone.name);
	await expect(pasted).toBeVisible();
	await expect(pasted).toHaveAccessibleName(/0\.8 seconds long$/u);
	await pasted.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await expect(warp.getByRole('table', { name: 'Warp map points', exact: true }).getByRole('row').last()).toContainText('35280/1');
});
