import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
	BlobReader,
	Uint8ArrayWriter,
	ZipReader,
} from '@zip.js/zip.js';

import {
	PROJECT_SCHEMA_VERSION,
} from '../../src/common/editor/project-schema-identity.ts';
import {
	expect,
	test,
	toneA,
	TRANSLATIONS_ROOT,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseExportProjectFileAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const PRODUCT_PATHS = {
	soundscaper: '/embed/en/',
	framescaper: '/framescaper/embed/en/',
};

test.describe('exact selected-schema cross-product Scape handoffs', () => {
	registerAudioEditorHooks();

	test('Framescaper v1 holds Soundscaper v1 opaquely without damaging its archive', async ({ browser, page }) => {
		await disableDirectScapeSave(page);
		const originErrors = collectClientErrors(page);
		const origin = await bootEditor(page, PRODUCT_PATHS.soundscaper);
		await importFiles(origin, [toneA]);
		await expect(clipByName(origin, toneA.name)).toBeVisible();
		const projectId = await origin.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const outboundArchive = await exportScapeArchive(page, origin, 'soundscaper');
		const outbound = await inspectScapeArchive(outboundArchive);
		expect(outbound.project.id).toBe(projectId);
		expect(outbound.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

		const baseURL = new URL(page.url()).origin;
		const openedRuntimes = [];
		try {
			const recipient = await openProductRuntime(browser, baseURL, 'framescaper');
			openedRuntimes.push(recipient);
			const recipientErrors = collectClientErrors(recipient.page);
			await openScapeArchive(recipient.editor, outboundArchive, 'soundscaper-v30-outbound.sscape');
			await expect(recipient.editor.locator('[data-status]')).toHaveAttribute('data-state', 'error', {
				timeout: 20_000,
			});
			await expect(recipient.editor.locator('[data-status]')).toHaveText('This project is read-only.');
			await expect(recipient.editor).toHaveAttribute('data-project-id', projectId);
			await expect(recipient.editor).toHaveAttribute('data-edit-block-reason', 'read-only');
			await expect(clipByName(recipient.editor, toneA.name)).toHaveCount(0);
			await expect(recipient.page.getByRole('dialog', { name: 'Project features unavailable' }))
				.toHaveCount(0);

			const home = await openProductRuntime(browser, baseURL, 'soundscaper');
			openedRuntimes.push(home);
			const homeErrors = collectClientErrors(home.page);
			await openScapeArchive(home.editor, outboundArchive, 'soundscaper-v30-return.sscape');
			await expect(home.editor).toHaveAttribute('data-project-id', projectId, { timeout: 20_000 });
			await expect(home.editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
			await expect(clipByName(home.editor, toneA.name)).toBeVisible();
			await assertPlayback(home.editor);

			expect(originErrors).toEqual([]);
			expect(recipientErrors).toEqual([]);
			expect(homeErrors).toEqual([]);
		} finally {
			for (const runtime of openedRuntimes.reverse()) {
				if (!runtime.page.isClosed()) await runtime.page.close({ runBeforeUnload: false });
			}
		}
	});

	test('Soundscaper v1 holds Framescaper v1 opaquely without damaging its archive', async ({ browser, page }) => {
		await disableDirectScapeSave(page);
		const originErrors = collectClientErrors(page);
		const origin = await bootEditor(page, PRODUCT_PATHS.framescaper);
		await importFiles(origin, [toneA]);
		const projectId = await origin.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const outboundArchive = await exportScapeArchive(page, origin, 'framescaper');
		const outbound = await inspectScapeArchive(outboundArchive);
		expect(outbound.project.id).toBe(projectId);
		expect(outbound.project.schemaFamily).toBe('framescaper');
		expect(outbound.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

		const baseURL = new URL(page.url()).origin;
		const openedRuntimes = [];
		try {
			const recipient = await openProductRuntime(browser, baseURL, 'soundscaper');
			openedRuntimes.push(recipient);
			const recipientErrors = collectClientErrors(recipient.page);
			await openScapeArchive(recipient.editor, outboundArchive, 'framescaper-v1-outbound.fscape');
			await expect(recipient.editor.locator('[data-status]')).toHaveAttribute('data-state', 'error', {
				timeout: 20_000,
			});
			await expect(recipient.editor.locator('[data-status]')).toHaveText('This project is read-only.');
			await expect(recipient.editor).toHaveAttribute('data-project-id', projectId);
			await expect(recipient.editor).toHaveAttribute('data-edit-block-reason', 'read-only');
			await expect(clipByName(recipient.editor, toneA.name)).toHaveCount(0);
			await expect(recipient.page.getByRole('dialog', { name: 'Project features unavailable' }))
				.toHaveCount(0);

			const home = await openProductRuntime(browser, baseURL, 'framescaper');
			openedRuntimes.push(home);
			const homeErrors = collectClientErrors(home.page);
			await openScapeArchive(home.editor, outboundArchive, 'framescaper-v1-home.fscape');
			await expect(home.editor).toHaveAttribute('data-project-id', projectId, { timeout: 20_000 });
			await expect(home.editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
			await expect(clipByName(home.editor, toneA.name)).toBeVisible();
			await assertPlayback(home.editor);

			expect(originErrors).toEqual([]);
			expect(recipientErrors).toEqual([]);
			expect(homeErrors).toEqual([]);
		} finally {
			for (const runtime of openedRuntimes.reverse()) {
				if (!runtime.page.isClosed()) await runtime.page.close({ runBeforeUnload: false });
			}
		}
	});

	test('a reserved Lightscaper suffix and the legacy one open in both products', async ({ browser, page }) => {
		await disableDirectScapeSave(page);
		const origin = await bootEditor(page, PRODUCT_PATHS.soundscaper);
		await importFiles(origin, [toneA]);
		await expect(clipByName(origin, toneA.name)).toBeVisible();
		const projectId = await origin.getAttribute('data-project-id');
		const archive = await exportScapeArchive(page, origin, 'soundscaper');

		const baseURL = new URL(page.url()).origin;
		const openedRuntimes = [];
		try {
			// The suffix is only a routing hint, so a Scape archive under the
			// reserved `.liscape` and under the retired `.scape` is admitted the
			// same way the product's own suffix is.
			for (const [productId, name] of [
				['soundscaper', 'reserved.liscape'],
				['framescaper', 'legacy.SCAPE'],
			]) {
				const runtime = await openProductRuntime(browser, baseURL, productId);
				openedRuntimes.push(runtime);
				const errors = collectClientErrors(runtime.page);
				await openScapeArchive(runtime.editor, archive, name);
				await expect(runtime.editor).toHaveAttribute('data-project-id', projectId, { timeout: 20_000 });
				expect(errors).toEqual([]);
			}
		} finally {
			for (const runtime of openedRuntimes.reverse()) {
				if (!runtime.page.isClosed()) await runtime.page.close({ runBeforeUnload: false });
			}
		}
	});
});

async function openProductRuntime(browser, baseURL, productId) {
	const page = await browser.newPage({ baseURL, serviceWorkers: 'block' });
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
	await disableDirectScapeSave(page);
	const editor = await bootEditor(page, PRODUCT_PATHS[productId]);
	return { editor, page };
}

async function disableDirectScapeSave(page) {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
		configurable: true,
		value: undefined,
	}));
}

async function exportScapeArchive(page, editor, productId) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	// The fallback download always carries the saving product's own suffix.
	expect(download.suggestedFilename())
		.toMatch(productId === 'framescaper' ? /\.fscape$/u : /\.sscape$/u);
	const path = await download.path();
	expect(path).toBeTruthy();
	const archive = await readFile(path);
	await download.delete();
	return archive;
}

async function openScapeArchive(editor, archive, name) {
	await editor.locator('[data-aup4-input]').setInputFiles({
		name,
		mimeType: SCAPE_MIME_TYPE,
		buffer: archive,
	});
}

async function assertPlayback(editor) {
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
}

async function inspectScapeArchive(archive) {
	const reader = new ZipReader(new BlobReader(new Blob([archive])), { useWebWorkers: false });
	try {
		const entries = await reader.getEntries();
		const byName = new Map(entries.map((entry) => [entry.filename, entry]));
		const project = JSON.parse(new TextDecoder().decode(await readZipEntry(byName, 'project.json')));
		const manifest = JSON.parse(new TextDecoder().decode(await readZipEntry(byName, 'manifest.json')));
		const assets = [];
		for (const asset of manifest.assets) {
			const body = await readZipEntry(byName, asset.entry);
			expect(body.byteLength).toBe(asset.size);
			expect(createHash('sha256').update(body).digest('hex')).toBe(asset.sha256);
			assets.push({
				kind: asset.kind,
				sha256: asset.sha256,
				size: asset.size,
				sourceId: asset.sourceId,
			});
		}
		return {
			project,
			assets: assets.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
		};
	} finally {
		await reader.close();
	}
}

async function readZipEntry(entries, name) {
	const entry = entries.get(name);
	if (!entry || entry.directory) throw new Error(`Missing Scape archive entry ${name}.`);
	return entry.getData(new Uint8ArrayWriter());
}
