import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const locale of ['de', 'ar']) {
	test(`skins preserve compact ${locale} workspace and timeline direction`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, `/embed/${locale}/`);
		await expect(editor).toHaveAttribute('data-layout', 'compact');
		await page.evaluate(() => document.fonts.ready);
		const bounds = await geometry(editor);
		for (const skin of ['sakura', 'lilac', 'techno']) {
			await page.evaluate((id) => {
				history.pushState(null, '', `?useskin=${id}`);
				window.dispatchEvent(new PopStateEvent('popstate'));
			}, skin);
			await expect(editor).toHaveAttribute('data-editor-skin', skin);
			await page.evaluate(() => document.fonts.ready);
			expect(await geometry(editor)).toEqual(bounds);
			await expect(editor.locator('.audio-editor-timeline-scroll')).toHaveCSS('direction', 'ltr');
			await page.screenshot({ path: testInfo.outputPath(`${skin}-${locale}-compact.png`) });
		}
	});
}

test('each product remembers its own skin', async ({ page }) => {
	const paths = { soundscaper: '/embed/en/', framescaper: '/framescaper/embed/en/' };
	for (const [product, skin] of [['soundscaper', 'Sakura'], ['framescaper', 'Techno']]) {
		const editor = await bootEditor(page, paths[product]);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await dialog.getByRole('tab', { name: /Appearance$/u }).click();
		await dialog.getByRole('button', { name: skin, exact: true }).click();
		await expect(dialog.getByRole('button', { name: skin, exact: true })).toBeEnabled();
	}
	for (const [product, skin] of [['soundscaper', 'sakura'], ['framescaper', 'techno']]) {
		const editor = await bootEditor(page, paths[product]);
		await expect(editor).toHaveAttribute('data-editor-skin', skin);
	}
});

async function geometry(editor) {
	const bounds = await editor.locator('.audio-editor-timeline-scroll').boundingBox();
	return Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)]));
}

test('Default does not fetch optional skin fonts', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => document.fonts.ready);
	const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
	expect(resources.filter((url) => /nunito-sans|jetbrains-mono/u.test(url))).toEqual([]);
	await page.evaluate(() => {
		history.replaceState(null, '', '?useskin=sakura');
		window.dispatchEvent(new PopStateEvent('popstate'));
	});
	await expect(editor).toHaveAttribute('data-editor-skin', 'sakura');
	await expect.poll(() => page.evaluate(() => document.fonts.check('12px "Nunito Sans"'))).toBe(true);
});
