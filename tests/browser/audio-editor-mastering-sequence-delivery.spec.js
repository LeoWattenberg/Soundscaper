/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { parseRiffMarkers } from '../../src/common/editor/riff-markers.ts';
import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseExportProjectFileAction,
	chooseFileAction,
	chooseNestedCommandAction,
	closeDialog,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openExportDialog,
	readDownloadBytes,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper mastering sequence delivery', () => {
	registerAudioEditorHooks();

	test('saves an authored order and delivers its exact WAV length and cues after reopening', async ({ page }) => {
		test.setTimeout(120_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Markers']);
		const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
		await addNamedRegion(page, editor, panel, 40, 150, 'Opening');
		await addNamedRegion(page, editor, panel, 170, 280, 'Reprise');

		await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
		let mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
		await mastering.getByRole('button', { name: 'New sequence', exact: true }).click();
		const nameForm = mastering.getByRole('form', { name: 'Sequence name', exact: true });
		await nameForm.getByRole('textbox').fill('Album order');
		await nameForm.getByRole('button', { name: 'Sequence name', exact: true }).click();
		const regionPicker = mastering.getByRole('combobox', { name: 'Add region', exact: true });
		await regionPicker.selectOption({ label: 'Opening' });
		await mastering.getByRole('button', { name: 'Add region', exact: true }).click();
		await regionPicker.selectOption({ label: 'Reprise' });
		await mastering.getByRole('button', { name: 'Add region', exact: true }).click();
		await mastering.getByRole('form', { name: 'Reprise', exact: true })
			.getByRole('button', { name: 'Move entry up', exact: true }).click();
		await expect(mastering.getByRole('region', { name: 'Entries' }).getByRole('form'))
			.toHaveCount(2);
		await expect(mastering.getByText(/Delivered length: \d+/u)).toBeVisible();
		await closeDialog(mastering);

		const saving = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const archiveDownload = await saving;
		const archive = await downloadBytes(archiveDownload);
		const savedProject = await readProjectFromScape(archive);
		const [sequence] = savedProject.masteringSequences;
		expect(sequence.name).toBe('Album order');
		expect(sequence.entries).toHaveLength(2);
		const regions = new Map(savedProject.timelineAnnotations.map((region) => [region.id, region]));
		const expectedCues = [];
		let expectedFrames = 0;
		for (const entry of sequence.entries) {
			const region = regions.get(entry.annotationId);
			expect(region?.kind).toBe('region');
			expectedFrames += entry.gapBeforeFrames;
			const sampleLength = region.endFrame - region.startFrame;
			expectedCues.push({
				sampleOffset: expectedFrames,
				sampleLength,
				label: entry.title ?? region.name,
			});
			expectedFrames += sampleLength;
		}
		expect(expectedCues.map(({ label }) => label)).toEqual(['Reprise', 'Opening']);

		const originalProjectId = await editor.getAttribute('data-project-id');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalProjectId);
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosingFile).setFiles({
			name: 'album-order.sscape',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			buffer: Buffer.from(archive),
		});
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible({ timeout: 20_000 });
		await collision.getByRole('button', { name: /^Open as (?:read-only )?copy$/u }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
		await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
		mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
		await expect(mastering.getByRole('form', { name: 'Sequence name' }).getByRole('textbox'))
			.toHaveValue('Album order');
		await expect(mastering.getByRole('form', { name: 'Reprise' })).toBeVisible();
		await expect(mastering.getByRole('form', { name: 'Opening' })).toBeVisible();
		await closeDialog(mastering);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="output"]'), 'Album order');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const downloadLink = exportDialog.locator('[data-export-download]');
		await expect(downloadLink).toBeVisible({ timeout: 30_000 });
		const wav = readWav(await readDownloadBytes(page, downloadLink));
		expect(wav.sampleRate).toBe(savedProject.sampleRate);
		expect(wav.frames).toBe(expectedFrames);
		expect(wav.cues).toEqual(expectedCues);
		await closeDialog(exportDialog);

		if (!await panel.isVisible()) {
			await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Markers']);
		}
		const removedRegion = panel.getByRole('button', { name: /Opening, Region/u });
		await removedRegion.press('Enter');
		await panel.getByRole('group', { name: 'Edit annotation', exact: true })
			.getByRole('button', { name: 'Remove selected annotations', exact: true }).click();
		await expect(panel.getByRole('button', { name: /Opening, Region/u })).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
		mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
		await expect(mastering.getByText('Region unavailable', { exact: true })).toBeVisible();
		await expect(mastering).toContainText('This sequence cannot be delivered');
		await closeDialog(mastering);
		const blockedExport = await openExportDialog(page, editor);
		await blockedExport.locator('[data-export-field="output"]').getByRole('button').click();
		await expect(page.getByRole('option', { name: 'Album order', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

async function addNamedRegion(page, editor, panel, startX, endX, name) {
	const ruler = editor.locator('[data-ruler]');
	const bounds = await ruler.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + startX, bounds.y + 26);
	await page.mouse.down();
	await page.mouse.move(bounds.x + endX, bounds.y + 26, { steps: 5 });
	await page.mouse.up();
	await expect(panel.getByRole('button', { name: 'Add region from selection', exact: true }))
		.toBeEnabled();
	await panel.getByRole('button', { name: 'Add region from selection', exact: true }).click();
	const row = panel.locator('li').last();
	await row.locator('[data-timeline-annotation]').press('Enter');
	const input = row.getByRole('group', { name: 'Edit annotation', exact: true })
		.getByRole('textbox', { name: 'Name', exact: true });
	await input.fill(name);
	await input.press('Enter');
	await expect(row.locator('[data-timeline-annotation]')).toHaveAttribute('aria-label', new RegExp(`^${name}, Region`, 'u'));
}

async function readProjectFromScape(archive) {
	const reader = new ZipReader(new BlobReader(new Blob([archive])), { useWebWorkers: false });
	try {
		const entry = (await reader.getEntries()).find(({ filename }) => filename === 'project.json');
		expect(entry).toBeDefined();
		return JSON.parse(new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter())));
	} finally {
		await reader.close();
	}
}

function readWav(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
	expect(Buffer.from(bytes.subarray(8, 12)).toString('ascii')).toBe('WAVE');
	const chunks = new Map();
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const kind = Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii');
		const size = view.getUint32(offset + 4, true);
		expect(offset + 8 + size).toBeLessThanOrEqual(bytes.byteLength);
		chunks.set(kind, [...(chunks.get(kind) ?? []), bytes.subarray(offset + 8, offset + 8 + size)]);
		offset += 8 + size + (size & 1);
	}
	const format = chunks.get('fmt ')?.[0];
	const audio = chunks.get('data')?.[0];
	expect(format).toBeDefined();
	expect(audio).toBeDefined();
	const formatView = new DataView(format.buffer, format.byteOffset, format.byteLength);
	const blockAlign = formatView.getUint16(12, true);
	expect(blockAlign).toBeGreaterThan(0);
	const cues = parseRiffMarkers(
		chunks.get('cue ')?.[0] ?? null,
		(chunks.get('LIST') ?? [])
			.filter((payload) => Buffer.from(payload.subarray(0, 4)).toString('ascii') === 'adtl')
			.map((payload) => payload.subarray(4)),
	);
	return {
		sampleRate: formatView.getUint32(4, true),
		frames: audio.byteLength / blockAlign,
		cues: cues.map(({ sampleOffset, sampleLength, label }) => ({ sampleOffset, sampleLength, label })),
	};
}
