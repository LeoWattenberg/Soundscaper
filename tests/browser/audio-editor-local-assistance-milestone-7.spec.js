/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import {
	createDeterministicAvFixture,
	createDeterministicSilentVideoFixture,
} from './fixtures/deterministic-av-media.js';
import {
	completeMilestone7Run,
	installMilestone7LocalAssistanceFixture,
	milestone7FixtureSnapshot,
} from './helpers/milestone-7-local-assistance.js';

const VIDEO = createDeterministicSilentVideoFixture('milestone-7-workflows.webm');
const LINKED_AV = createDeterministicAvFixture('milestone-7-linked-workflows.webm');

test.describe('Milestone 7 Guided workflow qualification', () => {
	registerAudioEditorHooks();

	test('reviews transcript audition and independent beat publication choices', async ({ page }) => {
		test.setTimeout(180_000);
		const opened = await openGuidedLinkedFixture(page);
		const { editor, errors } = opened;
		let { assistance, guided } = opened;
		const consentMessages = acceptConsentDialogs(page);
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);

		let review = await runAndReview(page, guided, 'Transcribe & Captions');
		const captions = review.getByRole('checkbox', { name: '1 caption cue', exact: true });
		await expect(captions).not.toBeChecked();
		await expect(guided.getByRole('button', { name: 'Accept selected', exact: true })).toBeDisabled();
		await captions.check();
		await guided.getByRole('button', { name: 'Accept selected', exact: true }).click();
		await expect(guided.getByRole('status')).toHaveText('The proposal was accepted.');
		await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(assistance).toBeHidden();
		await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(1);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
		await reselectTimelineAudio(editor, page);
		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
		guided = assistance.getByRole('tabpanel', { name: 'Guided', exact: true });

		review = await runAndReview(page, guided, 'Enhance Dialogue');
		await expect(review.locator('label', { hasText: 'Original selection' }).locator('audio'))
			.toHaveCount(1);
		await expect(review.locator('label', { hasText: 'enhanced-audio' }).locator('audio'))
			.toHaveCount(1);
		await expect(review.getByRole('checkbox', { name: 'Enhanced Dialogue', exact: true }))
			.not.toBeChecked();

		await selectWorkflow(guided, 'Detect Beats & Tempo');
		const beatLabels = guided.getByRole('checkbox', {
			name: 'Publish an owned Beats label track', exact: true,
		});
		const tempoMap = guided.getByRole('checkbox', {
			name: 'Offer the exactly representable tempo-map diff', exact: true,
		});
		await expect(beatLabels).not.toBeChecked();
		await expect(tempoMap).not.toBeChecked();
		await beatLabels.check();
		await expect(tempoMap).not.toBeChecked();
		await tempoMap.check();
		review = await runSelectedAndReview(page, guided);
		const beatChoice = review.getByRole('checkbox', { name: 'Beat point 1', exact: true });
		const tempoChoice = review.getByRole('checkbox', { name: 'Tempo map', exact: true });
		await expect(beatChoice).not.toBeChecked();
		await expect(tempoChoice).not.toBeChecked();
		await beatChoice.check();
		await expect(tempoChoice).not.toBeChecked();
		await tempoChoice.check();
		await beatChoice.uncheck();
		await expect(tempoChoice).toBeChecked();

		expect(consentMessages).toHaveLength(3);
		expect(consentMessages[0]).toContain('Workflow: transcribe-captions');
		expect(consentMessages[0]).toContain(
			'Stages: detect-speech, recognize-speech, assemble-captions',
		);
		expect(consentMessages[1]).toContain('Workflow: enhance-dialogue');
		expect(consentMessages[2]).toContain('Workflow: detect-beats-tempo');
		expect(consentMessages[2]).toContain('Outputs: beat-grid, beat-labels, tempo-map-diff');
		await expect.poll(() => milestone7FixtureSnapshot(page).then(({ progressEvents }) =>
			progressEvents)).toBe(3);
		expect(errors).toEqual([]);
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
	});

	test('publishes OCR indexes, jumps from search, and keeps crop proposals editable', async ({ page }) => {
		test.setTimeout(240_000);
		const { editor, assistance, guided, errors } = await openGuidedVideoFixture(page);
		acceptConsentDialogs(page);

		await selectWorkflow(guided, 'Index Video');
		await expect(guided.getByRole('checkbox', {
			name: 'Index visible text with PP-OCR', exact: true,
		})).toBeChecked();
		let review = await runSelectedAndReview(page, guided);
		const videoIndex = review.getByRole('checkbox', { name: '1 video index rows', exact: true });
		await expect(videoIndex).not.toBeChecked();
		await videoIndex.check();
		await guided.getByRole('button', { name: 'Accept selected', exact: true }).click();
		await expect(guided.getByRole('status')).toHaveText('The proposal was accepted.');
		await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(assistance).toBeHidden();

		await chooseCommandAction(page, editor, 'Analyze', 'Indexed Search…');
		const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
		await expect(search).toBeFocused();
		await search.fill('Launch Plan');
		const result = editor.locator('[data-editor-search-option][data-editor-search-kind="assistance"]')
			.filter({ hasText: 'OCR: Launch Plan' });
		await expect(result).toBeVisible();
		await result.click();
		await expect(editor.getByRole('slider', { name: 'Playhead', exact: true }))
			.toHaveAttribute('aria-valuenow', '12000');
		await expect.poll(() => milestone7FixtureSnapshot(page).then(({ queryCalls }) => queryCalls))
			.toBeGreaterThan(0);

		await reselectTimelineVideo(editor, page);
		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		const reopened = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
		const reopenedGuided = reopened.getByRole('tabpanel', { name: 'Guided', exact: true });
		review = await runAndReview(page, reopenedGuided, 'Reframe');
		await expect(review).toContainText('Target aspect: 9:16');
		await expect(review.getByRole('checkbox', { name: 'Reframe crop path', exact: true }))
			.not.toBeChecked();
		const reframePosition = review.getByRole('slider', {
			name: 'Horizontal position', exact: true,
		});
		await reframePosition.fill('0.2');
		await expect(reframePosition).toHaveValue('0.2');

		review = await runAndReview(page, reopenedGuided, 'Make Highlights');
		await expect(review.getByRole('checkbox', { name: 'Highlight 1', exact: true }))
			.not.toBeChecked();
		const proposal = review.getByRole('article', { name: 'Highlight proposal 1', exact: true });
		await expect(review.getByRole('group', { name: 'Transport preview', exact: true }))
			.toHaveCount(0);
		await proposal.getByRole('button', { name: 'Preview Highlight 1', exact: true }).click();
		const preview = review.getByRole('group', { name: 'Transport preview', exact: true });
		const previewVideo = preview.locator('video');
		await expect(previewVideo).toHaveCount(1);
		await expect(preview).toHaveAttribute('data-highlight-proposal-id', 'highlight-a');
		await expect(preview).toHaveAttribute('data-preview-source-start-frame', '0');
		const initialEndSeconds = Number(await preview.getAttribute('data-preview-end-seconds'));
		expect(initialEndSeconds).toBeGreaterThan(0);
		await expect.poll(() => previewVideo.evaluate((video) => video.currentTime))
			.toBeCloseTo(Number(await preview.getAttribute('data-preview-start-seconds')), 3);
		const title = proposal.getByRole('textbox', { name: 'Title', exact: true });
		await title.fill('Edited launch title');
		await title.press('Tab');
		await expect(title).toHaveValue('Edited launch title');
		const end = proposal.getByRole('group', { name: 'End frame', exact: true })
			.locator('..').locator('[data-timecode-direct-entry]');
		await end.fill('41000');
		await end.press('Tab');
		await expect(end).toHaveValue('40000');
		await expect(proposal).toContainText('Preview range: 0–40000');
		await expect(preview).toHaveAttribute('data-preview-source-end-frame', '12');
		const { highlightSourceTimeRows } = await milestone7FixtureSnapshot(page);
		expect(highlightSourceTimeRows.some(({ timelineFrame }) => timelineFrame === 41_000))
			.toBe(false);
		expect(highlightSourceTimeRows.find(({ timelineFrame }) => timelineFrame === 40_000))
			.toMatchObject({ sourceFrame: 12 });
		const editedEndSeconds = Number(await preview.getAttribute('data-preview-end-seconds'));
		expect(editedEndSeconds).toBeLessThan(initialEndSeconds);
		const highlightPosition = proposal.getByRole('slider', {
			name: 'Horizontal position', exact: true,
		}).first();
		await highlightPosition.fill('0.2');
		await expect(highlightPosition).toHaveValue('0.2');
		await expect(preview.getByLabel('Highlight crop preview', { exact: true }))
			.toHaveAttribute('data-crop-left', '0.2');
		const stopped = await previewVideo.evaluate((video, endSeconds) => {
			video.currentTime = endSeconds;
			video.dispatchEvent(new Event('timeupdate'));
			return { paused: video.paused, currentTime: video.currentTime };
		}, editedEndSeconds);
		expect(stopped.paused).toBe(true);
		expect(stopped.currentTime).toBeCloseTo(editedEndSeconds, 3);
		expect(errors).toEqual([]);
	});
});

