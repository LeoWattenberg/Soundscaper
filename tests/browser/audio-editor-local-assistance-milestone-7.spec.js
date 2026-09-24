import { openAssistanceTask } from './helpers/assistance-task-menu.js';
/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
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
		await expect(guided.getByRole('button', { name: 'Apply selected', exact: true })).toBeDisabled();
		await captions.check();
		await guided.getByRole('button', { name: 'Apply selected', exact: true }).click();
		await expect(guided.getByRole('status', { name: 'Processing status' })).toHaveText('The proposal was accepted.');
		await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(assistance).toBeHidden();
		await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(1);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
		await reselectTimelineAudio(editor, page);
		await openAssistanceTask(page, editor, 'Transcribe & Captions');
		assistance = page.locator('[data-local-assistance]');
		guided = assistance;

		review = await runAndReview(page, guided, 'Enhance Dialogue');
		await expect(review.locator('label', { hasText: 'Original selection' }).locator('audio'))
			.toHaveCount(1);
		await expect(review.locator('label', { hasText: 'Enhanced dialogue' }).locator('audio'))
			.toHaveCount(1);
		await expect(review.getByRole('checkbox', { name: 'Enhanced Dialogue', exact: true }))
			.not.toBeChecked();

		review = await runAndReview(page, guided, 'Reduce Reverb');
		await expect(review.locator('label', { hasText: 'Original selection' }).locator('audio'))
			.toHaveCount(1);
		await expect(review.locator('label', { hasText: 'Reduced reverb' }).locator('audio'))
			.toHaveCount(1);
		await expect(review.getByRole('checkbox', { name: 'Reduced Reverb', exact: true }))
			.not.toBeChecked();

		await selectWorkflow(page, guided, 'Detect Beats & Tempo');
		const beatLabels = guided.getByRole('checkbox', {
			name: 'Add a Beats label track', exact: true,
		});
		const tempoMap = guided.getByRole('checkbox', {
			name: 'Update the project tempo map', exact: true,
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

		expect(consentMessages).toHaveLength(4);
		expect(consentMessages[0]).toContain('Workflow: transcribe-captions');
		expect(consentMessages[0]).toContain(
			'Stages: detect-speech, recognize-speech, assemble-captions',
		);
		expect(consentMessages[1]).toContain('Workflow: enhance-dialogue');
		expect(consentMessages[2]).toContain('Workflow: reduce-reverb');
		expect(consentMessages[2]).toContain('Models: dereverb-room@1.0.0');
		expect(consentMessages[2]).toContain('Outputs: dereverberated-audio');
		expect(consentMessages[3]).toContain('Workflow: detect-beats-tempo');
		expect(consentMessages[3]).toContain('Outputs: beat-grid, beat-labels, tempo-map-diff');
		await expect.poll(() => milestone7FixtureSnapshot(page).then(({ progressEvents }) =>
			progressEvents)).toBe(4);
		expect(errors).toEqual([]);
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
	});

	test('auditions cleanup ranges and keeps separated stem choices atomic', async ({ page }) => {
		test.setTimeout(180_000);
		const { guided, errors } = await openGuidedLinkedFixture(page);
		acceptConsentDialogs(page);

		let review = await runAndReview(page, guided, 'Clean Filler & Silence');
		const original = review.locator('label', { hasText: 'Original selection' }).locator('audio');
		await expect(original).toHaveAttribute('data-skip-range-count', '0');
		await expect(original).toHaveAttribute('src', /^blob:/u);
		const originalSource = await original.getAttribute('src');
		const cleanup = review.getByRole('checkbox', { name: 'Cleanup edit 1', exact: true });
		await cleanup.check();
		await expect(original).toHaveAttribute('data-skip-range-count', '1');
		await expect.poll(() => original.getAttribute('src')).not.toBe(originalSource);
		await cleanup.uncheck();
		await expect(original).toHaveAttribute('data-skip-range-count', '0');
		await expect(review).toContainText(
			'Audition skips checked ranges without changing the project.',
		);

		review = await runAndReview(page, guided, 'Separate Dialogue / Music / Effects');
		await expect(review.locator('audio')).toHaveCount(4);
		const stems = ['Dialogue', 'Music', 'Effects'].map((name) => (
			review.getByRole('checkbox', { name, exact: true })
		));
		for (const stem of stems) await expect(stem).not.toBeChecked();
		await stems[0].check();
		for (const stem of stems) await expect(stem).toBeChecked();
		await stems[2].uncheck();
		for (const stem of stems) await expect(stem).not.toBeChecked();
		expect(errors).toEqual([]);
	});

	test('renders authenticated editorial fields from an accepted transcript', async ({ browserName, page }) => {
		test.skip(
			browserName === 'firefox',
			'Playwright Firefox cannot reopen the accepted transcript body from the browser media repository.',
		);
		test.setTimeout(180_000);
		const { guided, errors } = await openGuidedLinkedFixture(page);
		acceptConsentDialogs(page);

		let review = await runAndReview(page, guided, 'Transcribe & Captions');
		await review.getByRole('checkbox', { name: '1 caption cue', exact: true }).check();
		await guided.getByRole('button', { name: 'Apply selected', exact: true }).click();
		await expect(guided.getByRole('status', { name: 'Processing status' }))
			.toHaveText('The proposal was accepted.');

		await selectWorkflow(page, guided, 'Generate Editorial Text');
		await guided.getByRole('checkbox', {
			name: 'Generate text suggestions', exact: true,
		}).check();
		review = await runSelectedAndReview(page, guided);
		const proposal = review.getByRole('article', { name: 'Editorial proposal 1', exact: true });
		await expect(proposal.getByRole('heading', { name: 'Launch plan in one minute' }))
			.toBeVisible();
		await expect(proposal).toContainText('Start with the decision.');
		await expect(proposal.getByRole('listitem')).toHaveText(['Opening', 'Payoff']);
		await expect(proposal).toContainText(
			'The authenticated transcript supports this structure.',
		);
		await expect(review.getByRole('checkbox', { name: 'Editorial text 1', exact: true }))
			.not.toBeChecked();
		expect(errors).toEqual([]);
	});

	test('publishes OCR indexes, jumps from search, and keeps crop proposals editable', async ({ page }) => {
		test.setTimeout(240_000);
		const { editor, assistance, guided, errors } = await openGuidedVideoFixture(page);
		acceptConsentDialogs(page);

		await selectWorkflow(page, guided, 'Index Video');
		await expect(guided.getByRole('checkbox', {
			name: 'Include visible text', exact: true,
		})).toBeChecked();
		let review = await runSelectedAndReview(page, guided);
		const videoIndex = review.getByRole('checkbox', { name: '1 video index rows', exact: true });
		await expect(videoIndex).not.toBeChecked();
		await videoIndex.check();
		await guided.getByRole('button', { name: 'Apply selected', exact: true }).click();
		await expect(guided.getByRole('status', { name: 'Processing status' })).toHaveText('The proposal was accepted.');
		await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(assistance).toBeHidden();

		await chooseNestedCommandAction(page, editor, 'Tools', ['Search', 'Indexed Search…']);
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
		await openAssistanceTask(page, editor, 'Transcribe & Captions');
		const reopened = page.locator('[data-local-assistance]');
		const reopenedGuided = reopened;
		review = await runAndReview(page, reopenedGuided, 'Reframe');
		await expect(review).toContainText('Target aspect: 9:16');
		await expect(review.getByRole('checkbox', { name: 'Reframe crop path', exact: true }))
			.not.toBeChecked();
		const reframePosition = review.getByRole('slider', {
			name: 'Horizontal position', exact: true,
		});
		await reframePosition.fill('0.2');
		await expect(reframePosition).toHaveValue('0.2');
		const reframeVertical = review.getByRole('slider', {
			name: 'Vertical position', exact: true,
		});
		await reframeVertical.fill('0.05');
		await expect(reframeVertical).toHaveValue('0.05');
		await expect(review).toContainText('Keyframe 1 / 2');
		await review.getByRole('button', { name: 'Next keyframe', exact: true }).click();
		await expect(review).toContainText('Keyframe 2 / 2');
		await review.getByRole('button', { name: 'Previous keyframe', exact: true }).click();
		await expect(review).toContainText('Keyframe 1 / 2');

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
		await seekVideo(previewVideo, editedEndSeconds + 0.01);
		await expect.poll(() => previewVideo.evaluate((video) => video.currentTime))
			.toBeCloseTo(editedEndSeconds, 3);

		const speechless = review.getByRole('article', {
			name: 'Highlight proposal 2', exact: true,
		});
		await expect(speechless).toContainText('Speechless footage');
		await expect(speechless).toContainText('A silent product reveal.');
		await expect(speechless.getByText('Hook:', { exact: true })).toHaveCount(0);
		await speechless.getByRole('button', { name: 'Preview Highlight 2', exact: true }).click();
		await expect(preview).toHaveAttribute('data-highlight-proposal-id', 'highlight-b');
		const speechlessStart = Number(await preview.getAttribute('data-preview-start-seconds'));
		const speechlessEnd = Number(await preview.getAttribute('data-preview-end-seconds'));
		expect(speechlessStart).toBeGreaterThan(0);
		await seekVideo(previewVideo, speechlessEnd);
		const restartedAt = await previewVideo.evaluate(async (video, startSeconds) => {
			let stopWaiting = () => {};
			const restart = new Promise((resolve, reject) => {
				const onSeeking = () => {
					// Chromium may seek to zero before replaying a video at its end.
					if (video.currentTime < startSeconds) return;
					stopWaiting();
					resolve(video.currentTime);
				};
				const timeout = setTimeout(() => reject(new Error('Highlight playback did not seek to its start.')), 5_000);
				stopWaiting = () => {
					clearTimeout(timeout);
					video.removeEventListener('seeking', onSeeking);
				};
				video.addEventListener('seeking', onSeeking);
			});
			try {
				await video.play();
				return await restart;
			} finally {
				stopWaiting();
				video.pause();
			}
		}, speechlessStart);
		expect(restartedAt).toBeCloseTo(speechlessStart, 3);
		await expect(previewVideo).toHaveJSProperty('paused', true);
		await seekVideo(previewVideo, speechlessStart - 0.01);
		await expect.poll(() => previewVideo.evaluate((video) => video.currentTime))
			.toBeCloseTo(speechlessStart, 2);
		const vertical = speechless.getByRole('slider', {
			name: 'Vertical position', exact: true,
		}).first();
		await vertical.fill('0.05');
		await expect(vertical).toHaveValue('0.05');
		const overlay = speechless.getByLabel('Draggable crop overlay', { exact: true }).first();
		const beforeDrag = await speechless.getByRole('slider', {
			name: 'Horizontal position', exact: true,
		}).first().inputValue();
		const bounds = await overlay.boundingBox();
		expect(bounds).not.toBeNull();
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.55,
			{ steps: 3 });
		await page.mouse.up();
		await expect.poll(() => speechless.getByRole('slider', {
			name: 'Horizontal position', exact: true,
		}).first().inputValue()).not.toBe(beforeDrag);
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
	await openAssistanceTask(page, editor, 'Transcribe & Captions');
	const assistance = page.locator('[data-local-assistance]');
	const guided = assistance;
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
	await editor.locator('[data-project-bin-input]').setInputFiles([VIDEO]);
	const sourceName = VIDEO.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', {
		name: `Add to timeline: ${sourceName}`, exact: true,
	}).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await reselectTimelineVideo(editor, page);
	await openAssistanceTask(page, editor, 'Transcribe & Captions');
	const assistance = page.locator('[data-local-assistance]');
	const guided = assistance;
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

