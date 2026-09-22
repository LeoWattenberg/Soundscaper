/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog,
	importFiles, registerAudioEditorHooks, waitForResponsiveEditorLayout,
} from './audio-editor-test-helpers.js';

const styleSelectors = [
	'.audio-editor-filter-curve__instructions',
	'.audio-editor-graphic-eq__board',
	'.audio-editor-audacity-dynamics__controls',
	'.audio-editor-audacity-port__body',
];

function loadedEffectStyles(page) {
	return page.evaluate((selectors) => {
		const loaded = new Set();
		for (const sheet of document.styleSheets) {
			try {
				for (const rule of sheet.cssRules) {
					if (!(rule instanceof CSSStyleRule)) continue;
					for (const selector of selectors) {
						if (rule.selectorText.includes(selector)) loaded.add(selector);
					}
				}
			} catch {
				// Cross-origin stylesheets cannot be inspected.
			}
		}
		return selectors.filter((selector) => loaded.has(selector));
	}, styleSelectors);
}

async function openSelectionEffect(page, editor, category, name) {
	// Keep the pointer clear of the compact menu while keyboard navigation opens submenus.
	await page.mouse.move(1, 1);
	await chooseNestedCommandAction(page, editor, 'Effect', [category, name]);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('lazy effect dialog styles', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1600, height: 1000 } });

	test('loads effect-specific styles on demand and preserves the four layouts', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		expect(await loadedEffectStyles(page)).toEqual([]);
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		let dialog = await openSelectionEffect(page, editor, 'EQ and filters', 'Filter Curve EQ');
		await expect.poll(() => loadedEffectStyles(page)).toEqual(styleSelectors);
		await expect(dialog.locator('.audio-editor-filter-curve svg')).toHaveCSS('height', '300px');
		await closeDialog(dialog);

		dialog = await openSelectionEffect(page, editor, 'EQ and filters', 'Graphic EQ');
		await expect(dialog.locator('.audio-editor-graphic-eq__board')).toHaveCSS('display', 'grid');
		await closeDialog(dialog);

		dialog = await openSelectionEffect(page, editor, 'Volume and compression', 'Compressor');
		await expect(dialog.locator('.audio-editor-audacity-dynamics__controls')).toHaveCSS('display', 'grid');
		await closeDialog(dialog);

		dialog = await openSelectionEffect(page, editor, 'EQ and filters', 'Bass and Treble');
		await expect(dialog.locator('.audio-editor-audacity-port__body')).toHaveCSS('display', 'grid');
		await closeDialog(dialog);

		await page.setViewportSize({ width: 540, height: 800 });
		await waitForResponsiveEditorLayout(editor);
		dialog = await openSelectionEffect(page, editor, 'EQ and filters', 'Bass and Treble');
		await expect(dialog.locator('.audio-editor-audacity-port__body'))
			.toHaveCSS('grid-template-columns', /^[\d.]+px$/u);
		await closeDialog(dialog);
		dialog = await openSelectionEffect(page, editor, 'Volume and compression', 'Compressor');
		await expect(dialog.locator('.audio-editor-audacity-dynamics__controls'))
			.toHaveCSS('grid-template-columns', /^[\d.]+px [\d.]+px$/u);
		await closeDialog(dialog);
	});
});