async function installFixture(page) {
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installMilestone7LocalAssistanceFixture(page);
	return collectClientErrors(page);
}

async function openGuidedLinkedFixture(page) {
	const errors = await installFixture(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [LINKED_AV], { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 30_000,
	});
	await reselectTimelineAudio(editor, page);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 30_000,
	});
	await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
	const assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
	const guided = assistance.getByRole('tabpanel', { name: 'Guided', exact: true });
	return { editor, assistance, guided, errors };
}

async function reselectTimelineAudio(editor, page) {
	const selectedClip = clipByName(
		editor, `${LINKED_AV.name.replace(/\.[^.]+$/u, '')} Audio`,
	);
	await expect(selectedClip).toBeVisible({ timeout: 30_000 });
	await selectedClip.focus();
	await page.keyboard.press('Enter');
	await expect(selectedClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

async function openGuidedVideoFixture(page) {
	const errors = await installFixture(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await editor.locator('[data-import-input]').setInputFiles([VIDEO]);
	const sourceName = VIDEO.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', {
		name: `Add to timeline: ${sourceName}`, exact: true,
	}).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await reselectTimelineVideo(editor, page);
	await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
	const assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
	const guided = assistance.getByRole('tabpanel', { name: 'Guided', exact: true });
	return { editor, assistance, guided, errors };
}

async function reselectTimelineVideo(editor, page) {
	const selectedClip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await expect(selectedClip).toBeVisible({ timeout: 30_000 });
	await selectedClip.focus();
	await page.keyboard.press('Enter');
	await expect(selectedClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

function acceptConsentDialogs(page) {
	const messages = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		expect(dialog.type()).toBe('confirm');
		await dialog.accept();
	});
	return messages;
}

async function selectWorkflow(guided, label) {
	await guided.getByRole('combobox', { name: 'Workflow', exact: true }).selectOption({ label });
}

async function runAndReview(page, guided, label) {
	await selectWorkflow(guided, label);
	return runSelectedAndReview(page, guided);
}

async function runSelectedAndReview(page, guided) {
	await guided.getByRole('button', { name: 'Run Guided workflow', exact: true }).click();
	const status = guided.getByRole('status');
	await expect(status).toHaveText(/running|unavailable locally/u);
	if ((await status.textContent())?.includes('unavailable')) {
		throw new Error(JSON.stringify(await milestone7FixtureSnapshot(page)));
	}
	await completeMilestone7Run(page);
	await expect(guided.getByRole('status')).toContainText('The Guided workflow completed.');
	await guided.getByRole('button', { name: 'Review result', exact: true }).click();
	const review = guided.getByRole('region', { name: 'Guided workflow review', exact: true });
	await expect(review).toBeVisible();
	return review;
}
