import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
	BlobReader,
	Uint8ArrayWriter,
	ZipReader,
} from '@zip.js/zip.js';

import {
	expect,
	test,
	toneA,
	TRANSLATIONS_ROOT,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	trackNameText,
} from './audio-editor-test-helpers.js';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const PRODUCT_PATHS = {
	soundscaper: '/embed/en/',
	framescaper: '/framescaper/embed/en/',
};

const WORKFLOWS = [{
	id: 'web-soundscaper-to-framescaper-to-soundscaper-scape',
	origin: 'soundscaper',
	recipient: 'framescaper',
}, {
	id: 'web-framescaper-to-soundscaper-to-framescaper-scape',
	origin: 'framescaper',
	recipient: 'soundscaper',
}];

test.describe('cross-product Scape handoff roundtrips', () => {
	registerAudioEditorHooks();

	for (const workflow of WORKFLOWS) {
		test(workflow.id, async ({ browser, page }) => {
			test.setTimeout(120_000);
			await disableDirectScapeSave(page);
			const origin = await bootEditor(page, PRODUCT_PATHS[workflow.origin]);
			const originErrors = collectClientErrors(page);
			await expect(origin).toHaveAttribute('data-product', workflow.origin);
			const video = await createGeneratedVideoFixture(page, `${workflow.id}.webm`);
			await importFiles(origin, [toneA, video]);
			await expect(clipByName(origin, toneA.name)).toBeVisible();
			await expect(origin.locator('[data-clip-kind="video"]')).toHaveCount(1);
			await expect(origin.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 10_000,
			});

			const projectId = await origin.getAttribute('data-project-id');
			expect(projectId).toBeTruthy();
			const outboundArchive = await exportScapeArchive(page, origin);
			const outbound = await inspectScapeArchive(outboundArchive);
			expect(outbound.projectId).toBe(projectId);
			expect([...new Set(outbound.assets.map(({ kind }) => kind))].sort()).toEqual(['audio', 'video']);

			const baseURL = new URL(page.url()).origin;
			const openedRuntimes = [];
			try {
				const recipientRuntime = await openProductRuntime(browser, baseURL, workflow.recipient);
				openedRuntimes.push(recipientRuntime);
				const recipientErrors = collectClientErrors(recipientRuntime.page);
				await openScapeArchive(recipientRuntime.editor, outboundArchive, `${workflow.id}-outbound.scape`);
				await assertActivatedMixedMediaProject(recipientRuntime.editor, workflow.recipient, projectId, video.name);
				await assertPlayback(recipientRuntime.editor);

				const editedTrackName = `${workflow.recipient} handoff edit`;
				await renameFirstTrack(recipientRuntime.editor, editedTrackName);
				await expect(recipientRuntime.editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
				await chooseFileAction(recipientRuntime.page, recipientRuntime.editor, 'Save project');
				await expect(recipientRuntime.editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

				const returningArchive = await exportScapeArchive(recipientRuntime.page, recipientRuntime.editor);
				const returning = await inspectScapeArchive(returningArchive);
				expect(returning.projectId).toBe(projectId);
				expect(returning.assets).toEqual(outbound.assets);

				const homeRuntime = await openProductRuntime(browser, baseURL, workflow.origin);
				openedRuntimes.push(homeRuntime);
				const homeErrors = collectClientErrors(homeRuntime.page);
				await openScapeArchive(homeRuntime.editor, returningArchive, `${workflow.id}-return.scape`);
				await assertActivatedMixedMediaProject(homeRuntime.editor, workflow.origin, projectId, video.name);
				await expect(trackNameText(homeRuntime.editor).filter({ hasText: editedTrackName })).toHaveCount(1);
				await assertPlayback(homeRuntime.editor);

				expect(originErrors).toEqual([]);
				expect(recipientErrors).toEqual([]);
				expect(homeErrors).toEqual([]);
			} finally {
				for (const runtime of openedRuntimes.reverse()) {
					if (!runtime.page.isClosed()) await runtime.page.close({ runBeforeUnload: false });
				}
			}
		});
	}
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

async function exportScapeArchive(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/\.scape$/iu);
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

async function assertActivatedMixedMediaProject(editor, productId, projectId, videoName) {
	const videoTitle = videoName.replace(/\.webm$/iu, '');
	await expect(editor).toHaveAttribute('data-product', productId);
	await expect(editor).toHaveAttribute('data-project-id', projectId, { timeout: 20_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await expect(editor.getByRole('group', { name: `Video clip: ${videoTitle}`, exact: true })).toBeVisible();
	await expect(editor.locator('[data-clip-kind="video"]')).toHaveCount(1);
}

async function assertPlayback(editor) {
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

async function renameFirstTrack(editor, name) {
	const closeVideoPreview = editor.getByRole('button', { name: 'Close: Video preview', exact: true });
	if (await closeVideoPreview.isVisible()) await closeVideoPreview.click();
	const label = trackNameText(editor).first();
	await label.dblclick();
	const input = editor.locator('[data-track-name] input');
	await expect(input).toBeFocused();
	await input.fill(name);
	await input.press('Enter');
	await expect(label).toHaveText(name);
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
			projectId: project.id,
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

async function createGeneratedVideoFixture(page, name) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 54;
		const drawing = canvas.getContext('2d');
		const stream = canvas.captureStream(15);
		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
			? 'video/webm;codecs=vp8'
			: 'video/webm';
		const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 120_000 });
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < 8; frame += 1) {
			drawing.fillStyle = '#1d4ed8';
			drawing.fillRect(0, 0, canvas.width, canvas.height);
			drawing.fillStyle = '#fbbf24';
			drawing.fillRect(frame * 10, 20, 18, 14);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	});
	return { name, mimeType: 'video/webm', buffer: Buffer.from(base64, 'base64') };
}
