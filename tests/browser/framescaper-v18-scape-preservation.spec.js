/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	BlobReader,
	Uint8ArrayWriter,
	ZipReader,
} from '@zip.js/zip.js';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	collectClientErrors,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import {
	framescaperV18Format2Expectation as expectedArchive,
	framescaperV18Format2Scape as fixedArchive,
} from './fixtures/framescaper-v18-format2-scape.js';

test.describe('Framescaper V18 format-2 Scape preservation', () => {
	registerAudioEditorHooks();

	test('cancels metadata-only, opens read-only, and exports an exact copy', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		const originalProjectId = await editor.getAttribute('data-project-id');
		const input = editor.locator('[data-aup4-input]');

		await input.setInputFiles(fixedArchive);
		const decision = page.getByRole('dialog', {
			name: 'Project features unavailable',
			exact: true,
		});
		await expect(decision).toHaveAttribute('data-scape-open-decision', 'compatibility');
		await expect(decision).toHaveAccessibleDescription(/Framescaper archive.*read-only/iu);
		await expect(decision.getByText('Video proxy attachments', { exact: true })).toBeVisible();
		await expect(decision.getByText(/Unavailable.*Bypass declared/iu)).toBeVisible();
		await decision.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', originalProjectId);
		await expect(editor.getByRole('tab', { name: expectedArchive.projectTitle, exact: true })).toHaveCount(0);

		await input.setInputFiles([]);
		await input.setInputFiles(fixedArchive);
		await expect(decision).toBeVisible();
		await decision.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', expectedArchive.projectId, { timeout: 20_000 });
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(editor.locator(
			'[data-project-feature-requirement="org.soundscaper.capability.video-proxy"]',
		)).toContainText('Unavailable · Bypass declared');
		await expect(editor.getByRole('button', { name: /proxy/iu })).toHaveCount(0);
		await expect(editor.getByRole('menuitem', { name: /proxy/iu })).toHaveCount(0);

		await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
		const copiedArchive = await captureScapeArchive(page, editor);
		await expectFormat2Archive(copiedArchive);
		expect(errors).toEqual([]);
	});
});

async function captureScapeArchive(page, editor) {
	await page.evaluate(() => {
		globalThis.__framescaperV18ScapeSave = { chunks: [], closes: 0 };
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async () => ({
				name: 'framescaper-v18-copy.scape',
				async createWritable() {
					return {
						async write(chunk) {
							const bytes = chunk instanceof Blob
								? new Uint8Array(await chunk.arrayBuffer())
								: chunk instanceof ArrayBuffer
									? new Uint8Array(chunk)
									: new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
							globalThis.__framescaperV18ScapeSave.chunks.push([...bytes]);
						},
						async close() { globalThis.__framescaperV18ScapeSave.closes += 1; },
						async abort() {},
					};
				},
			}),
		});
	});
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperV18ScapeSave.closes)).toBe(1);
	const chunks = await page.evaluate(() => globalThis.__framescaperV18ScapeSave.chunks);
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function expectFormat2Archive(archive) {
	const reader = new ZipReader(new BlobReader(new Blob([archive])), { useWebWorkers: false });
	try {
		const entries = new Map((await reader.getEntries()).map((entry) => [entry.filename, entry]));
		const project = JSON.parse(new TextDecoder().decode(await readZipEntry(entries, 'project.json')));
		const manifest = JSON.parse(new TextDecoder().decode(await readZipEntry(entries, 'manifest.json')));
		expect(project.id).toBe(expectedArchive.projectId);
		expect(project.schemaVersion).toBe(expectedArchive.schemaVersion);
		expect(manifest.formatVersion).toBe(expectedArchive.formatVersion);
		expect(manifest.assets.map(({ kind, sha256, size }) => ({ kind, sha256, size })))
			.toEqual(expectedArchive.assets);
		for (const descriptor of manifest.assets) {
			const body = await readZipEntry(entries, descriptor.entry);
			expect(body.byteLength).toBe(descriptor.size);
			expect(createHash('sha256').update(body).digest('hex')).toBe(descriptor.sha256);
		}
	} finally {
		await reader.close();
	}
}

async function readZipEntry(entries, filename) {
	const entry = entries.get(filename);
	if (!entry || entry.directory) throw new Error(`Missing Scape archive entry ${filename}.`);
	return entry.getData(new Uint8ArrayWriter());
}
