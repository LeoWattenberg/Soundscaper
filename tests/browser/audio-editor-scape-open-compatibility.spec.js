import { createHash } from 'node:crypto';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Scape open feature decisions', () => {
	registerAudioEditorHooks();

	test('cancels or opens a unique incompatible project read-only', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-project-feature-compatibility]')).toHaveCount(0);
		await importFiles(editor, [toneA]);
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
		await expect(dialog.getByText('Future mixer', { exact: true })).toBeVisible();
		await expect(dialog.getByText('org.example.future-mixer', { exact: true })).toBeVisible();
		await expect(dialog.getByText(/Unknown.*Rendered fallback declared/iu)).toBeVisible();
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

		const notice = editor.locator('[data-project-feature-compatibility]');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAccessibleName('Project features unavailable');
		await expect(notice.locator('[data-project-feature-unavailable-count]')).toHaveText('1');
		await expect(notice.locator('[data-project-feature-unknown-count]')).toHaveText('1');
		const bypassed = notice.locator('[data-project-feature-requirement="org.soundscaper.capability.video-effects"]');
		await expect(bypassed).toBeVisible();
		await expect(bypassed).toContainText('Video effects');
		await expect(bypassed).toContainText('Unavailable · Bypass declared');
		await expect(bypassed).toHaveAttribute('data-declared-disposition', 'bypass');
		await expect(bypassed).toHaveAttribute('data-effective-disposition', 'bypassed');
		const rendered = notice.locator('[data-project-feature-requirement="org.example.future-mixer"]');
		await expect(rendered).toBeVisible();
		await expect(rendered).toContainText('Future mixer');
		await expect(rendered).toContainText('Unknown · Rendered fallback declared');
		await expect(rendered).toHaveAttribute('data-declared-disposition', 'rendered-fallback');
		await expect(rendered).toHaveAttribute('data-effective-disposition', 'rendered-fallback');
		await expect(notice.getByRole('button')).toHaveCount(0);
		await expect(notice).not.toContainText(/verified|active(?: at runtime)?|playing|loaded|in use|plug-?in|third-party/iu);
		await notice.focus();
		await expect(notice).toBeFocused();
		await assertAccessibleBasics(notice);
		await assertNoSeriousAxeViolations(page, '[data-project-feature-compatibility]');

		const originalTab = editor.getByRole('tab', { name: 'Untitled project', exact: true });
		await originalTab.focus();
		await page.keyboard.press('Enter');
		await expect(editor).toHaveAttribute('data-project-id', originalId);
		await expect(notice).toHaveCount(0);
		const incomingTab = editor.getByRole('tab', { name: 'Feature decision project', exact: true });
		await incomingTab.focus();
		await page.keyboard.press('Enter');
		await expect(editor).toHaveAttribute('data-project-id', incomingId);
		await expect(notice).toBeVisible();
		await expect(rendered).toBeVisible();
		await expect(rendered).toContainText('Future mixer');
		expect(errors).toEqual([]);
	});

	test('combines collision and compatibility consent into one read-only-copy decision', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalId = await editor.getAttribute('data-project-id');
		await importFiles(editor, [toneA]);
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
	return rewriteArchive(input, ({ project, manifest }) => {
		project.id = id;
		project.title = title;
		const audioAsset = manifest.assets.find((asset) => asset.kind === 'audio');
		const audioSource = project.sources.find((source) => source.id === audioAsset?.sourceId);
		if (!audioAsset || !audioSource) throw new Error('Compatibility fixture requires one exported audio source.');
		project.featureRequirements = {
			schemaVersion: 1,
			requirements: [{
				id: 'video-effects',
				featureId: 'org.soundscaper.capability.video-effects',
				displayName: 'Video effects',
				disposition: 'bypass',
				fallback: null,
			}, {
				id: 'future-mixer',
				featureId: 'org.example.future-mixer',
				displayName: 'Future mixer',
				disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: audioSource.id, sha256: audioAsset.sha256 },
			}],
		};
	});
}

async function rewriteArchive(input, mutate) {
	const reader = new ZipReader(new BlobReader(new Blob([input])), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const payloads = new Map();
	for (const entry of entries) payloads.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
	await reader.close();

	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const project = JSON.parse(decoder.decode(payloads.get('project.json')));
	const manifest = JSON.parse(decoder.decode(payloads.get('manifest.json')));
	mutate({ project, manifest });
	const projectBytes = encoder.encode(JSON.stringify(project));
	payloads.set('project.json', projectBytes);
	manifest.project.schemaVersion = project.schemaVersion;
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
