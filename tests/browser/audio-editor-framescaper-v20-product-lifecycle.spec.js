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
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

test.describe('selected Framescaper V27 product lifecycle', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
	});

	test('authors and reopens exact keyframes through the shipped route', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		let editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await importFiles(editor, [createDeterministicAvFixture('framescaper-v20-keyframes.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClip).toHaveCount(1);
		await videoClip.focus();
		await videoClip.press('Enter');
		await expect(videoClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);

		await openKeyframeDialog(page, editor);
		const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
		await expect(dialog).toBeVisible();
		const target = dialog.locator('[data-video-keyframe-field="target"]');
		const [opacityTarget] = await target.selectOption({ label: 'Opacity' });
		await expect(target).toHaveValue(opacityTarget);
		const startValue = dialog.locator('[data-video-keyframe-field="start-value"]');
		const endValue = dialog.locator('[data-video-keyframe-field="end-value"]');
		await startValue.fill('1');
		await endValue.fill('0.5');
		await expect(startValue).toHaveValue('1');
		await expect(endValue).toHaveValue('0.5');
		await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Video keyframes applied.');
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			schemaVersion: 27,
			curveCount: 1,
			startValue: 1,
			endValue: 0.5,
		});

		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({ curveCount: 0 });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({ curveCount: 1 });

		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			schemaVersion: 27,
			curveCount: 1,
			startValue: 1,
			endValue: 0.5,
		});

		const soundscaperPage = await page.context().newPage();
		const soundscaperErrors = collectClientErrors(soundscaperPage);
		try {
			const soundscaper = await bootEditor(soundscaperPage, '/embed/en/');
			await expect(soundscaper).toHaveAttribute('data-product', 'soundscaper');
			const audioClips = await openNestedCommandMenu(
				soundscaperPage, soundscaper, 'Edit', ['Audio clips'],
			);
			await expect(audioClips
				.getByRole('menuitem', { name: /^Video keyframes(?:\s|$)/u })).toHaveCount(0);
			await expect(audioClips
				.getByRole('menuitem', { name: /^Video retime…(?:\s|$)/u })).toHaveCount(0);
			expect(clientErrors).toEqual([]);
			expect(soundscaperErrors).toEqual([]);
		} finally {
			await soundscaperPage.close();
		}
	});

	test('authors exact retime from the keyboard-only lazy dialog', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('framescaper-v20-retime.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await videoClip.focus();
		await videoClip.press('Enter');

		const audioClips = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
		const retime = getMenuItem(audioClips, 'Video retime…');
		await expect(retime).toBeEnabled();
		await retime.focus();
		await retime.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Linked audio stays unwarped.');
		await assertNoSeriousAxeViolations(page, '[data-video-retime-dialog]');
		await page.emulateMedia({ forcedColors: 'active' });
		await expect(dialog.getByRole('button', { name: 'Reverse', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Reverse', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Video retime updated.');
		await expect.poll(() => storedRetimeState(page, projectId)).toMatchObject({
			schemaVersion: 20, mode: 'constant-reverse', audioWarp: null, audioReversed: false,
		});

		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedRetimeState(page, projectId)).toMatchObject({ mode: null });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => storedRetimeState(page, projectId)).toMatchObject({
			mode: 'constant-reverse', audioWarp: null, audioReversed: false,
		});
		expect(clientErrors).toEqual([]);
	});
});

async function openKeyframeDialog(page, editor) {
	const audioClips = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	const keyframes = getMenuItem(audioClips, 'Video keyframes');
	await expect(keyframes).toBeEnabled();
	await keyframes.focus();
	await keyframes.press('Enter');
}

async function storedKeyframeState(page, projectId) {
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
			const curve = video?.videoKeyframes?.curves?.[0]?.curve;
			return {
				schemaVersion: project?.schemaVersion ?? null,
				curveCount: video?.videoKeyframes?.curves?.length ?? -1,
				startValue: curve?.anchors?.[0]?.value ?? null,
				endValue: curve?.anchors?.at(-1)?.value ?? null,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function storedRetimeState(page, projectId) {
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
			const audio = project?.clips?.find((clip) => clip.kind === 'audio');
			return {
				schemaVersion: project?.schemaVersion ?? null,
				mode: video?.retimeMap?.segments?.[0]?.mode ?? null,
				audioWarp: audio?.warpMap ?? null,
				audioReversed: audio?.reversed ?? null,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
