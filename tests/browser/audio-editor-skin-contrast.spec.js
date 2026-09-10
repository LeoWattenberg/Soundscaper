import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

async function appearance(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Appearance$/u }).click();
	return dialog;
}

// Composite transparent ancestors, so a token-only test cannot miss a control
// that is actually mounted over a different panel. Ignore disabled controls:
// they are exempt from the interactive contrast requirement.
async function contrast(locator, property = 'color', minimum = 4.5, outside = false) {
	await expect(locator.first()).toBeVisible();
	for (const element of await locator.all()) {
		if (!await element.isVisible() || !await element.isEnabled()) continue;
		await element.evaluate(async (node) => {
			getComputedStyle(node).backgroundColor;
			await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
		});
		const result = await element.evaluate((node, { property, outside }) => {
			const rgb = (value) => {
				const values = value.match(/[\d.]+/gu).map(Number);
				if (value.startsWith('color(srgb ')) return values.map((v, i) => i < 3 ? v * 255 : v);
				if (!value.startsWith('rgb')) throw new Error(`Unsupported contrast color: ${value}`);
				return values;
			};
			const composite = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
			const background = (target) => {
				if (!target) return [255, 255, 255];
				return composite(rgb(getComputedStyle(target).backgroundColor), background(target.parentElement));
			};
			const luminance = (color) => color.map((v) => {
				v /= 255;
				return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
			const back = background(outside ? node.parentElement : node);
			const front = composite(rgb(getComputedStyle(node)[property]), back);
			const a = luminance(front);
			const b = luminance(back);
			return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), text: node.textContent, front, back };
		}, { property, outside });
		expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(minimum);
	}
}

for (const product of ['soundscaper', 'framescaper']) {
	test.describe(`${product} skin contrast`, () => {
		registerAudioEditorHooks();
		const path = product === 'soundscaper' ? '/embed/en/' : '/framescaper/embed/en/';
		for (const skin of ['sakura', 'lilac', 'techno']) {
			for (const mode of ['Light', 'Dark']) {
				test(`${skin}/${mode} scale, dialogs, buttons, checkboxes and portals`, async ({ page }) => {
					const editor = await bootEditor(page, `${path}?useskin=${skin}`);
					// Apply after navigation, which can reset Firefox's media emulation.
					await page.emulateMedia({ colorScheme: mode.toLowerCase() });
					await importFiles(editor, [monoTone]);
					const dialog = await appearance(page, editor);
					await dialog.getByRole('radio', { name: mode, exact: true }).click();
					await contrast(dialog.locator('.editor-skin-choice, .labeled-checkbox__label'));
					const checkbox = dialog.getByRole('checkbox', { name: 'Follow system theme', exact: true });
					await expect(checkbox).toBeVisible();
					await contrast(checkbox, 'borderTopColor', 3, true);
					await checkbox.hover();
					await contrast(checkbox, 'borderTopColor', 3, true);
					// Space tests the real checkbox keyboard path without the high-contrast override.
					await checkbox.focus();
					await page.keyboard.press('Space');
					await expect(checkbox).toHaveAttribute('aria-checked', 'true');
					await contrast(dialog.locator('.checkbox__icon'), 'color', 3);
					await page.mouse.down();
					await contrast(dialog.locator('.checkbox__icon'), 'color', 3);
					await page.mouse.move(0, 0);
					await page.mouse.up();
					await page.keyboard.press('Space');
					const button = dialog.getByRole('button', { name: 'Close', exact: true }).last();
					await contrast(dialog.locator('.button:not(:disabled)'));
					await button.hover();
					await contrast(button);
					await page.mouse.down();
					await contrast(button);
					await page.mouse.move(0, 0);
					await page.mouse.up();
					await dialog.getByRole('group', { name: 'Default view', exact: true }).getByRole('button').click();
					await contrast(page.getByRole('option'));
					await page.keyboard.press('Escape');
					await button.click();
					const labels = editor.locator('.audio-editor-vertical-ruler .vertical-ruler__label');
					await expect(labels.first()).toBeVisible();
					await expect(page.locator('html')).toHaveAttribute('data-theme', mode.toLowerCase());
					await contrast(labels);
					await contrast(editor.locator('.vertical-ruler__tick-mark'), 'backgroundColor', 3, true);
					if (product === 'soundscaper') {
						await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Audacity']);
						await contrast(editor.locator('.kw-audio-editor__snap-control .labeled-checkbox__label'));
						await contrast(editor.locator('.kw-audio-editor__snap-control .checkbox'), 'borderTopColor', 3, true);
						await chooseCommandAction(page, editor, 'Generate', 'Tone');
						const generator = page.getByRole('dialog', { name: 'Tone', exact: true });
						await expect(generator).toBeVisible();
						await contrast(generator.locator('input'));
						for (const variant of ['primary', 'secondary']) {
							const action = generator.locator(`.button--${variant}`).first();
							await contrast(action);
							await action.hover();
							await contrast(action);
							await page.mouse.down();
							await contrast(action);
							await page.mouse.move(0, 0);
							await page.mouse.up();
						}
					}
				});
			}
		}

		for (const mode of ['Light', 'Dark']) test(`Sakura/${mode} buttons have deep travel, stable bounds and keyboard focus`, async ({ page }, testInfo) => {
			const editor = await bootEditor(page, `${path}?useskin=sakura`);
			const dialog = await appearance(page, editor);
			await dialog.getByRole('radio', { name: mode, exact: true }).click();
			const button = dialog.getByRole('button', { name: 'Close', exact: true }).last();
			const label = button.locator('.button__text');
			const bounds = await button.boundingBox();
			const idle = await label.boundingBox();
			await page.keyboard.press('Tab');
			await button.focus();
			await expect(button).toHaveCSS('outline-style', 'solid');
			await contrast(button, 'outlineColor', 3, true);
			await page.screenshot({ path: testInfo.outputPath('Sakura-raised.png') });
			// Native Firefox buttons activate on Space release without :active.
			// Check face travel with the pointer, then keyboard activation below.
			await button.hover();
			await page.mouse.down();
			await expect.poll(async () => (await label.boundingBox()).y - idle.y).toBeGreaterThanOrEqual(5);
			expect(await button.boundingBox()).toEqual(bounds);
			await contrast(button);
			await page.screenshot({ path: testInfo.outputPath('Sakura-pressed.png') });
			await page.mouse.move(0, 0);
			await page.mouse.up();
			await expect(dialog).toBeVisible();
			await button.focus();
			await page.keyboard.press('Space');
			await expect(dialog).toBeHidden();
			await appearance(page, editor);
			await page.emulateMedia({ reducedMotion: 'reduce' });
			expect(await label.evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThanOrEqual(0.001);
			await dialog.getByRole('checkbox', { name: /high.contrast/iu }).check();
			await expect(label).toHaveCSS('transform', 'none');
			await dialog.getByRole('checkbox', { name: /high.contrast/iu }).uncheck();
			await expect(label).not.toHaveCSS('transform', 'none');
		});
	});
}
