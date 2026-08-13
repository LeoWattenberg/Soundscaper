import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	getMenuItem,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const DATABASE_NAME = 'kw-media-audio-editor';
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';
const LABELS = Object.freeze({
	rollLeft: 'Linke Kante bis zur Abspielposition rollen',
	rollRight: 'Rechte Kante bis zur Abspielposition rollen',
	rippleLeft: 'Linke Kante bis zur Abspielposition mit Lücke trimmen',
	rippleRight: 'Rechte Kante bis zur Abspielposition mit Lücke trimmen',
});
const MENU_ROWS = Object.freeze([
	{ mode: 'roll', edge: 'left', label: LABELS.rollLeft, delta: 1 },
	{ mode: 'roll', edge: 'right', label: LABELS.rollRight, delta: -1 },
	{ mode: 'ripple', edge: 'left', label: LABELS.rippleLeft, delta: 1 },
	{ mode: 'ripple', edge: 'right', label: LABELS.rippleRight, delta: -1 },
]);

test.describe('Framescaper frame-canonical roll and ripple trim qualification', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('menus and modified handles edit one linked A/V timeline transactionally', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const errors = collectClientErrors(page);
		const fixture = createDeterministicAvFixture('framescaper-roll-ripple.webm');
		const editor = await bootEditor(page, '/framescaper/de/');
		await setNtscSequenceRate(page, editor);
		await createContiguousMarkedEdits(page, editor, fixture);

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const baseline = await persistedTimeline(page, projectId);
		expect(baseline.sequence.rate).toEqual({ num: 30_000, den: 1_001 });
		expect(baseline.videos).toHaveLength(3);
		expect(baseline.audios).toHaveLength(3);
		assertContiguousLinkedPresentation(baseline);
		const active = baseline.videos[1];
		const left = baseline.videos[0];
		const right = baseline.videos[2];
		expect(left.sequenceStartFrame + left.sequenceFrameCount).toBe(active.sequenceStartFrame);
		expect(active.sequenceStartFrame + active.sequenceFrameCount).toBe(right.sequenceStartFrame);
		expect(active.sourceInFrame).toBeGreaterThan(0);
		expect(active.sourceFrameCount).toBeGreaterThan(2);
		await selectVideoClip(editor, active.id);

		// The feature is opt-in through the existing menu and existing trim handles.
		await expect(editor.getByRole('button', { name: rollRippleLabelPattern() })).toHaveCount(0);
		await expect(editor.locator('[data-roll-ripple-trim-guide]')).toHaveCount(0);

		for (const [index, row] of MENU_ROWS.entries()) {
			const boundary = requestedBoundary(active, row.edge, row.delta);
			await setProgramFrame(editor, baseline, boundary);
			await activateClipBoundaryByKeyboard(page, editor, row.label);
			const expected = applyRollRipple(baseline, active.id, row.mode, row.edge, row.delta);
			await expectPersistedTimeline(page, projectId, expected);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			await expect(editor.locator('[data-status]')).toContainText(
				expectedGermanStatus(baseline, active, row.mode, row.edge, row.delta),
			);
			assertContiguousLinkedPresentation(expected);

			await clickHistory(editor, 'Rückgängig');
			await expectPersistedTimeline(page, projectId, baseline);
			if (index === 0) {
				await clickHistory(editor, 'Wiederholen');
				await expectPersistedTimeline(page, projectId, expected);
				await clickHistory(editor, 'Rückgängig');
				await expectPersistedTimeline(page, projectId, baseline);
			}
			await selectVideoClip(editor, active.id);
		}

		await dragTrimHandle(page, editor, baseline, active, 'left', active.sequenceStartFrame + 2, ['Alt']);
		const rolled = applyRollRipple(baseline, active.id, 'roll', 'left', 2);
		await expectPersistedTimeline(page, projectId, rolled);
		await expect(editor.locator('[data-status]')).toContainText(
			expectedGermanStatus(baseline, active, 'roll', 'left', 2),
		);
		await clickHistory(editor, 'Rückgängig');
		await expectPersistedTimeline(page, projectId, baseline);
		await selectVideoClip(editor, active.id);

		await dragTrimHandle(
			page,
			editor,
			baseline,
			active,
			'right',
			active.sequenceStartFrame + active.sequenceFrameCount - 2,
			['Alt', 'Shift'],
		);
		const rippled = applyRollRipple(baseline, active.id, 'ripple', 'right', -2);
		await expectPersistedTimeline(page, projectId, rippled);
		await expect(editor.locator('[data-status]')).toContainText(
			expectedGermanStatus(baseline, active, 'ripple', 'right', -2),
		);
		await clickHistory(editor, 'Rückgängig');
		await expectPersistedTimeline(page, projectId, baseline);
		await selectVideoClip(editor, active.id);

		// A handle without modifiers keeps the pre-existing ordinary trim route.
		await dragTrimHandle(
			page,
			editor,
			baseline,
			active,
			'right',
			active.sequenceStartFrame + active.sequenceFrameCount - 2,
			[],
			{ guide: false },
		);
		const ordinary = applyOrdinaryTrim(baseline, active.id, 'right', -2);
		await expectPersistedTimeline(page, projectId, ordinary);
		await expect(editor.locator('[data-status]')).toContainText(
			`Rechte Kante auf ${sequenceTimecode(
				active.sequenceStartFrame + active.sequenceFrameCount - 2,
				baseline.sequence.rate,
			)} getrimmt.`,
		);
		await clickHistory(editor, 'Rückgängig');
		await expectPersistedTimeline(page, projectId, baseline);
		await selectVideoClip(editor, active.id);

		// Persisted track authority disables every menu route and refuses the pointer route.
		await setProgramFrame(editor, baseline, active.sequenceStartFrame + 1);
		await chooseCommandAction(page, editor, 'Spuren', 'Spur sperren');
		const locked = withTrackLock(baseline, active.trackId, true);
		await expectPersistedTimeline(page, projectId, locked);
		const boundaries = await openClipBoundariesByKeyboard(page, editor);
		for (const row of MENU_ROWS) await expect(getMenuItem(boundaries, row.label)).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await dragTrimHandle(
			page,
			editor,
			locked,
			active,
			'left',
			active.sequenceStartFrame + 2,
			['Alt'],
			{ guide: false },
		);
		await expectPersistedTimeline(page, projectId, locked);
		await expect(editor.locator('[data-roll-ripple-trim-guide]')).toHaveCount(0);

		await page.goto('/de/');
		const soundscaper = await waitForEditor(page);
		const soundscaperBoundaries = await openClipBoundariesByKeyboard(page, soundscaper);
		for (const row of MENU_ROWS) await expect(getMenuItem(soundscaperBoundaries, row.label)).toHaveCount(0);
		await expect(soundscaper.getByRole('button', { name: rollRippleLabelPattern() })).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

async function createContiguousMarkedEdits(page, editor, fixture) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	await expect(projectBin).toBeVisible();
	await projectBin.getByRole('button', { name: 'Schließen: Projektablage', exact: true }).click();
	await expect(projectBin).toBeHidden();
	await editor.locator('[data-import-input]').setInputFiles([fixture]);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 60_000 });
	await expect.poll(() => persistedClips(page, 'timeline'), { timeout: 30_000 }).toHaveLength(2);
	const importedVideo = editor.getByRole('group', { name: /^Videoclip:/u });
	await expect(importedVideo).toHaveCount(1);
	await importedVideo.click({ button: 'right' });
	const clipMenu = page.locator('.audio-editor-clip-context-menu');
	await expect(clipMenu).toBeVisible();
	await getMenuItem(clipMenu, 'In die Projektablage verschieben').click();
	await expect.poll(() => persistedClips(page, 'bin'), { timeout: 30_000 }).toHaveLength(2);
	await expect.poll(() => persistedClips(page, 'timeline'), { timeout: 30_000 }).toHaveLength(0);
	await expect(projectBin).toBeVisible();
	const name = fixture.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', { name: `Zur Zeitleiste hinzufügen: ${name}`, exact: true }).click();
	await expect.poll(() => persistedClips(page, 'timeline'), { timeout: 30_000 }).toHaveLength(2);

	await page.locator('[data-bin-action="source-monitor"]').first().click();
	const monitor = page.locator('[data-source-monitor]');
	await expect(monitor).toBeVisible();
	const maximum = Number(await page.locator('[data-source-monitor-scrub]').getAttribute('max'));
	expect(maximum).toBeGreaterThanOrEqual(7);
	await scrubSourceMonitor(page, 2);
	await page.locator('[data-source-monitor-action="mark-in"]').click();
	await scrubSourceMonitor(page, maximum - 2);
	await page.locator('[data-source-monitor-action="mark-out"]').click();
	await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '2');
	await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', String(maximum - 1));

	await setProgramFrameFromRate(editor, 0, await persistedSequenceRate(page));
	await page.locator('[data-bin-action="overwrite"]').first().click();
	await expect.poll(() => persistedClips(page, 'timeline'), { timeout: 30_000 }).toHaveLength(4);
	await page.locator('[data-bin-action="insert"]').first().click();
	await expect.poll(() => persistedClips(page, 'timeline'), { timeout: 30_000 }).toHaveLength(6);
}

