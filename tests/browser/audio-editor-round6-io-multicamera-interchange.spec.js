/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel, disableNativeSavePicker,
	downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const switched of [false, true]) test(`OTIO references the actual ordinary camera output (switched=${switched})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await closeWorkspacePanel(editor, 'metadata');
	const media = [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1'),
		videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1')];
	for (const [index, file] of media.entries()) await importFiles(editor, [{
		name: `camera-${index ? 'b' : 'a'}.mp4`, mimeType: file.file.mimeType, buffer: Buffer.from(file.file.buffer),
	}]);
	await editor.getByRole('button', { name: 'Hide video', exact: true }).last().click();
	const clip = editor.getByRole('group', { name: 'Video clip: camera-a', exact: true });
	await clip.focus(); await clip.press('Enter');
	if (switched) {
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const expectedSource = await storedCameraSource(page, projectId, switched ? 'camera-b.mp4' : 'camera-a.mp4');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const document = JSON.parse(new TextDecoder().decode(await downloadBytes(await downloading)));
	const output = document.tracks.children.flatMap(track => track.children)
		.find(item => item.OTIO_SCHEMA === 'Clip.1' && item.name === 'camera-a');
	expect(output).toBeTruthy();
	expect(output.source_range.duration).toEqual({ OTIO_SCHEMA: 'RationalTime.1', value: expectedSource.sequenceFrameCount, rate: 25 });
	expect(output.media_reference.metadata['media.kw.soundscaper'].sourceId).toBe(expectedSource.id);
	expect(output.media_reference.target_url).toBe(expectedSource.storageKey);
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-severity="warning"]').filter({ hasText: /editable multicamera group/u }))
		.toHaveCount(switched ? 1 : 0);
});

async function storedCameraSource(page, projectId, name) {
	return page.evaluate(async ({ databaseName, projectId, name }) => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'revisions'], 'readonly');
			const [project, revisions] = await Promise.all([
				result(transaction.objectStore('projects').get(projectId)), result(transaction.objectStore('revisions').getAll()),
			]);
			const current = revisions.filter(row => row.projectId === projectId)
				.sort((a, b) => b.revision - a.revision)[0]?.project ?? project;
			const source = current.sources.find(source => source.name === name);
			if (!source) throw new Error('The ordinary saved camera source is missing.');
			const output = current.clips.find(clip => clip.kind === 'video' && clip.title === 'camera-a');
			return { id: source.id, storageKey: source.storageKey, sequenceFrameCount: output.sequenceFrameCount };
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId, name });
}
