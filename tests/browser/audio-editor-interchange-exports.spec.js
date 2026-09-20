/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, captionLabels, readFile } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseFileAction, chooseNestedCommandAction,
	collectClientErrors, disableNativeSavePicker, importFiles, registerAudioEditorHooks,
	trackNameText, waitForEditor,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

test.describe('label and interchange exporters', () => {
	registerAudioEditorHooks();
	for (const fixture of [
		{
			name: 'audacity-labels.txt', mimeType: 'text/plain',
			text: '0.125\t0.750\tTXT intro\n1.000\t1.500\tTXT outro\n',
			titles: ['TXT intro', 'TXT outro'],
		},
		{
			name: 'browser-labels.vtt', mimeType: 'text/vtt',
			text: 'WEBVTT\n\nintro\n00:00:00.250 --> 00:00:01.500\nVTT intro\n\noutro\n00:00:02.000 --> 00:00:03.250\nVTT outro\n',
			titles: ['VTT intro', 'VTT outro'],
		},
	]) {
		test(`${fixture.name} imports through File > Import and survives reload`, async ({ page }) => {
			const errors = collectClientErrors(page);
			let editor = await bootEditor(page, '/embed/en/');
			const choosingFile = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Import');
			await (await choosingFile).setFiles({
				name: fixture.name, mimeType: fixture.mimeType, buffer: Buffer.from(fixture.text),
			});
			await expect(editor.locator('[data-status]')).toHaveText('Imported 2 label(s).');
			await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
			await expect(editor.locator('[data-label-track] [data-label-id]')).toContainText(fixture.titles);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
			await expect(editor.locator('[data-label-track] [data-label-id]')).toContainText(fixture.titles);
			expect(errors).toEqual([]);
		});
	}

	for (const [label, extension] of [
		['As Audacity TXT', 'txt'], ['As SubRip (SRT)', 'srt'],
		['As WebVTT', 'vtt'], ['As Podcast 2.0 chapters (JSON)', 'json'],
	]) {
		test(`${label} downloads cue text and timing`, async ({ page }) => {
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [captionLabels]);
			await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
			const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
			await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), label);
			const downloadPromise = page.waitForEvent('download');
			await dialog.getByRole('button', { name: 'Export labels', exact: true }).click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
			const text = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
			expect(text).toContain('Intro caption');
			if (extension === 'json') {
				const document = JSON.parse(text);
				expect(document.chapters).toHaveLength(2);
				expect(document.chapters[0]).toMatchObject({ startTime: 0.25, title: 'Intro caption' });
			} else if (extension === 'txt') expect(text).toMatch(/0\.25\d*\t1\.5\d*\tIntro caption/);
			else expect(text).toContain(extension === 'srt'
				? '00:00:00,250 --> 00:00:01,500' : '00:00:00.250 --> 00:00:01.500');
			await expect(dialog).toBeHidden();
			expect(errors).toEqual([]);
		});
	}

	test('DAWproject exports embedded audio and reopens as an editable project', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const trackName = await trackNameText(editor).first().textContent();
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.dawproject$/);
		const bytes = await readFile(await download.path());
		const archive = await readDawprojectArchive(new Blob([bytes]));
		try {
			expect(archive.projectXml).toContain('<Audio');
			const audioPath = archive.entryNames.find((name) => name.endsWith('.wav'));
			expect(audioPath).toBeTruthy();
			expect((await archive.readEntry(audioPath)).size).toBeGreaterThan(1000);
		} finally { await archive.close(); }
		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({ name: 'roundtrip.dawproject', mimeType: 'application/zip', buffer: bytes });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(trackNameText(editor).first()).toHaveText(trackName);
		expect(errors).toEqual([]);
	});

	for (const [label, extension] of [
		['Export edit list (EDL)', 'edl'], ['Export OpenTimelineIO', 'otio'], ['Export FCPXML', 'fcpxml'],
	]) {
		test(`${label} writes the visible video clip and its timing`, async ({ page }) => {
			test.setTimeout(60000);
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/framescaper/embed/en/');
			await importFiles(editor, [createDeterministicAvFixture('interchange.webm')]);
			const downloadPromise = page.waitForEvent('download');
			await chooseNestedCommandAction(page, editor, 'File', ['Export other', label]);
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
			const text = await readFile(await download.path(), 'utf8');
			if (extension === 'edl') {
				expect(text).toMatch(/FCM: NON-DROP FRAME/);
				expect(text).toMatch(/001\s+\S+\s+V\s+C\s+\d{2}:\d{2}:\d{2}:\d{2}/);
			} else if (extension === 'otio') {
				const document = JSON.parse(text);
				expect(document.OTIO_SCHEMA).toBe('Timeline.1');
				const clips = document.tracks.children.find((track) => track.kind === 'Video').children;
				expect(clips).toHaveLength(1);
				expect(clips[0].OTIO_SCHEMA).toBe('Clip.1');
				expect(clips[0].source_range.duration.value / clips[0].source_range.duration.rate).toBeCloseTo(32 / 15, 1);
				expect(clips[0].media_reference.target_url).toBeTruthy();
			} else {
				expect(text).toContain('<fcpxml');
				expect(text).toContain('<asset-clip');
				expect(text).toContain('interchange.webm');
			}
			expect(errors).toEqual([]);
		});
	}
});
