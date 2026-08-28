import { expect, test } from '@playwright/test';

import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const DATABASE_VERSION = 1;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';

test.describe('dedicated OPFS storage worker', () => {
	test.beforeEach(async ({ context, page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
		await context.addInitScript(() => {
			globalThis.__opfsMainThreadFallbacks = { createWritable: 0, getFile: 0 };
			const prototype = globalThis.FileSystemFileHandle?.prototype;
			if (!prototype) return;
			Object.defineProperty(prototype, 'createWritable', {
				configurable: true,
				value() {
					globalThis.__opfsMainThreadFallbacks.createWritable += 1;
					throw new Error('Main-thread OPFS writes are disabled by the worker-boundary witness.');
				},
			});
			Object.defineProperty(prototype, 'getFile', {
				configurable: true,
				value() {
					globalThis.__opfsMainThreadFallbacks.getFile += 1;
					throw new Error('Main-thread OPFS reads are disabled by the worker-boundary witness.');
				},
			});
		});
	});

	test('opfs-multitab-writer persists media and transfers one project writer', async ({ context, page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(90_000);
		const workerRequests = [];
		page.on('request', (request) => {
			if (request.url().includes('opfs-sync-worker')) workerRequests.push(request.url());
		});
		await page.goto('/framescaper/en/');
		let editor = await waitForVideoEditor(page);
		const fixture = createDeterministicAvFixture('opfs-worker-video.webm');
		await importVideo(editor, fixture);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
		await expectPersistedPreviewClip(page, editor);

		const inventory = await persistedOpfsInventory(page, fixture.name);
		expect(inventory.sourceStorage).toBe('opfs-pcm-v1');
		expect(inventory.mediaStorage).toBe('opfs');
		expect(inventory.derivativeCount).toBeGreaterThan(0);
		expect(inventory.derivativeStorage).toEqual(['opfs']);
		expect(await mainThreadFallbacks(page)).toEqual({ createWritable: 0, getFile: 0 });
		expect(workerRequests.length).toBeGreaterThan(0);

		await page.reload();
		editor = await waitForVideoEditor(page);
		await expectPersistedPreviewClip(page, editor);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await page.waitForTimeout(150);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(await mainThreadFallbacks(page)).toEqual({ createWritable: 0, getFile: 0 });

		const secondPage = await context.newPage();
		await secondPage.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
		await secondPage.goto('/framescaper/en/');
		const second = await waitForVideoEditor(secondPage);
		await expectPersistedPreviewClip(secondPage, second);
		const firstAddTrack = editor.getByRole('button', { name: 'Add track', exact: true });
		const secondAddTrack = second.getByRole('button', { name: 'Add track', exact: true });
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only', { timeout: 5_000 });
		const firstTrackCount = await editor.getAttribute('data-track-count');
		await firstAddTrack.click();
		await expect(editor).toHaveAttribute('data-track-count', firstTrackCount);
		await expect(second).not.toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(secondAddTrack).toBeEnabled();
		await secondPage.close();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only', { timeout: 5_000 });
		await expect(firstAddTrack).toBeEnabled();
	});
});

/**
 * The evidence this test wants from the preview is that the persisted media came back as a
 * clip, not that it painted. A raw contain-fit video is never a valid stand-in for a
 * canonical render description, so the panel deliberately hides the element wherever the
 * WebGL2 compositor cannot start - which is how CI's Firefox runner is configured.
 */
async function expectPersistedPreviewClip(page, editor) {
	const clip = editor.locator('[data-video-preview-clip]');
	await expect(clip).toHaveCount(1);
	if (await page.evaluate(hasWebGl2Capability)) await expect(clip).toBeVisible();
	else await expect(clip).toHaveAttribute('data-identity-fallback-hidden', 'true');
}

async function waitForVideoEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible({ timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	return editor;
}

async function importVideo(editor, fixture) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.locator('[data-import-input]').setInputFiles(fixture);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
}

async function persistedOpfsInventory(page, sourceName) {
	return page.evaluate(async ({ databaseName, databaseVersion, name }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName, databaseVersion));
		try {
			const transaction = database.transaction(['sources', 'mediaAssets', 'videoDerivatives'], 'readonly');
			const [sources, media, derivatives] = await Promise.all([
				request(transaction.objectStore('sources').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('videoDerivatives').getAll()),
			]);
			const source = sources.find((candidate) => candidate.mimeType === 'audio/x-soundscaper-extracted');
			const mediaRecord = media.find((candidate) => candidate.name === name);
			const related = derivatives.filter((candidate) => candidate.sourceId === mediaRecord?.sourceId);
			return {
				sourceStorage: source?.storage ?? null,
				mediaStorage: mediaRecord?.storage ?? null,
				derivativeCount: related.length,
				derivativeStorage: [...new Set(related.map((candidate) => candidate.storage))].sort(),
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, databaseVersion: DATABASE_VERSION, name: sourceName });
}

function mainThreadFallbacks(page) {
	return page.evaluate(() => globalThis.__opfsMainThreadFallbacks);
}