async function setNtscSequenceRate(page, editor) {
	await editor.getByRole('button', { name: 'Sequenz-Timing', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Sequenz-Timing', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('combobox', { name: 'Bildrate', exact: true }).selectOption('30000/1001');
	await expect(dialog.locator('[data-sequence-rate]')).toHaveAttribute('data-sequence-rate', '30000/1001');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
}

async function scrubSourceMonitor(page, frame) {
	await page.locator('[data-source-monitor-scrub]').fill(String(frame));
	await expect(page.locator('[data-source-monitor]'))
		.toHaveAttribute('data-source-monitor-frame', String(frame));
}

async function selectVideoClip(editor, clipId) {
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

async function activateClipBoundaryByKeyboard(page, editor, label) {
	const boundaries = await openClipBoundariesByKeyboard(page, editor);
	const item = getMenuItem(boundaries, label);
	await expect(item).toBeEnabled();
	await item.focus();
	await page.keyboard.press('Enter');
}

async function openClipBoundariesByKeyboard(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Anwendungsmenü', exact: true });
	const edit = menubar.getByRole('menuitem', { name: 'Bearbeiten', exact: true });
	await edit.focus();
	await page.keyboard.press('Enter');
	const editMenu = page.getByRole('menu', { name: 'Bearbeiten', exact: true });
	await expect(editMenu).toBeVisible();
	const boundariesItem = getMenuItem(editMenu, 'Clip-Grenzen');
	await boundariesItem.focus();
	await page.keyboard.press('ArrowRight');
	const boundaries = boundariesItem.getByRole('menu');
	await expect(boundaries).toBeVisible();
	return boundaries;
}

async function dragTrimHandle(page, editor, timing, clip, edge, targetFrame, modifiers, options = {}) {
	const group = editor.locator(`[data-clip-id="${clip.id}"][role="group"]`);
	const handle = group.locator(`.clip-display__handle--trim-${edge}`);
	const [groupBox, handleBox] = await Promise.all([group.boundingBox(), handle.boundingBox()]);
	expect(groupBox).not.toBeNull();
	expect(handleBox).not.toBeNull();
	const clipStart = sampleAtSequenceFrame(timing, clip.sequenceStartFrame);
	const clipEnd = sampleAtSequenceFrame(
		timing,
		clip.sequenceStartFrame + clip.sequenceFrameCount,
	);
	const targetX = groupBox.x + (
		sampleAtSequenceFrame(timing, targetFrame) - clipStart
	) / (clipEnd - clipStart) * groupBox.width;
	const y = handleBox.y + handleBox.height / 2;
	for (const modifier of modifiers) await page.keyboard.down(modifier);
	try {
		await page.mouse.move(handleBox.x + handleBox.width / 2, y);
		await page.mouse.down();
		await page.mouse.move(targetX, y, { steps: 4 });
		if (options.guide !== false) {
			await expect(editor.locator('[data-roll-ripple-trim-guide]')).toHaveCount(1);
		}
		await page.mouse.up();
	} finally {
		for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
	}
	await expect(editor.locator('[data-roll-ripple-trim-guide]')).toHaveCount(0);
}

async function setProgramFrame(editor, timing, sequenceFrame) {
	await setProgramFrameFromRate(editor, sequenceFrame, timing.sequence.rate);
	const expectedSample = sampleAtSequenceFrame(timing, sequenceFrame);
	await expect(editor.getByRole('slider', { name: 'Abspielposition', exact: true }))
		.toHaveAttribute('aria-valuenow', String(expectedSample));
}

async function setProgramFrameFromRate(editor, sequenceFrame, rate) {
	const timecode = sequenceTimecode(sequenceFrame, rate);
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]'))
		.toHaveAttribute('data-sequence-timecode', timecode);
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

function requestedBoundary(clip, edge, delta) {
	return edge === 'left'
		? clip.sequenceStartFrame + delta
		: clip.sequenceStartFrame + clip.sequenceFrameCount + delta;
}

function applyRollRipple(original, activeClipId, mode, edge, delta) {
	const next = structuredClone(original);
	const originalActive = original.videos.find(({ id }) => id === activeClipId);
	applyEdge(next, original, activeClipId, edge, delta);
	if (mode === 'roll') {
		const editFrame = edge === 'left'
			? originalActive.sequenceStartFrame
			: originalActive.sequenceStartFrame + originalActive.sequenceFrameCount;
		const neighbor = original.videos.find((video) => video.trackId === originalActive.trackId
			&& video.id !== activeClipId
			&& (edge === 'left'
				? video.sequenceStartFrame + video.sequenceFrameCount === editFrame
				: video.sequenceStartFrame === editFrame));
		applyEdge(next, original, neighbor.id, edge === 'left' ? 'right' : 'left', delta);
	} else if (edge === 'left') {
		const active = next.videos.find(({ id }) => id === activeClipId);
		active.sequenceStartFrame = originalActive.sequenceStartFrame;
		active.sequenceFrameCount = originalActive.sequenceFrameCount - delta;
		alignLinkedAudioPlacement(next, active);
		shiftSuffix(next, original, originalActive, -delta);
	} else {
		shiftSuffix(next, original, originalActive, delta);
	}
	return sortedTimeline(next);
}

function applyOrdinaryTrim(original, activeClipId, edge, delta) {
	const next = structuredClone(original);
	applyEdge(next, original, activeClipId, edge, delta);
	return sortedTimeline(next);
}

function applyEdge(timing, original, clipId, edge, delta) {
	const source = original.videos.find(({ id }) => id === clipId);
	const video = timing.videos.find(({ id }) => id === clipId);
	const originalEndFrame = source.sequenceStartFrame + source.sequenceFrameCount;
	const sourceEndFrame = source.sourceInFrame + source.sourceFrameCount;
	const mappedSourceFrame = source.sourceInFrame + roundPoint(
		(edge === 'left' ? delta : source.sequenceFrameCount + delta) * source.sourceFrameCount,
		source.sequenceFrameCount,
	);
	if (edge === 'left') {
		video.sequenceStartFrame = source.sequenceStartFrame + delta;
		video.sequenceFrameCount = source.sequenceFrameCount - delta;
		video.sourceInFrame = mappedSourceFrame;
		video.sourceFrameCount = sourceEndFrame - mappedSourceFrame;
	} else {
		video.sequenceStartFrame = source.sequenceStartFrame;
		video.sequenceFrameCount = source.sequenceFrameCount + delta;
		video.sourceInFrame = source.sourceInFrame;
		video.sourceFrameCount = mappedSourceFrame - source.sourceInFrame;
	}
	const originalAudio = linkedAudio(original, source);
	const audio = linkedAudio(timing, video);
	const boundarySample = sampleAtSequenceFrame(
		original,
		edge === 'left' ? source.sequenceStartFrame + delta : originalEndFrame + delta,
	);
	const progress = roundPoint(
		(boundarySample - originalAudio.timelineStartFrame) * originalAudio.sourceDurationFrames,
		originalAudio.durationFrames,
	);
	const mappedAudioSource = originalAudio.sourceStartFrame + progress;
	if (edge === 'left') {
		audio.sourceStartFrame = mappedAudioSource;
		audio.sourceDurationFrames = originalAudio.sourceStartFrame
			+ originalAudio.sourceDurationFrames - mappedAudioSource;
	} else {
		audio.sourceStartFrame = originalAudio.sourceStartFrame;
		audio.sourceDurationFrames = mappedAudioSource - originalAudio.sourceStartFrame;
	}
	alignLinkedAudioPlacement(timing, video);
}

function shiftSuffix(timing, original, originalActive, frameDelta) {
	const cut = originalActive.sequenceStartFrame + originalActive.sequenceFrameCount;
	for (const source of original.videos.filter(({ sequenceStartFrame }) => sequenceStartFrame >= cut)) {
		const video = timing.videos.find(({ id }) => id === source.id);
		video.sequenceStartFrame = source.sequenceStartFrame + frameDelta;
		video.sequenceFrameCount = source.sequenceFrameCount;
		alignLinkedAudioPlacement(timing, video);
	}
}

function alignLinkedAudioPlacement(timing, video) {
	const audio = linkedAudio(timing, video);
	const start = sampleAtSequenceFrame(timing, video.sequenceStartFrame);
	const end = sampleAtSequenceFrame(
		timing,
		video.sequenceStartFrame + video.sequenceFrameCount,
	);
	audio.timelineStartFrame = start;
	audio.durationFrames = end - start;
}

function linkedAudio(timing, video) {
	const matches = timing.audios.filter(({ avLinkId }) => avLinkId === video.avLinkId);
	expect(matches).toHaveLength(1);
	return matches[0];
}

function withTrackLock(original, trackId, locked) {
	const next = structuredClone(original);
	next.tracks.find(({ id }) => id === trackId).locked = locked;
	return next;
}

function assertContiguousLinkedPresentation(timing) {
	for (const video of timing.videos) {
		const audio = linkedAudio(timing, video);
		const start = sampleAtSequenceFrame(timing, video.sequenceStartFrame);
		const end = sampleAtSequenceFrame(
			timing,
			video.sequenceStartFrame + video.sequenceFrameCount,
		);
		expect(video.avLinkId).toBeTruthy();
		expect(audio.timelineStartFrame).toBe(start);
		expect(audio.durationFrames).toBe(end - start);
	}
	for (let index = 1; index < timing.videos.length; index += 1) {
		expect(timing.videos[index - 1].sequenceStartFrame
			+ timing.videos[index - 1].sequenceFrameCount)
			.toBe(timing.videos[index].sequenceStartFrame);
	}
}

function expectedGermanStatus(timing, active, mode, edge, delta) {
	const sourceFrame = requestedBoundary(active, edge, delta);
	const programFrame = mode === 'ripple' && edge === 'left'
		? active.sequenceStartFrame + active.sequenceFrameCount - delta
		: sourceFrame;
	const prefix = mode === 'roll'
		? `${edge === 'left' ? 'Linke' : 'Rechte'} Kante um ${delta > 0 ? '+' : ''}${delta} Frames gerollt`
		: `${edge === 'left' ? 'Linke' : 'Rechte'} Kante um ${delta > 0 ? '+' : ''}${delta} Frames mit Lücke getrimmt`;
	return `${prefix}; Quellschnitt ${sequenceTimecode(sourceFrame, timing.sequence.rate)}; Programmschnitt ${sequenceTimecode(programFrame, timing.sequence.rate)}.`;
}

function sampleAtSequenceFrame(timing, frame) {
	return roundPoint(
		frame * timing.sampleRate * timing.sequence.rate.den,
		timing.sequence.rate.num,
	);
}

function roundPoint(numerator, denominator) {
	const quotient = Math.trunc(numerator / denominator);
	const remainder = numerator - quotient * denominator;
	return Math.abs(remainder) * 2 >= denominator
		? quotient + Math.sign(numerator)
		: quotient;
}

function sequenceTimecode(frame, rate) {
	const framesPerSecond = Math.ceil(rate.num / rate.den);
	const frames = frame % framesPerSecond;
	const wholeSeconds = Math.floor(frame / framesPerSecond);
	const seconds = wholeSeconds % 60;
	const wholeMinutes = Math.floor(wholeSeconds / 60);
	const minutes = wholeMinutes % 60;
	const hours = Math.floor(wholeMinutes / 60);
	return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':');
}

function rollRippleLabelPattern() {
	return new RegExp(Object.values(LABELS).map(escapePattern).join('|'), 'u');
}

function escapePattern(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectPersistedTimeline(page, projectId, expected) {
	await expect.poll(() => persistedTimeline(page, projectId)).toEqual(expected);
}

async function persistedSequenceRate(page) {
	return page.evaluate(async (databaseName) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const projects = await result(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			return projects.flatMap((project) => project.sequences || [])[0]?.rate ?? null;
		} finally {
			database.close();
		}
	}, DATABASE_NAME);
}

async function persistedClips(page, scope) {
	return page.evaluate(async ({ databaseName, where }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const projects = await result(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			return projects.flatMap((project) => (
				where === 'bin' ? project.projectBin?.clips || [] : project.clips || []
			));
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, where: scope });
}

async function persistedTimeline(page, projectId) {
	const timing = await page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction(['projects'], 'readonly').objectStore('projects').get(id),
			);
			const videos = project?.clips?.filter(({ kind }) => kind === 'video') || [];
			const sequence = project?.sequences?.find(({ id: sequenceId }) => (
				sequenceId === videos[0]?.sequenceId
			));
			if (!project || !sequence) return null;
			const trackByClipId = new Map(project.tracks.flatMap((track) => (
				(track.clipIds || []).map((clipId) => [clipId, track.id])
			)));
			return {
				sampleRate: project.sampleRate,
				sequence: { id: sequence.id, rate: sequence.rate },
				videos: videos.map((clip) => ({
					id: clip.id,
					trackId: trackByClipId.get(clip.id),
					avLinkId: clip.avLinkId,
					sequenceStartFrame: clip.sequenceStartFrame,
					sequenceFrameCount: clip.sequenceFrameCount,
					sourceInFrame: clip.sourceInFrame,
					sourceFrameCount: clip.sourceFrameCount,
				})),
				audios: project.clips.filter(({ kind }) => kind === 'audio').map((clip) => ({
					id: clip.id,
					trackId: trackByClipId.get(clip.id),
					avLinkId: clip.avLinkId,
					timelineStartFrame: clip.timelineStartFrame,
					durationFrames: clip.durationFrames,
					sourceStartFrame: clip.sourceStartFrame,
					sourceDurationFrames: clip.sourceDurationFrames,
				})),
				tracks: project.tracks.map(({ id: trackId, type, locked }) => ({
					id: trackId, type, locked,
				})),
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId });
	return timing && sortedTimeline(timing);
}

function sortedTimeline(timing) {
	timing.videos.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
	timing.audios.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
	timing.tracks.sort((left, right) => left.id.localeCompare(right.id));
	return timing;
}
function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
