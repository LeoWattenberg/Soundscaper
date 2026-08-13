import { expect, test } from '@playwright/test';

import { chooseFileAction } from './audio-editor-test-helpers.js';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const SOUNDSCAPER_DATABASE = 'kw-media-audio-editor';
const FRAMESCAPER_V18_DATABASE = 'kw-media-framescaper-editor-v18';

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
		await soundscaper.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Tracks', exact: true })
			.getByRole('menuitem', { name: /^Nested sequences(?:\s|$)/u })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Help', exact: true }).getByRole('menuitem', { name: 'About Soundscaper', exact: true })).toBeVisible();

		await page.goto('/framescaper/en/');
		const framescaper = await readyEditor(page, 'framescaper');
		await expect(page.locator('[data-sidebar] .brand strong')).toHaveText('Framescaper');
		await expect(framescaper).toHaveAttribute('data-workspace-preset', 'video-editor');
		await expect(framescaper.locator('[data-transport="record"]')).toHaveCount(0);
		await expect(page.locator('[data-workspace-select] option[value="video-editor"]')).toHaveCount(1);
		await framescaper.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Tracks', exact: true })
			.getByRole('menuitem', { name: /^Nested sequences(?:\s|$)/u })).toBeVisible();
		await page.keyboard.press('Escape');
		await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Help', exact: true }).getByRole('menuitem', { name: 'About Framescaper', exact: true })).toBeVisible();
	});

	test('the File menu reaches an isolated V18 library while Soundscaper remains V17', async ({ page }) => {
		await page.goto('/en/');
		const soundscaper = await readyEditor(page, 'soundscaper');
		const soundscaperProjectId = await soundscaper.getAttribute('data-project-id');
		expect(soundscaperProjectId).toBeTruthy();
		await saveProject(page, soundscaper);
		await expect(soundscaper.getByRole('button', { name: 'Edit in Framescaper', exact: true })).toHaveCount(0);

		await soundscaper.getByRole('menuitem', { name: 'File', exact: true }).click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		const editInFramescaper = fileMenu.getByRole('menuitem', { name: 'Edit in Framescaper', exact: true });
		await expect(editInFramescaper).toBeVisible();
		await editInFramescaper.click();
		await page.waitForURL((url) => url.pathname === '/framescaper/en/'
			&& url.searchParams.get('project') === soundscaperProjectId);
		const framescaper = await readyEditor(page, 'framescaper', 'error');
		await expect(framescaper.locator('[data-status]')).toContainText('The project was not found.');
		const framescaperProjectId = await framescaper.getAttribute('data-project-id');
		expect(framescaperProjectId).toBeTruthy();
		expect(framescaperProjectId).not.toBe(soundscaperProjectId);
		await saveProject(page, framescaper);

		await expect.poll(() => storedProject(page, SOUNDSCAPER_DATABASE, soundscaperProjectId))
			.toEqual({ id: soundscaperProjectId, schemaVersion: 17 });
		await expect.poll(() => storedProject(page, FRAMESCAPER_V18_DATABASE, framescaperProjectId))
			.toEqual({ id: framescaperProjectId, schemaVersion: 18 });
		expect(await storedProject(page, SOUNDSCAPER_DATABASE, framescaperProjectId)).toBeNull();
		expect(await storedProject(page, FRAMESCAPER_V18_DATABASE, soundscaperProjectId)).toBeNull();

		await page.goto(`/framescaper/en/?project=${encodeURIComponent(framescaperProjectId)}`);
		const reopenedFramescaper = await readyEditor(page, 'framescaper');
		await expect(reopenedFramescaper).toHaveAttribute('data-project-id', framescaperProjectId);
		await expect(reopenedFramescaper.getByRole('tab', { selected: true })).toBeEnabled();

		await page.goto(`/en/?project=${encodeURIComponent(soundscaperProjectId)}`);
		const reopenedSoundscaper = await readyEditor(page, 'soundscaper');
		await expect(reopenedSoundscaper).toHaveAttribute('data-project-id', soundscaperProjectId);
		await expect(reopenedSoundscaper.getByRole('tab', { selected: true })).toBeEnabled();
	});
});

async function saveProject(page, editor) {
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}

async function storedProject(page, databaseName, projectId) {
	return page.evaluate(({ databaseName: name, projectId: id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(name);
		open.onerror = () => reject(open.error || new Error(`Could not open ${name}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				const project = request.result;
				database.close();
				resolve(project ? { id: project.id, schemaVersion: project.schemaVersion } : null);
			};
		};
	}), { databaseName, projectId });
}

async function readyEditor(page, productId, statusState = 'success') {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor).toHaveAttribute('data-product', productId);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', statusState, { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}
