/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel,
	collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

async function storedFreezes(page) {
	return page.evaluate(async databaseName => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const records = await result(database.transaction(['mediaAssets'], 'readonly').objectStore('mediaAssets').getAll());
			return records.filter(({ name }) => name.includes('Freeze')).map(({ sourceId }) => sourceId).sort();
		} finally { database.close(); }
	}, FRAMESCAPER_DATABASE_NAME);
}

test('a refused late Freeze releases only its unpublished saved PNG after ordinary Close and Seek', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze requires WebGL2.');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Freeze requires IndexedDB Blob storage.');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const properties = editor.locator('[data-workspace-panel="metadata"]');
	await properties.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await properties.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await closeWorkspacePanel(editor, 'metadata');
	const fixture = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
	await importFiles(editor, [{ name: 'camera.mp4', mimeType: fixture.file.mimeType, buffer: Buffer.from(fixture.file.buffer) }]);
	const camera = editor.getByRole('group', { name: 'Video clip: camera', exact: true });
	await camera.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:10');
	const openFreeze = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video']);
		return page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
	};
	let dialog = await openFreeze();
	await dialog.locator('[data-framescaper-authoring-freeze]').click();
	await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.');
	await dialog.press('Escape');
	await expect(editor.getByRole('group', { name: 'Video clip: camera.mp4 Freeze', exact: true })).toHaveCount(1);
	const healthySaved = await storedFreezes(page);
	expect(healthySaved).toHaveLength(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.getByRole('group', { name: 'Video clip: camera.mp4 Freeze', exact: true })).toHaveCount(0);
	expect(await storedFreezes(page)).toEqual(healthySaved);
	await camera.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:10');
	await page.evaluate(() => {
		const encode = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
			HTMLCanvasElement.prototype.toBlob = encode;
			encode.call(this, blob => {
				window.__round7FreezeHeld = true;
				window.__round7ReleaseFreeze = () => callback(blob);
			}, type, quality);
		};
	});
	try {
		dialog = await openFreeze();
		await dialog.locator('[data-framescaper-authoring-freeze]').click();
		await expect.poll(() => page.evaluate(() => window.__round7FreezeHeld)).toBe(true);
		await dialog.press('Escape');
		await expect(dialog).toHaveCount(0);
		await seekFramescaperTimecode(page, editor, '00:00:00:11');
		await page.evaluate(() => window.__round7ReleaseFreeze());
		await expect(editor.getByRole('alert')).toContainText('playhead is stale');
		await expect(editor.getByRole('group', { name: 'Video clip: camera.mp4 Freeze', exact: true })).toHaveCount(0);
		expect(await storedFreezes(page)).toEqual(healthySaved);
		expect(errors).toEqual([]);
	} finally {
		await page.evaluate(() => { window.__round7ReleaseFreeze?.(); });
	}
});
