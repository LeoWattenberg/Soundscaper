import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const RETIRED_INVENTORY = Object.freeze({
	schemaVersion: 2,
	assets: [Object.freeze({ url: '/assets/site-entry-RETIRED.js', byteLength: 1, sha256: 'a'.repeat(64) })],
});

test.describe('Stale build reload prompt', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('a retired chunk prompts to reload and leaves the editor usable when cancelled', async ({ page }) => {
		await publishNewerRelease(page);
		await retireChunk(page, 'ExportDialog');
		const editor = await bootEditorWithTone(page);

		await chooseCommand(page, editor, 'File', 'Export audio');
		const prompt = page.getByRole('alertdialog', { name: 'Editor is out of date' });
		await expect(prompt).toBeVisible();
		await expect(prompt.getByRole('button', { name: 'Reload', exact: true })).toBeFocused();

		await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(prompt).toBeHidden();
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		// A second reach for an unloadable surface explains itself again.
		await chooseCommand(page, editor, 'File', 'Export audio');
		await expect(prompt).toBeVisible();
	});

	test('Escape dismisses the prompt without reloading', async ({ page }) => {
		await publishNewerRelease(page);
		await retireChunk(page, 'ExportDialog');
		const editor = await bootEditorWithTone(page);
		await page.evaluate(() => { window.staleBuildProbeMarker = true; });

		await chooseCommand(page, editor, 'File', 'Export audio');
		const prompt = page.getByRole('alertdialog', { name: 'Editor is out of date' });
		await expect(prompt).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(prompt).toBeHidden();
		expect(await page.evaluate(() => window.staleBuildProbeMarker === true)).toBe(true);
	});

	test('Reload replaces the document with the current release', async ({ page }) => {
		await publishNewerRelease(page);
		await retireChunk(page, 'ExportDialog');
		const editor = await bootEditorWithTone(page);
		await page.evaluate(() => { window.staleBuildProbeMarker = true; });

		await chooseCommand(page, editor, 'File', 'Export audio');
		const prompt = page.getByRole('alertdialog', { name: 'Editor is out of date' });
		await expect(prompt).toBeVisible();
		await prompt.getByRole('button', { name: 'Reload', exact: true }).click();

		await expect
			.poll(() => page.evaluate(() => window.staleBuildProbeMarker === undefined), { timeout: 15_000 })
			.toBe(true);
		await expect(page.locator('[data-audio-editor]')).toBeVisible();
	});

	test('a chunk that fails while the release is still current never prompts', async ({ page }) => {
		// No inventory override: the origin still serves the release this tab is running.
		await retireChunk(page, 'ExportDialog');
		const editor = await bootEditorWithTone(page);

		await chooseCommand(page, editor, 'File', 'Export audio');
		await expect(page.getByRole('alertdialog', { name: 'Editor is out of date' })).toBeHidden();
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	});
});

/** Answers the asset inventory the way an origin does once it has deployed past this tab. */
async function publishNewerRelease(page) {
	await page.route('**/offline-shell.json', (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(RETIRED_INVENTORY),
	}));
}

/** Serves the 404 document a retired content-hashed chunk gets after a deploy. */
async function retireChunk(page, chunkName) {
	await page.route(`**/assets/${chunkName}-*.js`, (route) => route.fulfill({
		status: 404,
		contentType: 'text/html',
		body: '<!doctype html><title>Not found</title>',
	}));
}

async function bootEditorWithTone(page) {
	await page.goto('/embed/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();

	await chooseCommand(page, editor, 'Generate', 'Tone');
	const generator = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = generator.locator('[data-generator-field="durationSeconds"] input');
	await duration.fill('0.05');
	await duration.press('Tab');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	return editor;
}

async function chooseCommand(page, editor, menuName, commandName) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await expect(menu).toBeVisible();
	const escapedName = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const command = menu.getByRole('menuitem', { name: new RegExp(`^${escapedName}(?:\\s|$)`) }).first();
	await command.focus();
	await page.keyboard.press('Enter');
}
