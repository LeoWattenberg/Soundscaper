import { expect, test, toneA, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import { bootEditor, closeWorkspacePanel, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME, SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { evaluateWithTransientBrowserRetry } from './helpers/transient-evaluation-retry.js';

// The workflow reads a Framescaper timeline and, for the legacy fallback, a
// Soundscaper project it imports at /de/ — each from its own product database.
const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';

test.describe('Framescaper canonical clip-focus trim keyboard routing', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('uses local TrackNew chords for one-frame linked A/V trims and fixed-seconds legacy audio', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const editor = await bootEditor(page, '/framescaper/de/');
		await setNtscSequenceRate(page, editor);
		await importAvFixture(editor, 'canonical-keyboard.webm');

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await expect.poll(() => persistedTimeline(page, projectId), { timeout: 30_000 }).not.toBeNull();
		const baseline = await persistedTimeline(page, projectId);
		expect(baseline.sequence.rate).toEqual({ num: 30_000, den: 1_001 });
		expect(baseline.video).not.toBeNull();
		expect(baseline.audio).not.toBeNull();
		expect(baseline.video.avLinkId).toBe(baseline.audio.avLinkId);
		expect(baseline.video.sequenceFrameCount).toBeGreaterThan(8);
		assertLinkedEndpoints(baseline);

		// No shortcut is surfaced as chrome or registered globally; these remain
		// local callbacks on the focusable vendored audio clip group.
		await expect(editor.getByRole('button', { name: /(?:trim|strecken).*kante/i })).toHaveCount(0);
		await expect(editor.locator('[data-clip-focus-trim-keyboard]')).toHaveCount(0);
		expect(await page.locator('[aria-keyshortcuts*="Shift+Arrow"]').count()).toBe(0);

		const audioGroup = editor.locator(`[data-clip-id="${baseline.audio.id}"][role="group"]`);
		await expect(audioGroup).toHaveCount(1);
		await focusLinkedAudio(audioGroup);

		// Rate stretch uses four vendored combinations. Start it from a pristine
		// source range, because edge trim deliberately changes the source cut.
		for (const row of [
			{ key: 'Control+Alt+Shift+ArrowRight', operation: 'stretch', edge: 'left', direction: 'inward' },
			{ key: 'Alt+Shift+ArrowLeft', operation: 'stretch', edge: 'left', direction: 'outward' },
			{ key: 'Control+Alt+Shift+ArrowLeft', operation: 'stretch', edge: 'right', direction: 'inward' },
			{ key: 'Alt+Shift+ArrowRight', operation: 'stretch', edge: 'right', direction: 'outward' },
		]) {
			await assertCanonicalKeyboardStep(page, editor, projectId, audioGroup, row);
		}

		// These are every real TrackNew trim chord. Pairing an inward step with the
		// corresponding outward step keeps the fixture source-valid while proving
		// both edge/direction classes on an NTSC point-rounded sequence grid.
		let finalTrimStep;
		for (const row of [
			{ key: 'Control+Shift+ArrowRight', operation: 'trim', edge: 'left', direction: 'inward' },
			{ key: 'Shift+ArrowLeft', operation: 'trim', edge: 'left', direction: 'outward' },
			{ key: 'Control+Shift+ArrowLeft', operation: 'trim', edge: 'right', direction: 'inward' },
			{ key: 'Shift+ArrowRight', operation: 'trim', edge: 'right', direction: 'outward' },
		]) {
			finalTrimStep = await assertCanonicalKeyboardStep(page, editor, projectId, audioGroup, row);
		}
		await focusLinkedAudio(audioGroup);
		await audioGroup.press('Shift+ArrowLeft');
		await expect.poll(() => persistedTimeline(page, projectId)).toEqual(finalTrimStep.after);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'info');
		await clickHistory(editor, 'Rückgängig');
		await expect.poll(() => persistedTimeline(page, projectId)).toEqual(finalTrimStep.before);
		await clickHistory(editor, 'Wiederholen');
		await expect.poll(() => persistedTimeline(page, projectId)).toEqual(finalTrimStep.after);

		// Lock the video companion, not the focused audio. A legacy fallback would
		// still mutate the unlocked audio, so this proves canonical refusal routing.
		const current = await persistedTimeline(page, projectId);
		await selectClip(editor, current.video.id);
		await chooseTrackMenuAction(
			page, editor,
			editor.locator(`[data-track-row][data-track-id="${current.video.trackId}"]`),
			'Spur sperren',
		);
		await expect.poll(async () => (
			(await persistedTimeline(page, projectId)).tracks
				.find(({ id }) => id === current.video.trackId)?.locked
		)).toBe(true);
		const locked = await persistedTimeline(page, projectId);
		expect(locked.tracks.find(({ id }) => id === locked.video.trackId)?.locked).toBe(true);
		await focusLinkedAudio(audioGroup);
		await audioGroup.press('Control+Shift+ArrowRight');
		await expect.poll(() => persistedTimeline(page, projectId)).toEqual(locked);
		// There was no keyboard history entry: one Undo removes the lock itself.
		await clickHistory(editor, 'Rückgängig');
		await expect.poll(() => persistedTimeline(page, projectId)).toEqual(current);

		await page.goto('/de/');
		const soundscaper = await waitForEditor(page);
		// Import through the shared helper: it dismisses the project bin first, and
		// an import taken while the bin is open lands there as a source instead of
		// becoming the timeline clip this fallback assertion needs.
		await importFiles(soundscaper, [toneA]);
		const soundscaperProjectId = await soundscaper.getAttribute('data-project-id');
		expect(soundscaperProjectId).toBeTruthy();
		await expect.poll(() => persistedAudioOnlyClip(page, soundscaperProjectId), { timeout: 30_000 }).not.toBeNull();
		const legacyBefore = await persistedAudioOnlyClip(page, soundscaperProjectId);
		const legacyGroup = soundscaper.locator(`[data-clip-id="${legacyBefore.id}"][role="group"]`);
		await expect(legacyGroup).toHaveCount(1);
		await legacyGroup.focus();
		await legacyGroup.press('Control+Shift+ArrowLeft');
		await expect.poll(() => persistedAudioOnlyClip(page, soundscaperProjectId))
			.toMatchObject({
				timelineStartFrame: legacyBefore.timelineStartFrame,
				durationFrames: legacyBefore.durationFrames - 4_800,
			});
		const legacyAfter = await persistedAudioOnlyClip(page, soundscaperProjectId);
		expect(legacyAfter.sourceStartFrame).toBe(legacyBefore.sourceStartFrame);
		// The 44.1 kHz source is resampled into the 48 kHz project, so the fixed
		// step retires the same tenth of a second as proportionally fewer source
		// frames than timeline frames.
		const sourceFramesPerTimelineFrame = legacyBefore.sourceDurationFrames / legacyBefore.durationFrames;
		expect(legacyAfter.sourceDurationFrames)
			.toBe(legacyBefore.sourceDurationFrames - Math.round(4_800 * sourceFramesPerTimelineFrame));
	});
});

