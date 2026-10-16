/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('marker renaming retains its composing Enter until the name is complete', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	const marker = panel.locator('[data-timeline-annotation]').first();
	const originalLabel = await marker.getAttribute('aria-label');
	await marker.focus();
	await marker.press('F2');
	const input = panel.getByRole('group', { name: 'Edit annotation', exact: true }).getByRole('textbox');
	await expect(input).toBeFocused();
	await input.fill('とう');
	const prevented = await input.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(input).toBeFocused();
	await expect(marker).toHaveAttribute('aria-label', originalLabel);
	await input.fill('東京の場面');
	await input.press('Enter');
	await expect(marker).toHaveAttribute('aria-label', /^東京の場面,/u);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(marker).toHaveAttribute('aria-label', originalLabel);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(marker).toHaveAttribute('aria-label', /^東京の場面,/u);
});
