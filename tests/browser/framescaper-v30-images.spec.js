/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	getMenuItem,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
);

test.describe('Framescaper V30 timeline images', () => {
	test('adds, undoes, redoes, persists, and reopens an image from Generate', async ({ page }) => {
		test.setTimeout(120_000);
		const clientErrors = collectClientErrors(page);
		let editor = await bootEditor(page, '/framescaper/embed/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const chooserPromise = page.waitForEvent('filechooser');
		const generate = await openNestedCommandMenu(page, editor, 'Generate', []);
		await getMenuItem(generate, 'Add Images…').click();
		const chooser = await chooserPromise;
		await chooser.setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG });

		const imageClip = editor.locator('[data-clip-kind="image"]');
		await expect(imageClip).toHaveCount(1, { timeout: 30_000 });
		await expect(imageClip).toHaveAttribute('aria-label', 'Image clip: poster');
		await expect(imageClip.locator('[data-product-visual-thumbnail]')).toHaveCount(1);
		await expect.poll(() => storedImageState(page, projectId)).toMatchObject({
			schemaVersion: 30,
			sourceCount: 1,
			clipCount: 1,
			fileName: 'poster.png',
			width: 1,
			height: 1,
			timelineOwned: true,
			requiresTimelineImages: true,
		});
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(imageClip).toHaveCount(0);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(imageClip).toHaveCount(1);

		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(1);
		await expect.poll(() => storedImageState(page, projectId)).toMatchObject({
			schemaVersion: 30, sourceCount: 1, clipCount: 1, timelineOwned: true,
		});
		expect(clientErrors).toEqual([]);
	});
});

async function storedImageState(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error || new Error(`Could not open ${databaseName}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				const project = request.result;
				const sources = project?.sources?.filter((source) => source.kind === 'image') ?? [];
				const clips = project?.clips?.filter((clip) => clip.kind === 'image') ?? [];
				const clipIds = new Set(project?.tracks?.flatMap((track) => track.clipIds ?? []) ?? []);
				const requirements = project?.featureRequirements?.requirements ?? [];
				database.close();
				resolve({
					schemaVersion: project?.schemaVersion ?? null,
					sourceCount: sources.length,
					clipCount: clips.length,
					fileName: sources[0]?.original?.fileName ?? null,
					width: sources[0]?.canonical?.width ?? null,
					height: sources[0]?.canonical?.height ?? null,
					timelineOwned: clips.length === 1 && clipIds.has(clips[0].id),
					requiresTimelineImages: requirements.some(({ featureId }) => (
						featureId === 'org.soundscaper.capability.timeline-images-v1'
					)),
				});
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
