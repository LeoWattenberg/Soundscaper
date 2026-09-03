import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeWorkspacePanel,
	getMenuItem,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { validateVideoTimingAssetBytes } from '../../src/common/editor/video-timing-asset.ts';
import {
	FRAMESCAPER_DATABASE_NAME,
	FRAMESCAPER_OPFS_DIRECTORY_NAME,
} from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';
const LABELS = Object.freeze({
	left: 'Linke Kante bis zur Abspielposition zeitlich strecken',
	right: 'Rechte Kante bis zur Abspielposition zeitlich strecken',
});

test.describe('Framescaper frame-canonical uniform rate-stretch qualification', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('menus and existing stretch handles uniformly retime one exact linked A/V pair', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/de/');
		await setNtscSequenceRate(page, editor);
		await importAvFixture(editor);

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const baseline = await persistedTimeline(page, projectId);
		expect(baseline.sequence.rate).toEqual({ num: 30_000, den: 1_001 });
		expect(baseline.videos).toHaveLength(1);
		expect(baseline.audios).toHaveLength(1);
		const active = baseline.videos[0];
		expect(active.sequenceFrameCount).toBeGreaterThan(8);
		const source = baseline.videoSources.find(({ id }) => id === active.sourceId);
		expect(source.timingDecision).toMatchObject({ mode: 'exact', backend: 'container' });
		expect(source.timingAsset).toMatchObject({
			sourceSha256: source.contentSha256,
			frameCount: source.sourceFrameCount,
		});
		const timing = validateVideoTimingAssetBytes(
			source.timingAsset,
			Uint8Array.from(await persistedTimingAssetBytes(page, source.timingAsset.storageKey)),
		);
		expect(timing.frameCount).toBe(source.sourceFrameCount);
		await selectVideoClip(editor, active.id);

		// Both actions remain lazy menu leaves: neither becomes default-visible chrome.
		await expect(editor.getByRole('button', { name: rateStretchLabelPattern() })).toHaveCount(0);
		await expect(editor.locator('[data-rate-stretch-guide]')).toHaveCount(0);
		const leftTarget = active.sequenceStartFrame + 3;
		const rightTarget = active.sequenceStartFrame + active.sequenceFrameCount - 3;
		// These labels bind the stable lazy leaves, in order:
		// rate-stretch-left-edge-to-playhead / rate-stretch-right-edge-to-playhead.
		for (const row of [
			{ edge: 'left', id: 'rate-stretch-left-edge-to-playhead', target: leftTarget },
			{ edge: 'right', id: 'rate-stretch-right-edge-to-playhead', target: rightTarget },
		]) {
			await setProgramFrame(editor, baseline.sequence.rate, row.target);
			const boundaries = await openClipBoundariesByKeyboard(page, editor);
			const item = getMenuItem(boundaries, LABELS[row.edge]);
			await expect(item).toBeEnabled();
			await item.focus();
			await page.keyboard.press('Enter');
			const expected = applyRateStretch(baseline, active.id, row.edge, row.target);
			await expectPersistedTimeline(page, projectId, expected);
			assertRateStretchInvariants(baseline, expected, active.id, row.edge, row.target);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			await expect(editor.locator('[data-status]')).toContainText(
				`${row.edge === 'left' ? 'Linke' : 'Rechte'} Kante mit`,
			);
			await expect(editor.locator('[data-status]')).toContainText(
				sequenceTimecode(row.target, baseline.sequence.rate),
			);
			await expectVideoRateBadge(editor, active.id, expected, timing);
			await clickHistory(editor, 'Rückgängig');
			await expectPersistedTimeline(page, projectId, baseline);
			await clickHistory(editor, 'Wiederholen');
			await expectPersistedTimeline(page, projectId, expected);
			await clickHistory(editor, 'Rückgängig');
			await expectPersistedTimeline(page, projectId, baseline);
			await selectVideoClip(editor, active.id);
		}

		for (const row of [
			{ edge: 'left', target: leftTarget },
			{ edge: 'right', target: rightTarget },
		]) {
			await dragStretchHandle(page, editor, baseline, active, row.edge, row.target, async () => {
				const expected = applyRateStretch(baseline, active.id, row.edge, row.target);
				const audio = expected.audios[0];
				await expect(editor.locator(`[data-clip-id="${active.id}"][data-rate-stretch-preview="true"]`))
					.toHaveCount(1);
				await expect(editor.locator(`[data-clip-id="${audio.id}"][data-rate-stretch-waveform-preview="true"]`))
					.toHaveCount(1);
				await expect(editor.locator('[data-rate-stretch-guide="true"]')).toHaveAttribute(
					'data-rate-stretch-edge', row.edge,
				);
				await expect(editor.locator('[data-rate-stretch-guide="true"]')).toHaveAttribute(
					'data-rate-stretch-boundary-sample', String(sampleAtSequenceFrame(baseline, row.target)),
				);
			});
			const expected = applyRateStretch(baseline, active.id, row.edge, row.target);
			await expectPersistedTimeline(page, projectId, expected);
			assertRateStretchInvariants(baseline, expected, active.id, row.edge, row.target);
			await clickHistory(editor, 'Rückgängig');
			await expectPersistedTimeline(page, projectId, baseline);
			await selectVideoClip(editor, active.id);
		}

		// Locking is the persisted final authority: both menus refuse and no stale preview leaks.
		await chooseTrackMenuAction(
			page, editor,
			editor.locator(`[data-track-row][data-track-id="${active.trackId}"]`),
			'Spur sperren',
		);
		const locked = withTrackLock(baseline, active.trackId, true);
		await expectPersistedTimeline(page, projectId, locked);
		const lockedBoundaries = await openClipBoundariesByKeyboard(page, editor);
		for (const edge of ['left', 'right']) await expect(getMenuItem(lockedBoundaries, LABELS[edge])).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await dragStretchHandle(page, editor, locked, active, 'right', rightTarget, async () => {
			await expect(editor.locator('[data-rate-stretch-guide]')).toHaveCount(0);
			await expect(editor.locator('[data-rate-stretch-preview]')).toHaveCount(0);
		});
		await expectPersistedTimeline(page, projectId, locked);

		await page.goto('/de/');
		const soundscaper = await waitForEditor(page);
		const soundscaperBoundaries = await openClipBoundariesByKeyboard(page, soundscaper);
		for (const edge of ['left', 'right']) await expect(getMenuItem(soundscaperBoundaries, LABELS[edge])).toHaveCount(0);
		await expect(soundscaper.getByRole('button', { name: rateStretchLabelPattern() })).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

async function importAvFixture(editor) {
	if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await closeWorkspacePanel(editor, 'project-bin');
	await editor.locator('[data-import-input]').setInputFiles([
		createDeterministicAvFixture('framescaper-rate-stretch.webm'),
	]);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 60_000 });
	await expect.poll(() => persistedClips(editor.page(), 'timeline'), { timeout: 30_000 }).toHaveLength(2);
}

