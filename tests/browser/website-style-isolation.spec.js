import { expect, test } from './audio-editor-test-fixtures.js';
import { waitForEditor } from './audio-editor-test-helpers.js';

test('website chrome and global design-system styles remain independent in both themes', async ({ page }) => {
	await page.goto('/en/');
	await waitForEditor(page);
	const editor = page.locator('[data-audio-editor]');
	const sidebar = page.locator('[data-sidebar]');
	await expect(sidebar).toBeVisible();

	for (const theme of ['light', 'dark']) {
		await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
		await expect(editor).toHaveCSS('color-scheme', theme);
		await expect(editor).toHaveCSS('font-family', 'Inter, sans-serif');
		await expect(sidebar).toHaveCSS('background-color', theme === 'dark' ? 'rgb(27, 21, 17)' : 'rgb(255, 255, 255)');
		await expect(editor).toHaveCSS('background-color', theme === 'dark' ? 'rgb(37, 38, 43)' : 'rgb(248, 248, 249)');
		const tokens = await editor.evaluate((element) => {
			const style = getComputedStyle(element);
			return { accent: style.getPropertyValue('--accent').trim(), oldAccent: style.getPropertyValue('--kw-editor-accent').trim() };
		});
		expect(tokens.accent).not.toBe('');
		expect(tokens.oldAccent).toBe('');
	}

	// A design-system control outside the editor must receive the same base
	// rules. This catches accidentally restoring the former ancestor prefix.
	await page.evaluate(() => {
		const button = document.createElement('button');
		button.className = 'button button--default';
		button.textContent = 'Global design-system probe';
		document.body.append(button);
	});
	const probe = page.getByRole('button', { name: 'Global design-system probe' });
	await expect(probe).toHaveCSS('display', 'flex');
	await expect(probe).toHaveCSS('height', '28px');
	await expect(probe).toHaveCSS('font-family', 'Inter, sans-serif');
});
