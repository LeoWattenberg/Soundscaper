import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	disableOfflineAudio,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Broadcast WAV metadata UI', () => {
	registerAudioEditorHooks();

	test('edits and persists project BEXT v2 metadata independently from general metadata', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		let panel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(panel).toBeVisible();
		await expect(panel.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();

		const version = panel.locator('input[name="version"]');
		await expect(version).toHaveValue('2');
		await expect(version).toHaveAttribute('readonly', '');
		await commitInput(panel.locator('input[name="description"]'), 'Location master');
		await commitInput(panel.locator('input[name="originator"]'), 'Soundscaper Unit');
		await commitInput(panel.locator('input[name="timeReference"]'), '9007199254740993');
		await commitInput(panel.locator('input[name="loudnessValue"]'), '-23');
		await commitInput(panel.locator('textarea[name="codingHistory"]'), 'A=PCM,F=48000,W=24,M=stereo,T=Recorder');

		await panel.getByRole('button', { name: 'Close: Metadata', exact: true }).click();
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
		await expect(panel.locator('input[name="description"]')).toHaveValue('Location master');
		await expect(panel.locator('input[name="originator"]')).toHaveValue('Soundscaper Unit');
		await expect(panel.locator('input[name="timeReference"]')).toHaveValue('9007199254740993');
		await expect(panel.locator('input[name="loudnessValue"]')).toHaveValue('-23');
		await expect(panel.locator('textarea[name="codingHistory"]')).toHaveValue('A=PCM,F=48000,W=24,M=stereo,T=Recorder\n');
	});

	test('keeps Broadcast WAV BEXT export overrides transient', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		let dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await expect(dialog.locator('[data-export-field="channelMapping"]')).toContainText('Stereo');
		await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();

		let metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
		await expect(metadataDialog.getByRole('tab')).toHaveCount(2);
		await metadataDialog.getByRole('tab', { name: 'BEXT', exact: true }).click();
		await commitInput(metadataDialog.locator('input[name="description"]'), 'One-off delivery');
		await metadataDialog.getByRole('button', { name: /^Done\.?$/u }).click();

		dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
		await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
		metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
		await metadataDialog.getByRole('tab', { name: 'BEXT', exact: true }).click();
		await expect(metadataDialog.locator('input[name="description"]')).toHaveValue('One-off delivery');
		await metadataDialog.getByRole('button', { name: /^Done\.?$/u }).click();
		await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const projectMetadata = editor.locator('[data-workspace-panel="metadata"]');
		await projectMetadata.getByRole('tab', { name: 'BEXT', exact: true }).click();
		await expect(projectMetadata.locator('input[name="description"]')).not.toHaveValue('One-off delivery');
	});

	test('Escape cancels a BEXT field draft while Enter still commits it', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		let panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
		let description = panel.locator('input[name="description"]');
		const original = await description.inputValue();

		await description.fill('Cancelled description');
		await description.press('Escape');
		await expect(description).toHaveValue(original);
		await panel.getByRole('button', { name: 'Close: Metadata', exact: true }).click();
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
		description = panel.locator('input[name="description"]');
		await expect(description).toHaveValue(original);

		await description.fill('Committed description');
		await description.press('Enter');
		await panel.getByRole('button', { name: 'Close: Metadata', exact: true }).click();
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
		await expect(panel.locator('input[name="description"]')).toHaveValue('Committed description');
	});

	test('downloads an offline BWF with authored BEXT v2 metadata and canonical coding history', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function'
			|| typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable.');
		await importFiles(editor, [monoTone]);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await authorExportBext(page, dialog, 'Offline delivery', '9007199254740993');
		await dialog.getByRole('button', { name: 'Start export' }).click();

		const parsed = await readBwfDownload(dialog);
		expect(parsed.fileName).toMatch(/\.wav$/u);
		expect(parsed.chunkIds.slice(0, 3)).toEqual(['bext', 'fmt ', 'data']);
		expect(parsed.description).toBe('Offline delivery');
		expect(parsed.version).toBe(2);
		expect(parsed.timeReference).toBe('9007199254740993');
		expect(parsed.codingHistory).toContain('A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\r\n');
		expect(errors).toEqual([]);
	});

	test('downloads the same BEXT structure through bounded realtime BWF rendering', async ({ page }) => {
		await disableNativeSavePicker(page);
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await authorExportBext(page, dialog, 'Realtime delivery', '42');
		await dialog.getByRole('button', { name: 'Start export' }).click();

		const parsed = await readBwfDownload(dialog);
		expect(parsed.chunkIds.slice(0, 3)).toEqual(['bext', 'fmt ', 'data']);
		expect(parsed.description).toBe('Realtime delivery');
		expect(parsed.version).toBe(2);
		expect(parsed.timeReference).toBe('42');
		expect(parsed.codingHistory).toContain('A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\r\n');
		expect(errors).toEqual([]);
	});
});

async function authorExportBext(page, dialog, description, timeReference) {
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
	await metadataDialog.getByRole('tab', { name: 'BEXT', exact: true }).click();
	await commitInput(metadataDialog.locator('input[name="description"]'), description);
	await commitInput(metadataDialog.locator('input[name="timeReference"]'), timeReference);
	await metadataDialog.getByRole('button', { name: /^Done\.?$/u }).click();
}

async function readBwfDownload(dialog) {
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	return download.evaluate(async (link) => {
		const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const text = (offset, length) => new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length));
		const chunkIds = [];
		let offset = 12;
		let bextOffset = -1;
		let bextBytes = 0;
		while (offset + 8 <= bytes.byteLength) {
			const id = text(offset, 4);
			const size = view.getUint32(offset + 4, true);
			chunkIds.push(id);
			if (id === 'bext') {
				bextOffset = offset + 8;
				bextBytes = size;
			}
			offset += 8 + size + (size & 1);
		}
		if (bextOffset < 0) throw new Error('The downloaded WAV has no BEXT chunk.');
		const low = BigInt(view.getUint32(bextOffset + 338, true));
		const high = BigInt(view.getUint32(bextOffset + 342, true));
		return {
			fileName: link.download,
			chunkIds,
			description: text(bextOffset, 256).replace(/\0.*$/u, ''),
			version: view.getUint16(bextOffset + 346, true),
			timeReference: (low + (high << 32n)).toString(),
			codingHistory: text(bextOffset + 602, Math.max(0, bextBytes - 602)),
		};
	});
}
