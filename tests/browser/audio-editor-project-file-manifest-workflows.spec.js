import { Buffer } from 'node:buffer';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseExportProjectFileAction,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	SOUNDSCAPER_DATABASE_NAME,
	SOUNDSCAPER_OPFS_DIRECTORY_NAME,
} from './helpers/editor-databases.js';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

test.describe('project archive and checksum files', () => {
	registerAudioEditorHooks();

	test('exports, saves checksums, reopens an uppercase suffix and downloads an editable copy', async ({ browserName, page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		const originalProjectId = await editor.getAttribute('data-project-id');

		const archiveDownloadPromise = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const archiveDownload = await archiveDownloadPromise;
		expect(archiveDownload.suggestedFilename()).toMatch(/\.sscape$/u);
		const archive = await downloadBytes(archiveDownload);
		expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		await archiveDownload.delete();

		const checksumDownloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', [
			'Project management',
			'Save archive checksums',
		]);
		const checksumDownload = await checksumDownloadPromise;
		expect(checksumDownload.suggestedFilename()).toMatch(/archive-manifest.*\.json$/u);
		const checksumManifest = JSON.parse(new TextDecoder().decode(await downloadBytes(checksumDownload)));
		expect(checksumManifest).toMatchObject({
			kind: 'archive-manifest',
			manifestVersion: 1,
		});
		expect(checksumManifest.members.map(({ id }) => id)).toEqual(expect.arrayContaining([
			'manifest.json',
			'project.json',
		]));
		expect(checksumManifest.totalByteLength).toBeGreaterThan(toneA.buffer.byteLength);
		await checksumDownload.delete();

		const chooserPromise = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooserPromise).setFiles({
			name: 'ARCHIVE-ROUNDTRIP.SSCAPE',
			mimeType: SCAPE_MIME_TYPE,
			buffer: Buffer.from(archive),
		});
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible({ timeout: 20_000 });
		await collision.getByRole('button', { name: /^Open as (?:read-only )?copy$/u }).click();
		await expect.poll(() => editor.getAttribute('data-project-id'), { timeout: 20_000 })
			.not.toBe(originalProjectId);
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u, { timeout: 20_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 20_000,
		});
		await editor.getByRole('menuitem', { name: 'File', exact: true }).click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		const editInFramescaper = fileMenu.getByRole('menuitem', { name: /^Edit in Framescaper/u });
		await expect(editInFramescaper).toBeEnabled();
		await editInFramescaper.click();
		await expect(page).toHaveURL((url) => url.pathname === '/transfer/send/' && url.searchParams.has('handoff'));
		await expect(page.locator('input[data-transfer-choice]:checked')).toHaveCount(1);
		const editableCopyDownloadPromise = page.waitForEvent(
			'download',
			browserName === 'webkit'
				? undefined
				: (download) => /\.fscape$/u.test(download.suggestedFilename()),
		);
		await page.getByRole('button', { name: 'Download the ticked archives', exact: true }).click();
		const editableCopyDownload = await editableCopyDownloadPromise;
		if (browserName === 'webkit') {
			// Playwright WebKit exposes only one of the two downloads started by
			// this action; accept either the archive or its companion report.
			expect(editableCopyDownload.suggestedFilename())
				.toMatch(/\.fscape(?:\.conversion-report\.json)?$/u);
			expect((await downloadBytes(editableCopyDownload)).byteLength).toBeGreaterThan(0);
		} else {
			expect(editableCopyDownload.suggestedFilename()).toMatch(/\.fscape$/u);
			expect((await downloadBytes(editableCopyDownload)).byteLength).toBeGreaterThan(0);
		}
		await expect(page.getByText(
			'Downloaded 1 of 1 projects. Nothing on this origin was changed.',
			{ exact: true },
		)).toBeVisible({ timeout: 20_000 });
		expect(errors).toEqual([]);
	});

	test('rejects a late corrupt audio body without changing the open project or stored media, then opens a valid copy', async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await importFiles(editor, [toneB]);
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		const tabCount = await editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab').count();

		const downloading = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const download = await downloading;
		const archive = await downloadBytes(download);
		await download.delete();
		const corrupted = await corruptLastAudioAsset(archive);
		const storedBefore = await scapeStorageSnapshot(page);
		expect(storedBefore.storedRows.sources).toHaveLength(2);
		if (storedBefore.storedRows.sources.some(({ value }) => value.storage?.startsWith('opfs'))) {
			expect(storedBefore.opfsFiles?.length).toBeGreaterThanOrEqual(2);
		}

		await openScapeThroughFileMenu(page, editor, corrupted);
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible();
		await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
		await expect(editor.locator('[data-editor-toast="workspace-error"]'))
			.toContainText(`${toneB.name} failed SHA-256 verification.`, { timeout: 20_000 });
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab')).toHaveCount(tabCount);
		expect(await scapeStorageSnapshot(page)).toEqual(storedBefore);

		await openScapeThroughFileMenu(page, editor, archive);
		await expect(collision).toBeVisible();
		await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
		await expect.poll(() => editor.getAttribute('data-project-id'), { timeout: 20_000 }).not.toBe(projectId);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		expect(errors).toEqual([]);
	});
});