async function assertCanonicalKeyboardStep(page, editor, projectId, audioGroup, row) {
	const before = await persistedTimeline(page, projectId);
	const beforeVideo = before.video;
	const beforeAudio = before.audio;
	await focusLinkedAudio(audioGroup);
	await expect(audioGroup).toBeFocused();
	await audioGroup.press(row.key);
	await expect.poll(() => persistedTimeline(page, projectId), { timeout: 15_000 })
		.not.toEqual(before);
	const after = await persistedTimeline(page, projectId);
	const previousBoundary = row.edge === 'left'
		? beforeVideo.sequenceStartFrame
		: beforeVideo.sequenceStartFrame + beforeVideo.sequenceFrameCount;
	const expectedBoundary = previousBoundary + directionalDelta(row.edge, row.direction);
	const actualBoundary = row.edge === 'left'
		? after.video.sequenceStartFrame
		: after.video.sequenceStartFrame + after.video.sequenceFrameCount;
	expect(actualBoundary).toBe(expectedBoundary);
	assertLinkedEndpoints(after);
	await expect(audioGroup).toBeFocused();
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await expect(editor.locator('[data-status]')).toContainText(sequenceTimecode(expectedBoundary, after.sequence.rate));
	if (row.operation === 'trim') {
		expect([after.audio.sourceStartFrame, after.audio.sourceDurationFrames]).not.toEqual([
			beforeAudio.sourceStartFrame,
			beforeAudio.sourceDurationFrames,
		]);
		await expect(editor.locator('[data-status]')).toContainText(
			row.edge === 'left' ? 'Linke Kante auf' : 'Rechte Kante auf',
		);
	} else {
		expect(after.audio.sourceStartFrame).toBe(beforeAudio.sourceStartFrame);
		expect(after.audio.sourceDurationFrames).toBe(beforeAudio.sourceDurationFrames);
		await expect(editor.locator('[data-status]')).toContainText('×');
	}
	await clickHistory(editor, 'Rückgängig');
	await expect.poll(() => persistedTimeline(page, projectId)).toEqual(before);
	await clickHistory(editor, 'Wiederholen');
	await expect.poll(() => persistedTimeline(page, projectId)).toEqual(after);
	return { before, after };
}