async function selectWorkflow(page, guided, label) {
	await guided.locator('button').filter({ hasText: /^Close$/u }).click();
	await openAssistanceTask(page, page.locator('[data-audio-editor]'), label);
}

async function runAndReview(page, guided, label) {
	await selectWorkflow(page, guided, label);
	return runSelectedAndReview(page, guided);
}

async function runSelectedAndReview(page, guided) {
	const run = guided.getByRole('button', { name: 'Run locally', exact: true });
	await expect(run).toBeEnabled();
	await run.click();
	const status = guided.getByRole('status', { name: 'Processing status' });
	await expect(status).toHaveText(/Processing selected media|unavailable locally/u);
	if ((await status.textContent())?.includes('unavailable')) {
		throw new Error(JSON.stringify(await milestone7FixtureSnapshot(page)));
	}
	await completeMilestone7Run(page);
	await expect(guided.getByRole('status', { name: 'Processing status' })).toContainText('Processing finished.');
	await guided.getByRole('button', { name: 'Review result', exact: true }).click();
	const review = guided.getByRole('region', { name: 'Guided workflow review', exact: true });
	await expect(review).toBeVisible();
	return review;
}

async function seekVideo(video, currentTime) {
	await video.evaluate(async (element, target) => {
		element.pause();
		await new Promise((resolve) => {
			element.addEventListener('seeked', resolve, { once: true });
			element.currentTime = target;
		});
	}, currentTime);
}
