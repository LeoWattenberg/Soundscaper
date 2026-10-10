/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a stereo divider completes at primary release while middle remains held', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('radiogroup', { name: 'Asymmetric stereo heights', exact: true })
		.getByRole('radio', { name: 'Always', exact: true }).check();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const divider = editor.locator('[data-stereo-channel-divider]').last();
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	await divider.press('Home');
	const initial = await divider.getAttribute('aria-valuenow');
	const box = await divider.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + 50, y: box.y + box.height / 2, id: 1 };
	const final = { ...first, y: first.y + 24 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect(divider).not.toHaveAttribute('aria-valuenow', initial);
	const completed = await divider.getAttribute('aria-valuenow');
	await divider.press('Home');
	await expect(divider).toHaveAttribute('aria-valuenow', initial);
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await expect(divider).toHaveAttribute('aria-valuenow', completed);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await page.mouse.move(first.x, first.y + 48, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect(divider).toHaveAttribute('aria-valuenow', completed);
	await divider.press('Home');
	await expect(divider).toHaveAttribute('aria-valuenow', initial);
});
