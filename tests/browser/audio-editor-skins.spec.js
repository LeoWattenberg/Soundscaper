import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { assertNoSeriousAxeViolations, bootEditor, chooseCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

async function appearance(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Appearance$/u }).click();
	return dialog;
}

for (const product of ['soundscaper', 'framescaper']) {
	test.describe(`${product} skins`, () => {
		registerAudioEditorHooks();
		const path = product === 'soundscaper' ? '/embed/en/' : '/framescaper/embed/en/';

		test('chooses a skin through Preferences and persists across reload', async ({ page }, testInfo) => {
			let editor = await bootEditor(page, path);
			await expect(editor).toHaveAttribute('data-editor-skin', 'default');
			const workspace = await editor.getAttribute('data-workspace-preset');
			const dialog = await appearance(page, editor);
			const previews = dialog.locator('img');
			await expect(previews).toHaveCount(8);
			for (const preview of await previews.all()) {
				await expect.poll(() => preview.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
				await expect(preview).toHaveCSS('object-fit', 'contain');
			}
			await dialog.screenshot({ path: testInfo.outputPath('appearance-previews.png') });
			await dialog.getByRole('button', { name: 'Lilac', exact: true }).click();
			await expect(dialog.getByRole('button', { name: 'Lilac', exact: true })).toBeEnabled();
			await expect(editor).toHaveAttribute('data-editor-skin', 'lilac');
			editor = await bootEditor(page, path);
			await expect(editor).toHaveAttribute('data-editor-skin', 'lilac');
			await expect(editor).toHaveAttribute('data-workspace-preset', workspace);
		});

		test('URL preview survives unrelated saves, ends cleanly, and can be adopted', async ({ page }) => {
			let editor = await bootEditor(page, `${path}?useskin=sakura&demo=keep#skin`);
			await expect(editor).toHaveAttribute('data-editor-skin', 'sakura');
			let dialog = await appearance(page, editor);
			await expect(dialog.getByRole('status')).toContainText('Previewing Sakura');
			await dialog.getByRole('radio', { name: 'Dark', exact: true }).click();
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
			await dialog.getByRole('button', { name: 'End preview', exact: true }).click();
			await expect(editor).toHaveAttribute('data-editor-skin', 'default');
			expect(new URL(page.url()).search).toBe('?demo=keep');
			expect(new URL(page.url()).hash).toBe('#skin');
			editor = await bootEditor(page, `${path}?useskin=techno`);
			dialog = await appearance(page, editor);
			await dialog.getByRole('button', { name: 'Keep this skin', exact: true }).click();
			await expect(dialog.getByRole('button', { name: 'Keep this skin', exact: true })).toHaveCount(0);
			expect(new URL(page.url()).searchParams.has('useskin')).toBe(false);
			editor = await bootEditor(page, path);
			await expect(editor).toHaveAttribute('data-editor-skin', 'techno');
		});

		test('skin fonts and dropdown portals follow previews and browser history', async ({ page }) => {
			const editor = await bootEditor(page, `${path}?useskin=techno`);
			const dialog = await appearance(page, editor);
			await expect(dialog.getByRole('button', { name: 'Techno', exact: true })).toHaveCSS('font-family', /JetBrains Mono/u);
			await dialog.getByRole('group', { name: 'Default view', exact: true }).getByRole('button').click();
			const option = page.getByRole('option', { name: 'Waveform', exact: true });
			await expect(option).toBeVisible();
			await expect(option).toHaveCSS('font-family', /JetBrains Mono/u);
			await page.keyboard.press('Escape');
			await page.evaluate(() => {
				history.pushState({ test: true }, '', '?useskin=lilac');
				window.dispatchEvent(new PopStateEvent('popstate'));
			});
			await expect(editor).toHaveAttribute('data-editor-skin', 'lilac');
			await dialog.getByRole('button', { name: 'Default', exact: true }).focus();
			await page.keyboard.press('Enter');
			await expect(editor).toHaveAttribute('data-editor-skin', 'default');
			await expect(dialog.getByRole('button', { name: 'End preview', exact: true })).toHaveCount(0);
		});

		test('all skins repaint populated timelines and preserve workspace geometry', async ({ page }, testInfo) => {
			test.setTimeout(120_000);
			const editor = await bootEditor(page, path);
			await importFiles(editor, [monoTone]);
			const workspace = await editor.getAttribute('data-workspace-preset');
			await page.evaluate(() => document.fonts.ready);
			const before = await timelineGeometry(editor);
			const dialog = await appearance(page, editor);
			for (const mode of ['Light', 'Dark']) {
				await dialog.getByRole('radio', { name: mode, exact: true }).click();
				for (const name of ['Default', 'Sakura', 'Lilac', 'Techno']) {
					await dialog.getByRole('button', { name, exact: true }).click();
					await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled();
					await expect(editor).toHaveAttribute('data-editor-skin', name.toLowerCase());
					await expect(editor).toHaveAttribute('data-workspace-preset', workspace);
					await assertNoSeriousAxeViolations(page, '.editor-skin-preferences');
					await page.evaluate(() => document.fonts.ready);
					await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
					const after = await timelineGeometry(editor);
					expect(after).toEqual(before);
					await page.screenshot({ path: testInfo.outputPath(`${name}-${mode}.png`) });
					await appearance(page, editor);
				}
			}
			await dialog.getByRole('checkbox', { name: /high.contrast/iu }).check();
			await expect(editor).toHaveAttribute('data-editor-skin', 'default');
			await dialog.getByRole('checkbox', { name: /high.contrast/iu }).uncheck();
			await expect(editor).toHaveAttribute('data-editor-skin', 'techno');
		});
	});
}

// Font rasterizers can differ by a fraction of a CSS pixel despite matching
// ascent/descent. Compare the actual pixel placement of workspace boundaries.
async function timelineGeometry(editor) {
	const bounds = await editor.locator('.audio-editor-timeline-scroll').boundingBox();
	return Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)]));
}
