import { readFile } from 'node:fs/promises';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('direct Scape save publication', () => {
	registerAudioEditorHooks();

	test('streams a valid archive to File System Access without a renderer-sized Blob', async ({ page }) => {
		const errors = collectClientErrors(page);
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		const editor = await bootEditor(page, '/embed/en/');
		await page.evaluate(() => {
			globalThis.__scapeDirectSave = {
				aborts: 0,
				chunks: [],
				closes: 0,
				opens: 0,
				pickerOptions: null,
			};
			Object.defineProperty(globalThis, 'showSaveFilePicker', {
				configurable: true,
				value: async (options) => {
					globalThis.__scapeDirectSave.pickerOptions = options;
					return {
						name: 'direct.scape',
						async createWritable() {
							globalThis.__scapeDirectSave.opens += 1;
							return {
								async write(chunk) {
									if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected a byte chunk.');
									globalThis.__scapeDirectSave.chunks.push(chunk.slice());
								},
								async close() { globalThis.__scapeDirectSave.closes += 1; },
								async abort() { globalThis.__scapeDirectSave.aborts += 1; },
							};
						},
					};
				},
			});
		});

		await chooseFileAction(page, editor, 'Export project file (.scape)');
		await expect.poll(() => page.evaluate(() => globalThis.__scapeDirectSave.closes)).toBe(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await page.evaluate(() => ({
			aborts: globalThis.__scapeDirectSave.aborts,
			chunks: globalThis.__scapeDirectSave.chunks.map((chunk) => [...chunk]),
			closes: globalThis.__scapeDirectSave.closes,
			opens: globalThis.__scapeDirectSave.opens,
			pickerOptions: globalThis.__scapeDirectSave.pickerOptions,
		}));
		expect(saved.opens).toBe(1);
		expect(saved.closes).toBe(1);
		expect(saved.aborts).toBe(0);
		expect(downloads).toBe(0);
		expect(saved.chunks.length).toBeGreaterThan(0);
		expect(Math.max(...saved.chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(saved.pickerOptions.types[0].accept['application/vnd.soundscaper.scape+zip']).toEqual(['.scape']);

		const archive = Buffer.concat(saved.chunks.map((chunk) => Buffer.from(chunk)));
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'direct.scape',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			buffer: archive,
		});
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible();
		await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		expect(errors).toEqual([]);
	});

	test('retains the bounded browser-download fallback when File System Access is unavailable', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		const downloading = page.waitForEvent('download');
		await chooseFileAction(page, editor, 'Export project file (.scape)');
		const download = await downloading;
		expect(download.suggestedFilename()).toMatch(/\.scape$/iu);
		const path = await download.path();
		expect(path).toBeTruthy();
		const archive = await readFile(path);
		expect(archive.byteLength).toBeGreaterThan(0);
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'fallback.scape',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			buffer: archive,
		});
		await expect(page.getByRole('dialog', { name: 'Project already exists', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
});
