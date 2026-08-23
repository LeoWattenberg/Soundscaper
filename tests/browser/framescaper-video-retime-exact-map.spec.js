/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('exact V2 map authoring is keyboard-reached, validated, and one-step undoable', async ({ page }) => {
	test.setTimeout(120_000);
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('exact-map-authoring.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();

	const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
	await videoClip.focus();
	await videoClip.press('Enter');
	const audioClips = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	const retime = getMenuItem(audioClips, 'Video retime…');
	await retime.focus();
	await retime.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
	const exactMap = dialog.locator('[data-video-retime-exact-map="true"]');
	await expect(exactMap).toBeVisible();
	const authored = exactForwardThenFreeze(JSON.parse(await exactMap.inputValue()));
	await exactMap.fill(JSON.stringify(authored));
	await dialog.locator('[data-video-retime-set="true"]').click();
	await expect(dialog.getByRole('status')).toContainText('Video retime updated.');
	await expect.poll(() => storedSegments(page, projectId)).toEqual(['constant-forward', 'freeze']);

	await exactMap.fill(JSON.stringify({ ...authored, version: 1 }));
	await dialog.locator('[data-video-retime-set="true"]').click();
	await expect(dialog.getByRole('status')).toContainText('version must be 2');
	await expect.poll(() => storedSegments(page, projectId)).toEqual(['constant-forward', 'freeze']);
	await assertNoSeriousAxeViolations(page, '[data-video-retime-dialog]');
	await page.emulateMedia({ forcedColors: 'active' });
	await expect(exactMap).toBeVisible();

	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => storedSegments(page, projectId)).toEqual([]);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(() => storedSegments(page, projectId)).toEqual(['constant-forward', 'freeze']);
	expect(clientErrors).toEqual([]);
});

function exactForwardThenFreeze(current) {
	const first = current.points[0];
	const last = current.points.at(-1);
	const midpoint = Math.floor(last.outerFrame / 2);
	if (!first || !last || midpoint <= first.outerFrame || midpoint >= last.outerFrame) {
		throw new Error('The fixture did not expose a splittable exact retime domain.');
	}
	return {
		feature: 'video-retime', version: 2,
		points: [
			first,
			{ outerFrame: midpoint, sourceFrame: last.sourceFrame },
			last,
		],
		segments: [{ mode: 'constant-forward' }, { mode: 'freeze' }],
	};
}

async function storedSegments(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			const video = project?.clips?.find((clip) => clip.kind === 'video');
			return (video?.retimeMap?.segments ?? []).map(({ mode }) => mode);
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
