import { wcagContrastRatio } from '../../src/common/editor/ui/theme-contrast.ts';
import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

const buttonGroups = [
	['toolbar', ':is(.tool-button, [data-editor-tool-toolbar] button):not(.toggle-tool-button, .toggle-button, .kw-audio-editor__split-button-arrow, .kw-audio-editor__audacity-level-button)'],
	['toggle', '.toggle-tool-button, .toggle-button'],
	['split and meter', '.kw-audio-editor__split-button-arrow, .kw-audio-editor__audacity-level-button'],
];

for (const product of ['soundscaper', 'framescaper']) {
	for (const mode of ['Light', 'Dark']) test.describe(`${product} Sakura ${mode} buttons`, () => {
		registerAudioEditorHooks();
		test.beforeEach(async ({ page }) => {
			const editor = await bootEditor(page, `${product === 'soundscaper' ? '' : '/framescaper'}/embed/en/?useskin=sakura`);
			await importFiles(editor, [monoTone]);
			await chooseCommandAction(page, editor, 'Edit', 'Preferences');
			const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await dialog.getByRole('tab', { name: /Appearance$/u }).click();
			await dialog.getByRole('radio', { name: mode, exact: true }).click();
			await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
			await page.evaluate(() => document.fonts.ready);
		});
		// Bound each pointer sweep as well as the stateful interactions so the
		// exhaustive coverage fits WebKit's per-test budget on the CI runner.
		for (const [group, selector] of buttonGroups) test(`raises ${group} controls without moving their bounds`, async ({ page }, testInfo) => {
			const editor = page.locator('[data-audio-editor]');
			const undo = editor.locator('[data-edit="undo"] button');
			const redo = editor.locator('[data-edit="redo"] button');
			await expect(undo).toBeVisible();
			await expect(redo).toBeVisible();
			await expect(editor.locator('.kw-audio-editor__audacity-level-button').first()).toBeVisible();
			await expect(undo.locator('.tool-button__icon')).toHaveCSS('display', 'flex');
			const controls = editor.locator(selector);
			await expect(controls.first()).toBeVisible();
			for (const button of await controls.all()) {
				if (!await button.isVisible()) continue;
				if (await button.evaluate((node) => node.classList.contains('timecode__format-button'))) {
					await expect(button).toHaveCSS('box-shadow', 'none');
					continue;
				}
				await expect(button).toHaveCSS('box-shadow', /inset/u);
				const bounds = await button.boundingBox();
				if (await button.isEnabled() && await button.getAttribute('aria-pressed') !== 'true' && await button.getAttribute('aria-expanded') !== 'true') {
					const raised = await button.evaluate((node) => getComputedStyle(node).boxShadow);
					await button.hover();
					await page.mouse.down();
					await expect(button).not.toHaveCSS('box-shadow', raised);
					expect(await button.boundingBox()).toEqual(bounds);
					await page.mouse.move(0, 0);
					await page.mouse.up();
				}
			}
			await page.screenshot({ path: testInfo.outputPath('Sakura-all-buttons.png') });
		});
		test('preserves toggle contrast, keyboard focus, history and split-menu interactions', async ({ page }) => {
			const editor = page.locator('[data-audio-editor]');
			const undo = editor.getByRole('button', { name: 'Undo', exact: true });
			const redo = editor.getByRole('button', { name: 'Redo', exact: true });
			for (const name of ['Mute', 'Solo']) {
				const button = editor.getByRole('button', { name, exact: true }).first();
				await expect(button).toBeVisible();
				const raised = await button.evaluate((node) => getComputedStyle(node).boxShadow);
				await button.click();
				await page.mouse.move(0, 0);
				await expect(button).toHaveAttribute('aria-pressed', 'true');
				const colors = await button.evaluate(async (node) => {
					getComputedStyle(node).backgroundColor;
					await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
					const hex = (color) => `#${color.match(/\d+/gu).slice(0, 3).map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`;
					const style = getComputedStyle(node);
					return [hex(style.color), hex(style.backgroundColor)];
				});
				expect(wcagContrastRatio(...colors)).toBeGreaterThanOrEqual(4.5);
				await expect(button).not.toHaveCSS('box-shadow', raised);
				await page.keyboard.press('Tab');
				await button.focus();
				await expect(button).toHaveCSS('outline-style', 'solid');
				await page.keyboard.press('Space');
				await expect(button).toHaveAttribute('aria-pressed', 'false');
			}
			await undo.click();
			await expect(redo).toBeEnabled();
			await redo.click();
			const arrow = editor.locator('.kw-audio-editor__transport-play-split .kw-audio-editor__split-button-arrow');
			await arrow.click();
			await expect(arrow).toHaveAttribute('aria-expanded', 'true');
			await page.keyboard.press('Escape');
			await expect(arrow).toHaveAttribute('aria-expanded', 'false');
		});
	});
}
