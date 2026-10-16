/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('Project bin rename keeps an unfinished composed name until ordinary confirmation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles([monoTone]);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	const name = card.locator('[data-project-bin-name]');
	const originalLabel = await name.getAttribute('aria-label');
	await name.fill('とう');
	const prevented = await name.evaluate(input => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		input.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(name).toBeFocused();
	await expect(name).toHaveAttribute('aria-label', originalLabel);
	await name.fill('東京の録音');
	await name.press('Enter');
	await expect(name).toHaveValue('東京の録音');
	await expect(name).toHaveAttribute('aria-label', /東京の録音$/u);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(name).toHaveAttribute('aria-label', originalLabel);
});
