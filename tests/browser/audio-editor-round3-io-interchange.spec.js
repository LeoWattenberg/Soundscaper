/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker,
	downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

for (const format of ['FCPXML', 'edit list (EDL)', 'OpenTimelineIO', 'DAWproject']) {
	test(`${format} carries a normal video trim into its source in-point`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicSilentVideoFixture('trimmed-interchange.webm')]);
		const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
		await clip.press('Enter');
		await seekFramescaperTimecode(page, editor, '00:00:00:12');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Trim left edge to playhead']);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect.poll(() => savedSourceInPoint(page, editor)).toBe(6);
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', `Export ${format}`]);
		const bytes = await downloadBytes(await downloading);
		const text = new TextDecoder().decode(bytes);
		if (format === 'FCPXML') {
			const sourceStart = /<asset-clip[^>]*\bstart="([^"]+)"/u.exec(text)?.[1];
			// The captured WebM's sixth source ordinal has PTS 456/1000s;
			// its nearest boundary on the 30 fps interchange grid is frame 14.
			expect(sourceStart).toBe('7/15s');
		} else if (format === 'edit list (EDL)') {
			const event = text.split('\n').find((line) => /^001\s/u.test(line));
			expect(event?.trim().split(/\s+/u)[4]).toBe('00:00:00:14');
		} else if (format === 'OpenTimelineIO') {
			const timeline = JSON.parse(text);
			const video = timeline.tracks.children.find((track) => track.kind === 'Video');
			const delivered = video.children.find((child) => child.OTIO_SCHEMA === 'Clip.1');
			expect(delivered.source_range.start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', value: 14, rate: 30 });
		} else {
			const archive = await readDawprojectArchive(new Blob([bytes]));
			try {
				const projectXml = archive.projectXml;
				expect(/<Clip[^>]*\bplayStart="([^"]+)"/u.exec(projectXml)?.[1]).toBe('0.456');
			} finally { await archive.close(); }
		}
	});
}

test('EDL assigns different reels to ordinary camera takes with a shared filename prefix', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('camera-take-001.webm')]);
	const first = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const targetTrackId = await first.locator('xpath=ancestor::*[@data-track-row][1]').getAttribute('data-track-id');
	const targetTrack = editor.locator(`[data-track-row][data-track-id="${targetTrackId}"]`);
	await chooseCommandAction(page, editor, 'Window', 'Project bin');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('camera-take-002.webm', { variant: 'fallback' }));
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const card = editor.getByRole('listitem', { name: 'Project bin: camera-take-002', exact: true });
	await expect(card).toBeVisible();
	await first.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:02:00');
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(targetTrack.getByRole('group', { name: /^Video clip:/u })).toHaveCount(2);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export edit list (EDL)']);
	const text = new TextDecoder().decode(await downloadBytes(await downloading));
	const events = text.split('\n').filter((line) => /^\d{3}\s/u.test(line));
	expect(events).toHaveLength(2);
	expect(new Set(events.map((line) => line.trim().split(/\s+/u)[1])).size).toBe(2);
});

async function savedSourceInPoint(page, editor) {
	const projectId = await editor.getAttribute('data-project-id');
	return page.evaluate(async ({ databaseName, projectId }) => {
		const read = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await read(indexedDB.open(databaseName));
		try {
			const project = await read(database.transaction('projects', 'readonly').objectStore('projects').get(projectId));
			return project.clips.find((clip) => clip.kind === 'video').sourceInFrame;
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId });
}
