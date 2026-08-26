import { expect, test } from '@playwright/test';

import { chooseFileAction, getMenuItem } from './audio-editor-test-helpers.js';
import {
	FRAMESCAPER_DATABASE_NAME,
	SOUNDSCAPER_DATABASE_NAME,
} from './helpers/editor-databases.js';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.describe('Soundscaper and Framescaper product surfaces', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 404,
			body: '',
		}));
	});

	test('keeps the first-paint progress bar until the editor is ready', async ({ page }) => {
		let releaseEntryChunk;
		let entryChunkIntercepted = false;
		const entryChunkGate = new Promise((resolve) => { releaseEntryChunk = resolve; });
		await page.route(/\/assets\/index-[^/]+\.js$/u, async (route) => {
			entryChunkIntercepted = true;
			await entryChunkGate;
			await route.continue();
		});
		let releaseEditorChunk;
		let editorChunkIntercepted = false;
		const editorChunkGate = new Promise((resolve) => { releaseEditorChunk = resolve; });
		await page.route(/\/assets\/SoundscaperAudioEditorBootstrapV30-[^/]+\.js$/u, async (route) => {
			editorChunkIntercepted = true;
			await editorChunkGate;
			await route.continue();
		});

		await page.goto('/en/', { waitUntil: 'commit' });
		await expect.poll(() => entryChunkIntercepted).toBe(true);
		const initialProgress = page.getByRole('progressbar', { name: 'Loading project', exact: true });
		await expect(initialProgress).toBeVisible();
		await expect(page.locator('body > :first-child')).toHaveAttribute('data-initial-load-progress', '');
		await expect(initialProgress).not.toHaveAttribute('aria-valuenow');
		await expect(initialProgress).toHaveCSS('position', 'fixed');
		expect((await initialProgress.boundingBox())?.height).toBe(2);
		expect(await initialProgress.evaluate((element) => (
			getComputedStyle(element, '::after').animationName
		))).toBe('initial-load-progress');

		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect.poll(() => initialProgress.evaluate((element) => {
			const style = getComputedStyle(element, '::after');
			return { animationName: style.animationName, opacity: style.opacity };
		})).toEqual({ animationName: 'none', opacity: '0.65' });

		releaseEntryChunk();
		await expect.poll(() => editorChunkIntercepted).toBe(true);
		await expect(page.locator('[data-sidebar] .brand strong')).toHaveText('Soundscaper');
		await expect(page.locator('.tool-intro h1')).toBeVisible();
		await expect(page.locator('.audio-editor-section').getByRole('status')).toHaveText('Loading project');
		await expect(page.locator('[data-audio-editor]')).toHaveCount(0);
		await expect(initialProgress).toBeVisible();

		releaseEditorChunk();
		await readyEditor(page, 'soundscaper');
		await expect(initialProgress).toHaveCount(0);
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
		await expect(page.getByRole('menu', { name: 'Tracks', exact: true })
			.getByRole('menuitem', { name: /^Multicamera(?:\s|$)/u })).toHaveCount(0);
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
		await expect(page.getByRole('menu', { name: 'Tracks', exact: true })
			.getByRole('menuitem', { name: /^Multicamera(?:\s|$)/u })).toBeVisible();
		await expect(getMenuItem(page.getByRole('menu', { name: 'Tracks', exact: true }), 'Automation Lanes…'))
			.toBeEnabled();
		await expect(getMenuItem(page.getByRole('menu', { name: 'Tracks', exact: true }), 'Freeze'))
			.toHaveCount(0);
		await page.keyboard.press('Escape');
		await expectFramescaperProductionEntryAbsent(page, framescaper, 'View', ['Panels'], 'Routing graph…');
		await expectFramescaperProductionEntryAbsent(page, framescaper, 'Effect', [], 'Restoration…');
		await expectFramescaperProductionEntryAbsent(page, framescaper, 'Analyze', [], 'Production meters…');
		await expectFramescaperProductionEntryAbsent(page, framescaper, 'Tools', [], 'Reviewed effects…');
		await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Help', exact: true }).getByRole('menuitem', { name: 'About Framescaper', exact: true })).toBeVisible();
	});

	test('the File menu explains the exact V30 and selected F31 cross-product editing fence', async ({ page }) => {
		await page.goto('/en/');
		const soundscaper = await readyEditor(page, 'soundscaper');
		const soundscaperProjectId = await soundscaper.getAttribute('data-project-id');
		expect(soundscaperProjectId).toBeTruthy();
		await saveProject(page, soundscaper);
		await expect(soundscaper.getByRole('button', { name: 'Edit in Framescaper', exact: true })).toHaveCount(0);

		await soundscaper.getByRole('menuitem', { name: 'File', exact: true }).click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		const editInFramescaper = fileMenu.getByRole('menuitem', { name: /^Edit in Framescaper/u });
		await expect(editInFramescaper).toBeVisible();
		await expect(editInFramescaper).toHaveAttribute('aria-disabled', 'true');
		await expect(editInFramescaper.locator('[data-disabled-reason]'))
			.toHaveAttribute('data-disabled-reason', /Cross-product editing is unavailable/u);
		await page.keyboard.press('Escape');
		await expect(page).toHaveURL((url) => url.pathname === '/en/' && !url.searchParams.has('project'));

		await page.goto('/framescaper/en/');
		const framescaper = await readyEditor(page, 'framescaper');
		const framescaperProjectId = await framescaper.getAttribute('data-project-id');
		expect(framescaperProjectId).toBeTruthy();
		expect(framescaperProjectId).not.toBe(soundscaperProjectId);
		await saveProject(page, framescaper);
		await framescaper.getByRole('menuitem', { name: 'File', exact: true }).click();
		const editInSoundscaper = page.getByRole('menu', { name: 'File', exact: true })
			.getByRole('menuitem', { name: /^Edit in Soundscaper/u });
		await expect(editInSoundscaper).toHaveAttribute('aria-disabled', 'true');
		await expect(editInSoundscaper.locator('[data-disabled-reason]'))
			.toHaveAttribute('data-disabled-reason', /Cross-product editing is unavailable/u);
		await page.keyboard.press('Escape');

		await expect.poll(() => storedProject(page, SOUNDSCAPER_DATABASE_NAME, soundscaperProjectId))
			.toEqual({ id: soundscaperProjectId, schemaVersion: 30 });
		await expect.poll(() => storedProject(page, FRAMESCAPER_DATABASE_NAME, framescaperProjectId))
			.toEqual({ id: framescaperProjectId, schemaVersion: 31 });
		expect(await storedProject(page, SOUNDSCAPER_DATABASE_NAME, framescaperProjectId)).toBeNull();
		expect(await storedProject(page, FRAMESCAPER_DATABASE_NAME, soundscaperProjectId)).toBeNull();

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

async function expectFramescaperProductionEntryAbsent(page, editor, owner, submenus, label) {
	const trigger = editor.getByRole('menuitem', { name: owner, exact: true });
	if (await trigger.count() === 0) {
		await expect(trigger).toHaveCount(0);
		return;
	}
	await trigger.click();
	let menu = page.getByRole('menu', { name: owner, exact: true });
	await expect(menu).toBeVisible();
	for (const submenuLabel of submenus) {
		const item = getMenuItem(menu, submenuLabel);
		await item.focus();
		await page.keyboard.press('ArrowRight');
		menu = item.getByRole('menu');
		await expect(menu).toBeVisible();
	}
	await expect(getMenuItem(menu, label)).toHaveCount(0);
	for (let index = 0; index <= submenus.length; index += 1) await page.keyboard.press('Escape');
}
