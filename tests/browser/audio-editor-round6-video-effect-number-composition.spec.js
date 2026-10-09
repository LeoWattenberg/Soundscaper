/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('a video effect numeric gesture keeps its native composition before final publication', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('native-brightness.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const brightness = rack.locator('[data-video-effect-param="brightness"] input[type="number"]');
	await brightness.fill('0.2');
	await brightness.press('Enter');
	await expect(brightness).toHaveValue('0.2');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(brightness).toHaveValue('0');
	await brightness.fill('0.3');
	const prevented = await brightness.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(brightness).toHaveValue('0.3');
	await expect(brightness).toBeFocused();
	await brightness.fill('0.4');
	await brightness.press('Enter');
	await expect(brightness).toHaveValue('0.4');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(brightness).toHaveValue('0');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(brightness).toHaveValue('0.4');
});
