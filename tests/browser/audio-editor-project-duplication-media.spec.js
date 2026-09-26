/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseNestedCommandAction,
	clipByName,
	closeDialog,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	readDownloadBytes,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const retainedTone = createWavFixture({
	name: 'duplicate-retained-tone.wav',
	frequency: 523.25,
	duration: 0.25,
	channelCount: 2,
	channelAmplitudes: [0.2, 0.6],
});

test.describe('project duplication retained-media lifecycle', () => {
	registerAudioEditorHooks();

	test('keeps exact audio reachable and the copy writable after deleting its source project', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [retainedTone]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 10_000,
		});

		const originalId = await editor.getAttribute('data-project-id');
		expect(originalId).toBeTruthy();
		const originalMedia = await projectMediaSnapshot(page, originalId, retainedTone.name);
		expect(originalMedia.source).toMatchObject({
			channelCount: 2,
			frameCount: 12_000,
			name: retainedTone.name,
			sampleRate: 48_000,
		});
		expect(originalMedia.source.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(originalMedia.stored).toMatchObject({
			channelCount: 2,
			frameCount: 12_000,
			sampleRate: 48_000,
		});
		const originalExport = await exportPcm16(page, editor);

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
		await expect(editor.locator('[data-project-name]')).toHaveText('Untitled project copy');
		const copyId = await editor.getAttribute('data-project-id');
		expect(copyId).toBeTruthy();
		expect(copyId).not.toBe(originalId);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		expect(await projectMediaSnapshot(page, copyId, retainedTone.name)).toEqual(originalMedia);

		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs', exact: true });
		await projectTabs.getByRole('tab', { name: 'Untitled project', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', originalId);
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
		const confirmation = page.getByRole('dialog', { name: 'Delete this project?', exact: true });
		await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click();
		await expect(confirmation).toBeHidden();

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Local projects']);
		const projects = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await projects.locator('[data-project-list]')
			.getByRole('button', { name: /^Untitled project copy Last edited:/u }).click();
		await expect(projects).toBeHidden();
		await expect(editor).toHaveAttribute('data-project-id', copyId);
		await expect(clipByName(editor, retainedTone.name)).toHaveCount(1);

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', copyId);
		await expect(clipByName(editor, retainedTone.name)).toHaveCount(1);
		const retainedMedia = await projectMediaSnapshot(page, copyId, retainedTone.name);
		expect(retainedMedia).toEqual(originalMedia);
		expect(await storedProjectExists(page, originalId)).toBe(false);

		await editor.getByRole('button', { name: 'Jump to project start', exact: true }).click();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await page.waitForTimeout(100);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 10_000,
		});

		const rendered = await exportPcm16(page, editor);
		const source = readPcm16Wav(retainedTone.buffer);
		expect(rendered).toMatchObject({
			bitsPerSample: source.bitsPerSample,
			channelCount: source.channelCount,
			frameCount: source.frameCount,
			sampleRate: source.sampleRate,
		});
		expect(rendered).toEqual(originalExport);

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', copyId);
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(clipByName(editor, retainedTone.name)).toHaveCount(1);
		expect(await projectMediaSnapshot(page, copyId, retainedTone.name)).toEqual(originalMedia);
		expect(errors).toEqual([]);
	});
});

async function projectMediaSnapshot(page, projectId, sourceName) {
	return page.evaluate(async ({ databaseName, requestedProjectId, requestedSourceName }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const project = await request(
				database.transaction('projects', 'readonly').objectStore('projects').get(requestedProjectId),
			);
			if (!project) throw new Error(`Project ${requestedProjectId} was not found.`);
			const source = project.sources?.find(({ name }) => name === requestedSourceName);
			if (!source) throw new Error(`Project source ${requestedSourceName} was not found.`);
			const storageKey = source.storageKey || source.id;
			const stored = await request(
				database.transaction('sources', 'readonly').objectStore('sources').get(storageKey),
			);
			if (!stored) throw new Error(`Stored source ${storageKey} was not found.`);
			return {
				source: {
					channelCount: source.channelCount,
					contentSha256: source.contentSha256,
					frameCount: source.frameCount,
					id: source.id,
					name: source.name,
					sampleRate: source.sampleRate,
					storageKey,
				},
				stored: {
					channelCount: stored.channelCount,
					frameCount: stored.frameCount,
					id: stored.id,
					sampleRate: stored.sampleRate,
					sourceToken: stored.sourceToken,
					storage: stored.storage,
				},
			};
		} finally {
			database.close();
		}
	}, {
		databaseName: SOUNDSCAPER_DATABASE_NAME,
		requestedProjectId: projectId,
		requestedSourceName: sourceName,
	});
}

async function storedProjectExists(page, projectId) {
	return page.evaluate(async ({ databaseName, requestedProjectId }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const request = database.transaction('projects', 'readonly')
					.objectStore('projects').getKey(requestedProjectId);
				request.onsuccess = () => resolve(request.result !== undefined);
				request.onerror = () => reject(request.error);
			});
		} finally {
			database.close();
		}
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, requestedProjectId: projectId });
}

async function exportPcm16(page, editor) {
	const exportDialog = await openExportDialog(page, editor);
	await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
	await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = exportDialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const wav = readPcm16Wav(await readDownloadBytes(page, download));
	await closeDialog(exportDialog);
	return wav;
}

function readPcm16Wav(input) {
	const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (offset, length) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
	if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('Expected a RIFF/WAVE file.');
	let format = null;
	let pcm = null;
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const id = text(offset, 4);
		const size = view.getUint32(offset + 4, true);
		const payload = offset + 8;
		if (payload + size > bytes.byteLength) throw new Error(`WAV chunk ${id} exceeds the file.`);
		if (id === 'fmt ') {
			format = {
				formatTag: view.getUint16(payload, true),
				channelCount: view.getUint16(payload + 2, true),
				sampleRate: view.getUint32(payload + 4, true),
				blockAlign: view.getUint16(payload + 12, true),
				bitsPerSample: view.getUint16(payload + 14, true),
			};
		}
		if (id === 'data') pcm = bytes.slice(payload, payload + size);
		offset = payload + size + (size & 1);
	}
	if (!format || !pcm || format.formatTag !== 1 || format.bitsPerSample !== 16) {
		throw new Error('Expected 16-bit integer PCM WAV data.');
	}
	return {
		bitsPerSample: format.bitsPerSample,
		channelCount: format.channelCount,
		frameCount: pcm.byteLength / format.blockAlign,
		pcmSha256: createHash('sha256').update(pcm).digest('hex'),
		sampleRate: format.sampleRate,
	};
}
