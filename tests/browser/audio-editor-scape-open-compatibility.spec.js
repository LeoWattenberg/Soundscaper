import { createHash } from 'node:crypto';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Scape open feature decisions', () => {
	registerAudioEditorHooks();

	test('cancels or opens a unique incompatible project read-only', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalId = await editor.getAttribute('data-project-id');
		const exported = await captureScapeArchive(page, editor);
		const incomingId = `${originalId}-incompatible`;
		const archive = await incompatibleArchive(exported, {
			id: incomingId,
			title: 'Feature decision project',
		});
		const input = editor.locator('[data-aup4-input]');
		const fileMenu = editor.getByRole('menuitem', { name: 'File', exact: true });

		await fileMenu.focus();
		await setScapeInput(input, archive);
		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility');
		await expect(dialog).toHaveAccessibleDescription(/Feature decision project.*requires features.*read-only/iu);
		await expect(dialog.getByText('Video effects', { exact: true })).toBeVisible();
		await expect(dialog.getByText('org.soundscaper.capability.video-effects', { exact: true })).toBeVisible();
		await expect(dialog.getByText(/Unavailable.*Bypass declared/iu)).toBeVisible();
		const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
		await expect(cancel).toBeFocused();
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-scape-open-decision]');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(fileMenu).toBeFocused();
		await expect(editor).toHaveAttribute('data-project-id', originalId);

		await setScapeInput(input, archive);
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', incomingId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		expect(errors).toEqual([]);
	});

	test('combines collision and compatibility consent into one read-only-copy decision', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalId = await editor.getAttribute('data-project-id');
		const exported = await captureScapeArchive(page, editor);
		const archive = await incompatibleArchive(exported, {
			id: originalId,
			title: 'Colliding feature project',
		});
		const input = editor.locator('[data-aup4-input]');

		await setScapeInput(input, archive);
		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility-collision');
		await expect(dialog).toHaveAccessibleDescription(/requires features.*same ID/iu);
		await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
		await expect(dialog.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-project-id', originalId);
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-scape-open-decision]');

		await dialog.getByRole('button', { name: 'Open as read-only copy', exact: true }).click();
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		expect(errors).toEqual([]);
	});
});

async function captureScapeArchive(page, editor) {
	await page.evaluate(() => {
		globalThis.__scapeCompatibilitySave = { chunks: [], closes: 0 };
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async () => ({
				name: 'compatibility.scape',
				async createWritable() {
					return {
						async write(chunk) { globalThis.__scapeCompatibilitySave.chunks.push(chunk.slice()); },
						async close() { globalThis.__scapeCompatibilitySave.closes += 1; },
						async abort() {},
					};
				},
			}),
		});
	});
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	await expect.poll(() => page.evaluate(() => globalThis.__scapeCompatibilitySave.closes)).toBe(1);
	const chunks = await page.evaluate(() => globalThis.__scapeCompatibilitySave.chunks.map((chunk) => [...chunk]));
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function incompatibleArchive(input, { id, title }) {
	const reader = new ZipReader(new BlobReader(new Blob([input])), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const payloads = new Map();
	for (const entry of entries) payloads.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
	await reader.close();

	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const project = JSON.parse(decoder.decode(payloads.get('project.json')));
	project.id = id;
	project.title = title;
	project.featureRequirements = {
		schemaVersion: 1,
		requirements: [{
			id: 'video-effects',
			featureId: 'org.soundscaper.capability.video-effects',
			displayName: 'Video effects',
			disposition: 'bypass',
			fallback: null,
		}],
	};
	const projectBytes = encoder.encode(JSON.stringify(project));
	payloads.set('project.json', projectBytes);
	const manifest = JSON.parse(decoder.decode(payloads.get('manifest.json')));
	manifest.project.size = projectBytes.byteLength;
	manifest.project.sha256 = createHash('sha256').update(projectBytes).digest('hex');
	payloads.set('manifest.json', encoder.encode(JSON.stringify(manifest)));

	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	for (const entry of entries) {
		await writer.add(entry.filename, new Uint8ArrayReader(payloads.get(entry.filename)), { level: 0, zip64: true });
	}
	const output = await writer.close(undefined, { zip64: true });
	return Buffer.from(await output.arrayBuffer());
}

async function setScapeInput(input, buffer) {
	await input.setInputFiles({
		name: 'incompatible.scape',
		mimeType: 'application/vnd.soundscaper.scape+zip',
		buffer,
	});
}