function directionalDelta(edge, direction) {
	if (direction === 'outward') return edge === 'left' ? -1 : 1;
	return edge === 'left' ? 1 : -1;
}

async function setNtscSequenceRate(page, editor) {
	await editor.getByRole('button', { name: 'Sequenz-Timing', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Sequenz-Timing', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('combobox', { name: 'Bildrate', exact: true }).selectOption('30000/1001');
	await page.keyboard.press('Escape');
}

async function importAvFixture(editor, name) {
	if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await closeWorkspacePanel(editor, 'project-bin');
	await editor.locator('[data-import-input]').setInputFiles([createDeterministicAvFixture(name)]);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 60_000 });
}

async function focusLinkedAudio(group) {
	await group.focus();
	await expect(group).toBeFocused();
}

async function selectClip(editor, clipId) {
	const group = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await group.focus();
	await group.press('Enter');
	await expect(group.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

function assertLinkedEndpoints(timing) {
	expect(timing.audio.timelineStartFrame).toBe(sampleAtSequenceFrame(timing, timing.video.sequenceStartFrame));
	expect(timing.audio.durationFrames).toBe(sampleAtSequenceFrame(
		timing,
		timing.video.sequenceStartFrame + timing.video.sequenceFrameCount,
	) - timing.audio.timelineStartFrame);
}

function sampleAtSequenceFrame(timing, frame) {
	return roundPoint(frame * timing.sampleRate * timing.sequence.rate.den, timing.sequence.rate.num);
}

function roundPoint(numerator, denominator) {
	const quotient = Math.trunc(numerator / denominator);
	const remainder = numerator - quotient * denominator;
	return Math.abs(remainder) * 2 >= denominator ? quotient + Math.sign(numerator) : quotient;
}

function sequenceTimecode(frame, rate) {
	const framesPerSecond = Math.ceil(rate.num / rate.den);
	return [
		Math.floor(frame / (framesPerSecond * 3_600)),
		Math.floor(frame / (framesPerSecond * 60)) % 60,
		Math.floor(frame / framesPerSecond) % 60,
		frame % framesPerSecond,
	].map((value) => String(value).padStart(2, '0')).join(':');
}

async function persistedTimeline(page, projectId) {
	const timing = await evaluateWithTransientBrowserRetry(page, async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction(['projects'], 'readonly').objectStore('projects').get(id));
			const video = project?.clips?.find(({ kind }) => kind === 'video');
			const audio = project?.clips?.find(({ kind, avLinkId }) => kind === 'audio' && avLinkId === video?.avLinkId);
			const sequence = project?.sequences?.find(({ id: sequenceId }) => sequenceId === video?.sequenceId);
			if (!project || !video || !audio || !sequence) return null;
			const trackByClipId = new Map(project.tracks.flatMap((track) => (
				(track.clipIds || []).map((clipId) => [clipId, track.id])
			)));
			return {
				sampleRate: project.sampleRate,
				sequence: { id: sequence.id, rate: sequence.rate },
				video: {
					id: video.id, trackId: trackByClipId.get(video.id), avLinkId: video.avLinkId,
					sequenceStartFrame: video.sequenceStartFrame, sequenceFrameCount: video.sequenceFrameCount,
					sourceInFrame: video.sourceInFrame, sourceFrameCount: video.sourceFrameCount,
				},
				audio: {
					id: audio.id, trackId: trackByClipId.get(audio.id), avLinkId: audio.avLinkId,
					timelineStartFrame: audio.timelineStartFrame, durationFrames: audio.durationFrames,
					sourceStartFrame: audio.sourceStartFrame, sourceDurationFrames: audio.sourceDurationFrames,
				},
				tracks: project.tracks.map(({ id: trackId, locked }) => ({ id: trackId, locked })),
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId });
	return timing;
}

async function persistedAudioOnlyClip(page, projectId) {
	return evaluateWithTransientBrowserRetry(page, async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction(['projects'], 'readonly').objectStore('projects').get(id));
			const clip = project?.clips?.find(({ kind }) => kind === 'audio');
			if (!clip) return null;
			return {
				id: clip.id,
				timelineStartFrame: clip.timelineStartFrame,
				durationFrames: clip.durationFrames,
				sourceStartFrame: clip.sourceStartFrame,
				sourceDurationFrames: clip.sourceDurationFrames,
			};
		} finally {
			database.close();
		}
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}
