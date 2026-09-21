/* SPDX-License-Identifier: AGPL-3.0-only */

import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import {
	createWavFixture,
	expect,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import {
	completeMilestone7Run,
	installMilestone7LocalAssistanceFixture,
} from './helpers/milestone-7-local-assistance.js';

const AUDIO = createWavFixture({
	name: 'assistance-acceptance.wav',
	frequency: 330,
	duration: 4,
	channelCount: 1,
});

test.describe('Local Assistance result acceptance', () => {
	registerAudioEditorHooks();

	test('publishes reviewed audio, reaction, beat, tempo, and cleanup results', async ({ page }) => {
		test.setTimeout(240_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installMilestone7LocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [AUDIO], { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		acceptConsentDialogs(page);

		await selectSource(editor, page);
		let review = await runAndReview(page, editor, 'Enhance Dialogue');
		await review.getByRole('checkbox', { name: 'Enhanced Dialogue', exact: true }).check();
		await applyAndClose(page);
		await expect.poll(() => acceptedProjectSummary(page, projectId))
			.toMatchObject({ assistanceSourceNames: ['Enhanced Dialogue'] });

		await selectSource(editor, page);
		review = await runAndReview(page, editor, 'Mark Reactions');
		await review.getByRole('checkbox', { name: 'Reaction range 1', exact: true }).check();
		await applyAndClose(page);
		await expect(editor.locator('[data-label-track] [data-label-id]', { hasText: 'Laughter' }))
			.toHaveCount(1);

		await selectSource(editor, page);
		await openAssistanceTask(page, editor, 'Detect Beats & Tempo');
		let assistance = page.locator('[data-local-assistance]');
		await assistance.getByRole('checkbox', {
			name: 'Add a Beats label track', exact: true,
		}).check();
		await assistance.getByRole('checkbox', {
			name: 'Update the project tempo map', exact: true,
		}).check();
		review = await runSelectedAndReview(page, assistance);
		await review.getByRole('checkbox', { name: 'Beat point 1', exact: true }).check();
		await review.getByRole('checkbox', { name: 'Tempo map', exact: true }).check();
		await applyAndClose(page);
		await expect(editor.locator('[data-label-track] [data-label-id]', { hasText: 'Downbeat' }))
			.toHaveCount(1);

		await selectSource(editor, page);
		review = await runAndReview(page, editor, 'Clean Filler & Silence');
		await review.getByRole('checkbox', { name: 'Cleanup edit 1', exact: true }).check();
		await applyAndClose(page);

		await expect.poll(() => acceptedProjectSummary(page, projectId)).toMatchObject({
			assistanceSourceNames: ['Enhanced Dialogue'],
			beatLabels: ['Downbeat'],
			cleanupClipCount: 2,
			reactionLabels: ['Laughter'],
			tempoBpm: { den: 1, num: 120 },
		});
		expect(errors).toEqual([]);
	});
});

async function selectSource(editor, page) {
	const clip = clipByName(editor, AUDIO.name).first();
	await expect(clip).toBeVisible();
	await clip.focus();
	await page.keyboard.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

function acceptConsentDialogs(page) {
	page.on('dialog', async (dialog) => {
		expect(dialog.type()).toBe('confirm');
		await dialog.accept();
	});
}

async function runAndReview(page, editor, task) {
	await openAssistanceTask(page, editor, task);
	return runSelectedAndReview(page, page.locator('[data-local-assistance]'));
}

async function runSelectedAndReview(page, assistance) {
	await assistance.getByRole('button', { name: 'Run locally', exact: true }).click();
	await expect(assistance.getByRole('status', { name: 'Processing status' }))
		.toHaveText('Processing selected media locally');
	await completeMilestone7Run(page);
	await expect(assistance.getByRole('status', { name: 'Processing status' }))
		.toContainText('Processing finished.');
	await assistance.getByRole('button', { name: 'Review result', exact: true }).click();
	const review = assistance.getByRole('region', { name: 'Guided workflow review', exact: true });
	await expect(review).toBeVisible();
	return review;
}

async function applyAndClose(page) {
	const assistance = page.locator('[data-local-assistance]');
	await assistance.getByRole('button', { name: 'Apply selected', exact: true }).click();
	await expect(assistance.getByRole('status', { name: 'Processing status' }))
		.toHaveText('The proposal was accepted.');
	await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
	await expect(assistance).toBeHidden();
}

async function acceptedProjectSummary(page, projectId) {
	return page.evaluate(async ({ databaseName, id, sourceName }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			const labels = (name) => project.tracks.find((track) => track.name === name)?.labels ?? [];
			const source = project.sources.find(({ name }) => name === sourceName);
			return {
				assistanceSourceNames: project.sources
					.filter(({ name }) => name === 'Enhanced Dialogue').map(({ name }) => name),
				beatLabels: labels('Beats').map(({ title }) => title),
				cleanupClipCount: project.clips.filter(({ sourceId }) => sourceId === source?.id).length,
				reactionLabels: labels('Reactions').map(({ title }) => title),
				tempoBpm: project.tempoMap?.events?.[0]?.bpm,
			};
		} finally {
			database.close();
		}
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId, sourceName: AUDIO.name });
}