async function openScapeThroughFileMenu(page, editor, bytes) {
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({
		name: 'late-audio-asset.sscape',
		mimeType: SCAPE_MIME_TYPE,
		buffer: Buffer.from(bytes),
	});
}

async function corruptLastAudioAsset(archive) {
	const reader = new ZipReader(new BlobReader(new Blob([archive])), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const payloads = new Map();
	for (const entry of entries) payloads.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
	await reader.close();
	const project = JSON.parse(new TextDecoder().decode(payloads.get('project.json')));
	const manifest = JSON.parse(new TextDecoder().decode(payloads.get('manifest.json')));
	const audioSources = project.sources.filter(({ kind }) => kind === 'audio');
	expect(audioSources.map(({ name }) => name)).toEqual([toneA.name, toneB.name]);
	const lateAsset = manifest.assets.find(({ sourceId }) => sourceId === audioSources[1].id);
	expect(lateAsset).toMatchObject({ kind: 'audio', sourceId: audioSources[1].id });
	const body = payloads.get(lateAsset.entry).slice();
	expect(body.byteLength).toBeGreaterThan(4);
	// Flip the low mantissa byte in the last PCM sample. The ZIP and PCM layout
	// stay valid, so import writes the first source and detects this at digest verification.
	body[body.byteLength - 4] ^= 1;
	payloads.set(lateAsset.entry, body);

	const writer = new ZipWriter(new BlobWriter(SCAPE_MIME_TYPE), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	for (const entry of entries) {
		await writer.add(entry.filename, new Uint8ArrayReader(payloads.get(entry.filename)), { level: 0, zip64: true });
	}
	return new Uint8Array(await (await writer.close(undefined, { zip64: true })).arrayBuffer());
}

async function scapeStorageSnapshot(page) {
	return page.evaluate(async ({ databaseName, opfsDirectoryName }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const sha256 = async (bytes) => Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(value) => value.toString(16).padStart(2, '0'),
		).join('');
		const normalize = async (value) => {
			if (value instanceof Blob) return {
				type: value.constructor.name, size: value.size, mimeType: value.type,
				name: value instanceof File ? value.name : null,
				lastModified: value instanceof File ? value.lastModified : null,
				sha256: await sha256(await value.arrayBuffer()),
			};
			if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', sha256: await sha256(value) };
			if (ArrayBuffer.isView(value)) return {
				type: value.constructor.name,
				sha256: await sha256(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
			};
			if (value instanceof Date) return { type: 'Date', value: value.toISOString() };
			if (value instanceof Map) return { type: 'Map', entries: await Promise.all(
				[...value.entries()].map(async ([key, item]) => [await normalize(key), await normalize(item)]),
			) };
			if (value instanceof Set) return { type: 'Set', values: await Promise.all([...value].map(normalize)) };
			if (Array.isArray(value)) return Promise.all(value.map(normalize));
			if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(
				Object.keys(value).sort().map(async (key) => [key, await normalize(value[key])]),
			));
			return value;
		};
		const database = await result(indexedDB.open(databaseName));
		let rows;
		try {
			const names = ['projects', 'sources', 'sourceChunks', 'mediaAssets', 'mediaAssetChunks'];
			const transaction = database.transaction(names, 'readonly');
			rows = Object.fromEntries(await Promise.all(names.map(async (name) => [
				name,
				await Promise.all([
					result(transaction.objectStore(name).getAllKeys()),
					result(transaction.objectStore(name).getAll()),
				]).then(([keys, values]) => keys.map((key, index) => ({ key, value: values[index] }))),
			])));
		} finally {
			database.close();
		}
		const storedRows = await normalize(rows);
		let opfsFiles = null;
		if (typeof navigator.storage?.getDirectory === 'function') {
			const root = await navigator.storage.getDirectory();
			let directory;
			try {
				directory = await root.getDirectoryHandle(opfsDirectoryName);
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
			if (directory && typeof directory.entries === 'function') {
				opfsFiles = [];
				const collect = async (folder, prefix = '') => {
					for await (const [name, handle] of folder.entries()) {
						const path = `${prefix}${name}`;
						if (handle.kind === 'directory') await collect(handle, `${path}/`);
						else {
							const file = await handle.getFile();
							opfsFiles.push({ path, size: file.size, sha256: await sha256(await file.arrayBuffer()) });
						}
					}
				};
				await collect(directory);
				opfsFiles.sort((left, right) => left.path.localeCompare(right.path));
			}
		}
		return { storedRows, opfsFiles };
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, opfsDirectoryName: SOUNDSCAPER_OPFS_DIRECTORY_NAME });
}
