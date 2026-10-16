/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

for (const { product, path } of [
	{ product: 'soundscaper', path: '/embed/en/' },
	{ product: 'framescaper', path: '/framescaper/embed/en/' },
]) test(`${product} translation picking releases native composition cancellation`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, path);
	await chooseCommandAction(page, editor, 'Help', 'Contribute translations');
	const surface = page.getByRole('dialog', { name: 'Community translations', exact: true });
	const pick = surface.getByRole('button', { name: 'Pick a message in the editor', exact: true });
	const search = surface.getByRole('searchbox', { name: 'Find a message', exact: true });
	await expect(surface.getByRole('textbox', { name: 'English source', exact: true })).toBeVisible();
	await pick.click();
	await expect(pick).toHaveAttribute('aria-pressed', 'true');
	await search.focus();
	await search.press('Escape');
	await expect(pick).toHaveAttribute('aria-pressed', 'false');
	await expect(surface).toBeVisible();
	for (const state of [{ isComposing: true, keyCode: 27 }, { isComposing: false, keyCode: 229 }]) {
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await search.fill('とう');
		const prevented = await search.evaluate((field, nativeState) => {
			const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape',
				bubbles: true, cancelable: true, isComposing: nativeState.isComposing, keyCode: nativeState.keyCode });
			field.dispatchEvent(event);
			return event.defaultPrevented;
		}, state);
		expect(prevented).toBe(false);
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await expect(search).toBeFocused();
		await expect(search).toHaveValue('とう');
		await search.fill('東京');
		await search.press('Escape');
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		await expect(surface).toBeVisible();
	}
	await search.press('Escape');
	await expect(surface).toHaveCount(0);
	expect(errors).toEqual([]);
});
