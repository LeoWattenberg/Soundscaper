import { resolveSkinTheme } from '../../src/common/editor/ui/skins/skin-themes.ts';
import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

const rgb = (hex) => `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
for (const product of ['soundscaper', 'framescaper']) {
	for (const mode of ['Light', 'Dark']) test.describe(`${product} Sakura ${mode} surfaces`, () => {
		registerAudioEditorHooks();
		test('uses flat pink timecodes and colors meters, ruler selection and loop', async ({ page }, testInfo) => {
			const editor = await bootEditor(page, `${product === 'soundscaper' ? '' : '/framescaper'}/embed/en/?useskin=sakura`);
			await importFiles(editor, [monoTone]);
			await chooseCommandAction(page, editor, 'Edit', 'Preferences');
			const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await dialog.getByRole('tab', { name: /Appearance$/u }).click();
			await dialog.getByRole('radio', { name: mode, exact: true }).click();
			await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
			const theme = resolveSkinTheme('sakura', mode.toLowerCase());
			const displays = editor.locator('.timecode__display');
			await expect(displays.first()).toBeVisible();
			for (const display of await displays.all()) await expect(display).toHaveCSS('background-color', rgb(theme.background.control.timecode.idle));
			const arrows = editor.locator('.timecode__format-button');
			for (const arrow of await arrows.all()) {
				await expect(arrow).toHaveCSS('box-shadow', 'none');
				await expect(arrow.locator('.icon')).toHaveCSS('transform', 'none');
				await expect(arrow.locator('.icon')).toHaveCSS('color', rgb(theme.foreground.text.primary));
				await arrow.hover();
				await page.mouse.down();
				await expect(arrow).toHaveCSS('box-shadow', 'none');
				await page.mouse.move(0, 0);
				await page.mouse.up();
			}
			await expect(editor.locator('.track-meter__main').first()).toHaveCSS('background-color', rgb(theme.background.control.meter.background));
			const ruler = editor.locator('.audio-editor-ruler-viewport canvas.timeline-ruler').first();
			await expect(ruler).toBeVisible();
			const bounds = await ruler.boundingBox();
			for (const y of [bounds.height - 4, 4]) {
				await page.mouse.move(bounds.x + 60, bounds.y + y);
				await page.mouse.down();
				await page.mouse.move(bounds.x + 180, bounds.y + y, { steps: 8 });
				await page.mouse.up();
			}
			await expectRulerColors(ruler, theme);
			await page.screenshot({ path: testInfo.outputPath('Sakura-timecodes-ruler-meters.png') });
			if (product === 'framescaper') {
				await editor.getByRole('button', { name: 'Sequence timing', exact: true }).click();
				const timing = page.getByRole('dialog', { name: 'Sequence timing', exact: true });
				await timing.getByRole('checkbox', { name: 'Timecode ruler', exact: true }).check();
				await page.keyboard.press('Escape');
				await expect(editor.locator('[data-sequence-timecode-ruler]')).toBeVisible();
			} else {
				await page.setViewportSize({ width: 2200, height: 1000 });
				await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Music']);
				const denominator = editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
				await denominator.fill('8');
				await denominator.blur();
				await editor.locator('[data-ruler]').press('Shift+F10');
				await page.locator('.timeline-ruler-context-menu').getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
				await expect(editor.locator('[data-musical-map-ruler]')).toBeVisible();
			}
			await expectRulerColors(ruler, theme);
		});
	});
}

async function expectRulerColors(ruler, theme) {
	for (const color of [theme.background.panel.timeline, theme.audio.selection.time, theme.audio.timeline.loopRegionFill]) {
		await expect.poll(() => ruler.evaluate((canvas, hex) => {
			const expected = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
			const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
			let count = 0;
			for (let i = 0; i < pixels.length; i += 4) if (expected.every((value, index) => pixels[i + index] === value)) count++;
			return count;
		}, color)).toBeGreaterThan(30);
	}
}