async function setNtscSequenceRate(page, editor) {
	await editor.getByRole('button', { name: 'Sequenz-Timing', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Sequenz-Timing', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('combobox', { name: 'Bildrate', exact: true }).selectOption('30000/1001');
	await page.keyboard.press('Escape');
}

async function selectVideoClip(editor, clipId) {
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

async function openClipBoundariesByKeyboard(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Anwendungsmenü', exact: true });
	const edit = menubar.getByRole('menuitem', { name: 'Bearbeiten', exact: true });
	await edit.focus();
	await page.keyboard.press('Enter');
	const editMenu = page.getByRole('menu', { name: 'Bearbeiten', exact: true });
	await expect(editMenu).toBeVisible();
	const boundariesItem = getMenuItem(editMenu, 'Audio-Clips');
	await boundariesItem.focus();
	await page.keyboard.press('ArrowRight');
	const boundaries = boundariesItem.getByRole('menu');
	await expect(boundaries).toBeVisible();
	return boundaries;
}

async function setProgramFrame(editor, rate, frame) {
	const timecode = sequenceTimecode(frame, rate);
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', timecode);
}

async function dragStretchHandle(page, editor, timing, clip, edge, targetFrame, whileDragging) {
	const group = editor.locator(`[data-clip-id="${clip.id}"][role="group"]`);
	const handle = group.locator(`.clip-display__handle--stretch-${edge}`);
	const [groupBox, handleBox] = await Promise.all([group.boundingBox(), handle.boundingBox()]);
	expect(groupBox).not.toBeNull();
	expect(handleBox).not.toBeNull();
	const start = sampleAtSequenceFrame(timing, clip.sequenceStartFrame);
	const end = sampleAtSequenceFrame(timing, clip.sequenceStartFrame + clip.sequenceFrameCount);
	const targetX = groupBox.x + (sampleAtSequenceFrame(timing, targetFrame) - start) / (end - start) * groupBox.width;
	const y = handleBox.y + handleBox.height / 2;
	await page.mouse.move(handleBox.x + handleBox.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(targetX, y, { steps: 4 });
	await whileDragging();
	await page.mouse.up();
	await expect(editor.locator('[data-rate-stretch-guide]')).toHaveCount(0);
	await expect(editor.locator('[data-rate-stretch-preview]')).toHaveCount(0);
}

function applyRateStretch(original, activeClipId, edge, targetFrame) {
	const next = structuredClone(original);
	const sourceVideo = original.videos.find(({ id }) => id === activeClipId);
	const video = next.videos.find(({ id }) => id === activeClipId);
	const originalEnd = sourceVideo.sequenceStartFrame + sourceVideo.sequenceFrameCount;
	if (edge === 'left') {
		video.sequenceStartFrame = targetFrame;
		video.sequenceFrameCount = originalEnd - targetFrame;
	} else video.sequenceFrameCount = targetFrame - sourceVideo.sequenceStartFrame;
	const audio = linkedAudio(next, video);
	audio.timelineStartFrame = sampleAtSequenceFrame(next, video.sequenceStartFrame);
	audio.durationFrames = sampleAtSequenceFrame(next, video.sequenceStartFrame + video.sequenceFrameCount)
		- audio.timelineStartFrame;
	return sortedTimeline(next);
}

function assertRateStretchInvariants(original, expected, activeClipId, edge, targetFrame) {
	const beforeVideo = original.videos.find(({ id }) => id === activeClipId);
	const video = expected.videos.find(({ id }) => id === activeClipId);
	const beforeAudio = linkedAudio(original, beforeVideo);
	const audio = linkedAudio(expected, video);
	expect(video.sourceInFrame).toBe(beforeVideo.sourceInFrame);
	expect(video.sourceFrameCount).toBe(beforeVideo.sourceFrameCount);
	expect(audio.sourceStartFrame).toBe(beforeAudio.sourceStartFrame);
	expect(audio.sourceDurationFrames).toBe(beforeAudio.sourceDurationFrames);
	expect(video.sequenceStartFrame).toBe(edge === 'left' ? targetFrame : beforeVideo.sequenceStartFrame);
	expect(video.sequenceFrameCount).toBe(edge === 'left'
		? beforeVideo.sequenceStartFrame + beforeVideo.sequenceFrameCount - targetFrame
		: targetFrame - beforeVideo.sequenceStartFrame);
	expect(audio.timelineStartFrame).toBe(sampleAtSequenceFrame(expected, video.sequenceStartFrame));
	expect(audio.durationFrames).toBe(sampleAtSequenceFrame(expected,
		video.sequenceStartFrame + video.sequenceFrameCount) - audio.timelineStartFrame);
}

async function expectVideoRateBadge(editor, clipId, timing, sourceTiming) {
	const badge = editor.locator(`[data-clip-id="${clipId}"] [data-video-rate-badge="true"]`);
	await expect(badge).toHaveCount(1);
	const rate = Number(await badge.getAttribute('data-video-playback-rate'));
	const video = timing.videos.find(({ id }) => id === clipId);
	const sourceDurationTicks = videoBoundaryTicks(sourceTiming, video.sourceInFrame + video.sourceFrameCount)
		- videoBoundaryTicks(sourceTiming, video.sourceInFrame);
	const programDuration = sampleAtSequenceFrame(timing, video.sequenceStartFrame + video.sequenceFrameCount)
		- sampleAtSequenceFrame(timing, video.sequenceStartFrame);
	const expected = Number(sourceDurationTicks) * timing.sampleRate
		/ Number(sourceTiming.timescale) / programDuration;
	expect(rate).toBeCloseTo(expected, 8);
	await expect(badge).toContainText('×');
}

function videoBoundaryTicks(timing, frame) {
	return frame === timing.frameCount ? timing.endTicks : timing.presentationTicks[frame];
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
	const values = [
		Math.floor(frame / (framesPerSecond * 3_600)),
		Math.floor(frame / (framesPerSecond * 60)) % 60,
		Math.floor(frame / framesPerSecond) % 60,
		frame % framesPerSecond,
	];
	return values.map((value) => String(value).padStart(2, '0')).join(':');
}

function rateStretchLabelPattern() {
	return new RegExp(Object.values(LABELS).map(escapePattern).join('|'), 'u');
}

function escapePattern(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

async function expectPersistedTimeline(page, projectId, expected) {
	await expect.poll(() => persistedTimeline(page, projectId)).toEqual(expected);
}

async function persistedClips(page, scope) {
	return page.evaluate(async ({ databaseName, where }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const projects = await result(database.transaction(['projects'], 'readonly').objectStore('projects').getAll());
			return projects.flatMap((project) => where === 'bin' ? project.projectBin?.clips || [] : project.clips || []);
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
			const project = await result(database.transaction(['projects'], 'readonly').objectStore('projects').get(id));
			const videos = project?.clips?.filter(({ kind }) => kind === 'video') || [];
			const sequence = project?.sequences?.find(({ id: sequenceId }) => sequenceId === videos[0]?.sequenceId);
			if (!project || !sequence) return null;
			const trackByClipId = new Map(project.tracks.flatMap((track) => (
				(track.clipIds || []).map((clipId) => [clipId, track.id])
			)));
			return {
				sampleRate: project.sampleRate,
				sequence: { id: sequence.id, rate: sequence.rate },
				videos: videos.map((clip) => ({
					id: clip.id, trackId: trackByClipId.get(clip.id), sourceId: clip.sourceId, avLinkId: clip.avLinkId,
					sequenceStartFrame: clip.sequenceStartFrame, sequenceFrameCount: clip.sequenceFrameCount,
					sourceInFrame: clip.sourceInFrame, sourceFrameCount: clip.sourceFrameCount,
				})),
				audios: project.clips.filter(({ kind }) => kind === 'audio').map((clip) => ({
					id: clip.id, trackId: trackByClipId.get(clip.id), avLinkId: clip.avLinkId,
					timelineStartFrame: clip.timelineStartFrame, durationFrames: clip.durationFrames,
					sourceStartFrame: clip.sourceStartFrame, sourceDurationFrames: clip.sourceDurationFrames,
				})),
				tracks: project.tracks.map(({ id: trackId, type, locked }) => ({ id: trackId, type, locked })),
				videoSources: project.sources.filter(({ kind }) => kind === 'video').map((source) => ({
					id: source.id, contentSha256: source.contentSha256, sourceFrameCount: source.sourceFrameCount,
					timingDecision: source.timingDecision, timingAsset: source.timingAsset,
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
	timing.videoSources.sort((left, right) => left.id.localeCompare(right.id));
	return timing;
}

async function persistedTimingAssetBytes(page, storageKey) {
	return page.evaluate(async ({ databaseName, key, opfsDirectoryName }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['mediaAssets', 'mediaAssetChunks'], 'readonly');
			const [records, chunks] = await Promise.all([
				result(transaction.objectStore('mediaAssets').getAll()),
				result(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const record = records.find(({ sourceId }) => sourceId === key);
			if (record?.storage === 'opfs') {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle(opfsDirectoryName);
				const file = await (await directory.getFileHandle(record.path)).getFile();
				return [...new Uint8Array(await file.arrayBuffer())];
			}
			if (record?.blob instanceof Blob) return [...new Uint8Array(await record.blob.arrayBuffer())];
			const bodies = chunks.filter(({ mediaChunkToken }) => mediaChunkToken === record?.mediaChunkToken)
				.sort((left, right) => left.index - right.index);
			const bytes = [];
			for (const chunk of bodies) bytes.push(...new Uint8Array(await chunk.payload.arrayBuffer()));
			return bytes;
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, key: storageKey, opfsDirectoryName: FRAMESCAPER_OPFS_DIRECTORY_NAME });
}

function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
