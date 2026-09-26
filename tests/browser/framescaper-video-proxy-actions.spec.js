/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseFileAction,
	collectClientErrors,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import {
	createDeterministicAvFixture,
	createDeterministicSilentVideoFixture,
} from './fixtures/deterministic-av-media.js';

test('publishes, cancels, verifies, and regenerates an existing video proxy', async ({ page }) => {
	test.setTimeout(120_000);
	const clientErrors = collectClientErrors(page);
	const original = createDeterministicAvFixture('proxy-actions-original.webm');
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installPersistentStorageStub(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(original);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', {
		timeout: 30_000,
	});
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 20_000,
	});
	const card = editor.locator('[data-project-bin-item]').first();
	await card.getByRole('button', { name: /More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Video proxies…', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await expect(dialog).toBeVisible();
	await expect(proxyStatus(dialog)).toContainText('No proxy is attached.');

	const chooserPromise = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles({ ...original, name: 'proxy-actions-existing.webm' });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('Proxy work cancelled.', { timeout: 30_000 });
	await expect(proxyStatus(dialog)).toContainText('No proxy is attached.');

	const retryChooserPromise = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
	const retryChooser = await retryChooserPromise;
	await retryChooser.setFiles({ ...original, name: 'proxy-actions-existing.webm' });
	await expect(proxyFeedback(dialog)).toContainText('Existing proxy validated and attached.', {
		timeout: 30_000,
	});
	await expect(proxyStatus(dialog)).toContainText(
		'A proxy attachment is present but has not been verified for this preview session.',
	);
	const previewMode = dialog.getByRole('combobox', { name: 'Preview media', exact: true });
	await previewMode.selectOption('proxy');
	await expect(proxyFeedback(dialog)).toContainText('Preview mode updated and proxy trust refreshed.');
	await expect(proxyStatus(dialog)).toContainText(
		'The attached proxy bodies and timing are verified for this session.',
	);
	await expect(dialog.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Detach', exact: true })).toBeVisible();

	await dialog.getByRole('button', { name: 'Regenerate', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('This runtime cannot generate captured video proxies.', {
		timeout: 30_000,
	});
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	expect(clientErrors).toEqual([]);
});

test('desktop-linked video proxy relinks exact and refuses changed attributed originals', async ({ page }) => {
	test.setTimeout(120_000);
	const clientErrors = collectClientErrors(page);
	const original = createDeterministicSilentVideoFixture('linked-proxy-original.webm');
	const changed = {
		...original,
		name: 'linked-proxy-changed.webm',
		buffer: Buffer.concat([original.buffer, Buffer.from([0])]),
	};
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installPersistentStorageStub(page);
	await installDesktopLinkedVideoFixture(page, { original, changed });

	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.getByRole('button', { name: 'Link video', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible({ timeout: 30_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', {
		timeout: 30_000,
	});
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 20_000,
	});
	await openProxyDialog(page, card);
	const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await expect(dialog.getByRole('button', { name: 'Relink original', exact: true })).toBeVisible();

	await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('Existing proxy validated and attached.', {
		timeout: 30_000,
	});
	await expect(proxyStatus(dialog)).toContainText(
		'A proxy attachment is present but has not been verified for this preview session.',
	);

	await selectDesktopLinkedVideoChoice(page, 'exact');
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('Original video relinked.', { timeout: 30_000 });
	await expect(dialog.getByRole('button', { name: 'Detach', exact: true })).toBeVisible();

	await selectDesktopLinkedVideoChoice(page, 'changed');
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText(
		'Import the selected file as new media to preserve attribution; changed-content relink is unavailable for an attributed source.',
	);
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Detach', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Detach', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('Proxy detached.', { timeout: 30_000 });
	await expect(proxyStatus(dialog)).toContainText('No proxy is attached.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	expect(clientErrors).toEqual([]);
});

test('verified proxy previews an offline linked original but video delivery waits for exact relink', async ({ page }) => {
	test.setTimeout(120_000);
	const original = createDeterministicSilentVideoFixture('offline-proxy-original.webm');
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installPersistentStorageStub(page);
	await installDesktopLinkedVideoFixture(page, { original, changed: original });

	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.getByRole('button', { name: 'Link video', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible({ timeout: 30_000 });
	await card.getByRole('button', { name: /Add to timeline:/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 20_000,
	});
	await openProxyDialog(page, card);
	let dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('Existing proxy validated and attached.', {
		timeout: 30_000,
	});
	await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('proxy');
	await expect(proxyStatus(dialog)).toContainText(
		'The attached proxy bodies and timing are verified for this session.',
	);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const previewClip = editor.locator('[data-video-preview-clip]');
	await expect(previewClip).toHaveCount(1, { timeout: 30_000 });
	await expect(previewClip).toHaveAttribute('src', /^blob:/u);
	await expect.poll(() => previewClip.evaluate((video) => video.readyState)).toBeGreaterThan(1);

	await page.evaluate(() => {
		globalThis.__videoProxyDesktopFixture.offline = true;
		globalThis.__videoProxyDesktopFixture.loads.length = 0;
	});
	await openProxyDialog(page, card);
	dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('original');
	await expect(proxyFeedback(dialog)).toContainText('The linked video original is unavailable or changed.');
	await expect(dialog.getByRole('combobox', { name: 'Preview media', exact: true })).toHaveValue('proxy');
	await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('auto');
	await expect(proxyFeedback(dialog)).toContainText('Preview mode updated and proxy trust refreshed.');
	await expect(proxyStatus(dialog)).toContainText(
		'The attached proxy bodies and timing are verified for this session.',
	);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Hide video', exact: true }).click();
	await expect(previewClip).toHaveCount(0);
	await editor.getByRole('button', { name: 'Show video', exact: true }).click();
	await expect(previewClip).toHaveCount(1, { timeout: 30_000 });
	await expect(previewClip).toHaveAttribute('src', /^blob:/u);
	await expect.poll(() => previewClip.evaluate((video) => video.readyState)).toBeGreaterThan(1);
	const offlineLoads = await page.evaluate(() => globalThis.__videoProxyDesktopFixture.loads);
	expect(offlineLoads).toEqual(expect.arrayContaining([
		expect.objectContaining({ locatorId: '1'.repeat(64), playback: false }),
	]));

	await chooseFileAction(page, editor, 'Export video');
	const exportDialog = page.getByRole('dialog', { name: 'Export video', exact: true });
	await selectSmallMp4Export(page, exportDialog);
	const start = exportDialog.locator('[data-export-action="start"]').getByRole('button');
	await expect(start).toBeEnabled();
	await start.click();
	await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]'))
		.toContainText(
			'The linked video original is unavailable or changed.',
			{ timeout: 30_000 },
		);
	await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
	await expect.poll(() => page.evaluate(() => globalThis.__videoProxyDesktopFixture.saveSessionOpened)).toBe(0);
	await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.locator('[data-editor-toast="workspace-status-error"]')
		.getByRole('button', { name: 'Close', exact: true }).click();

	await openProxyDialog(page, card);
	dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await selectDesktopLinkedVideoChoice(page, 'exact');
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect(proxyFeedback(dialog)).toContainText('Original video relinked.', { timeout: 30_000 });
	const exactLoadsBeforeRefresh = await page.evaluate(() => globalThis.__videoProxyDesktopFixture.loads.filter(
		({ locatorId, playback }) => locatorId === '2'.repeat(64) && playback === false,
	).length);
	await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('proxy');
	await expect(proxyFeedback(dialog)).toContainText('Preview mode updated and proxy trust refreshed.');
	await expect(proxyStatus(dialog)).toContainText(
		'The attached proxy bodies and timing are verified for this session.',
	);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__videoProxyDesktopFixture.loads.filter(
		({ locatorId, playback }) => locatorId === '2'.repeat(64) && playback === false,
	).length)).toBeGreaterThan(exactLoadsBeforeRefresh);
});

async function selectSmallMp4Export(page, dialog) {
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
	const canvasSize = dialog.locator('[data-export-field="canvasSize"] input');
	await canvasSize.nth(0).fill('64');
	await canvasSize.nth(1).fill('64');
	await dialog.locator('[data-export-field="canvasFrameRate"] input').fill('1');
}

async function installPersistentStorageStub(page) {
	await page.addInitScript(() => {
		const storage = navigator.storage ?? {};
		Object.defineProperty(storage, 'persisted', {
			configurable: true,
			value: () => Promise.resolve(true),
		});
		Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
	});
}

async function installDesktopLinkedVideoFixture(page, { original, changed }) {
	const files = {
		initial: desktopFixtureFile(original, '1', 'a', 'd'),
		exact: desktopFixtureFile({ ...original, name: 'linked-proxy-exact.webm' }, '2', 'b', 'e'),
		changed: desktopFixtureFile(changed, '3', 'c', 'f'),
		proxy: desktopFixtureFile({ ...original, name: 'linked-existing-proxy.webm' }, '4', 'a', '9'),
	};
	const filesByKey = Object.fromEntries(Object.values(files).map((file) => [file.key, file]));
	await page.route('**/__e2e-video-proxy-file/*', async (route) => {
		const key = new URL(route.request().url()).pathname.split('/').at(-1);
		const file = filesByKey[key];
		if (!file) return route.abort();
		return route.fulfill({
			body: Buffer.from(file.base64, 'base64'),
			contentType: file.mimeType,
			headers: { 'Content-Length': String(file.size) },
		});
	});
	await page.addInitScript((records) => {
		const filesByKey = Object.fromEntries(records.map((record) => [record.key, record]));
		const filesByLocator = Object.fromEntries(records.map((record) => [record.locatorId, record]));
		const state = { choice: '1', choices: 0, loads: [], offline: false, saveSessionOpened: 0 };
		const descriptor = (record) => ({
			id: record.readId,
			readProfile: 'materialized-v1',
			url: `${location.origin}/__e2e-video-proxy-file/${record.key}`,
			name: record.name,
			size: record.size,
			mimeType: record.mimeType,
			lastModified: 123,
		});
		const choice = (record) => ({
			locatorId: record.locatorId,
			locatorRevision: record.locatorRevision,
			name: record.name,
			size: record.size,
			mimeType: record.mimeType,
			lastModified: 123,
		});
		const bridge = Object.freeze({
			chooseLinkedVideoOriginal: async () => {
				state.choices += 1;
				return choice(filesByKey[state.choice]);
			},
			loadLinkedVideoOriginal: async (request) => {
				state.loads.push(structuredClone(request));
				if (request.playback) return null;
				if (state.offline && request.locatorId === filesByKey['1'].locatorId) return null;
				const record = filesByLocator[request.locatorId];
				if (!record) return null;
				return { locatorRevision: record.locatorRevision, descriptor: descriptor(record) };
			},
			reconcileLinkedVideoOriginals: async () => 0,
			releaseLinkedVideoOriginal: async () => true,
			chooseFiles: async (request) => request.purpose === 'video'
				? [descriptor(filesByKey['4'])] : [],
			getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg', reason: null },
				webm: { available: true, provider: 'external-ffmpeg', reason: null },
			} }),
			chooseSaveTarget: async (request) => ({ id: 'proxy-export-target', name: request.suggestedName }),
			beginWrite: async () => {
				state.saveSessionOpened += 1;
				throw new Error('Video delivery reached encoding without its original.');
			},
			writeChunk: async () => { throw new Error('Unexpected video output chunk.'); },
			finishWrite: async () => { throw new Error('Unexpected video output commit.'); },
		});
		Object.defineProperty(globalThis, '__videoProxyDesktopFixture', {
			configurable: true,
			value: state,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: bridge }),
		});
	}, Object.values(files));
}

function desktopFixtureFile(file, locatorDigit, revisionDigit, readDigit) {
	return {
		key: locatorDigit,
		name: file.name,
		mimeType: file.mimeType,
		base64: file.buffer.toString('base64'),
		size: file.buffer.byteLength,
		locatorId: locatorDigit.repeat(64),
		locatorRevision: revisionDigit.repeat(64),
		readId: readDigit.repeat(64),
	};
}

async function selectDesktopLinkedVideoChoice(page, choice) {
	await page.evaluate((next) => {
		globalThis.__videoProxyDesktopFixture.choice = { initial: '1', exact: '2', changed: '3' }[next];
	}, choice);
}

async function openProxyDialog(page, card) {
	await card.getByRole('button', { name: /More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Video proxies…', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Video proxies', exact: true })).toBeVisible();
}

function proxyStatus(dialog) {
	return dialog.getByRole('region', { name: 'Proxy status', exact: true });
}

function proxyFeedback(dialog) {
	return dialog.locator('.audio-editor-video-proxy > [role="status"]').last();
}
