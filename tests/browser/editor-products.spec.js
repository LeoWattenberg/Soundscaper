import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.describe('Soundscaper and Framescaper product surfaces', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 404,
			body: '',
		}));
	});

	test('renders the product shell while the editor chunk is still loading', async ({ page }) => {
		let releaseEditorChunk;
		const editorChunkGate = new Promise((resolve) => { releaseEditorChunk = resolve; });
		await page.route(/\/assets\/AudioEditorBootstrap-[^/]+\.js$/u, async (route) => {
			await editorChunkGate;
			await route.continue();
		});

		await page.goto('/en/', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('[data-sidebar] .brand strong')).toHaveText('Soundscaper');
		await expect(page.locator('.tool-intro h1')).toBeVisible();
		await expect(page.locator('.audio-editor-section').getByRole('status')).toHaveText('Loading project');

		releaseEditorChunk();
		await readyEditor(page, 'soundscaper');
	});

	test('profiles select distinct branding, workspaces, and authoring controls', async ({ page }) => {
		await page.goto('/en/');
		const soundscaper = await readyEditor(page, 'soundscaper');
		await expect(page.locator('[data-sidebar] .brand strong')).toHaveText('Soundscaper');
		await expect(soundscaper).toHaveAttribute('data-workspace-preset', 'modern');
		await expect(soundscaper.locator('[data-transport="record"]')).toBeVisible();
		await expect(page.locator('[data-workspace-select] option[value="video-editor"]')).toHaveCount(0);
		await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Help', exact: true }).getByRole('menuitem', { name: 'About Soundscaper', exact: true })).toBeVisible();

		await page.goto('/framescaper/en/');
		const framescaper = await readyEditor(page, 'framescaper');
		await expect(page.locator('[data-sidebar] .brand strong')).toHaveText('Framescaper');
		await expect(framescaper).toHaveAttribute('data-workspace-preset', 'video-editor');
		await expect(framescaper.locator('[data-transport="record"]')).toHaveCount(0);
		await expect(page.locator('[data-workspace-select] option[value="video-editor"]')).toHaveCount(1);
		await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Help', exact: true }).getByRole('menuitem', { name: 'About Framescaper', exact: true })).toBeVisible();
	});

	test('a project opens across product routes without copying its shared library entry', async ({ page }) => {
		await page.goto('/en/');
		const soundscaper = await readyEditor(page, 'soundscaper');
		const projectId = await soundscaper.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		await page.getByRole('menuitem', { name: 'File', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Edit in Framescaper', exact: true }).click();
		await page.waitForURL((url) => url.pathname === '/framescaper/en/' && url.searchParams.get('project') === projectId);
		const framescaper = await readyEditor(page, 'framescaper');
		await expect(framescaper).toHaveAttribute('data-project-id', projectId);
	});
});

async function readyEditor(page, productId) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor).toHaveAttribute('data-product', productId);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}
