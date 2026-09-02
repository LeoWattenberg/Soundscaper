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
	slipEarlier: 'Quelle um ein Bild früher verschieben',
	slipLater: 'Quelle um ein Bild später verschieben',
	slideEarlier: 'Clip um ein Bild früher verschieben',
	slideLater: 'Clip um ein Bild später verschieben',
});
const MENU_ROWS = Object.freeze([
	{ mode: 'slip', direction: 'earlier', label: LABELS.slipEarlier, delta: -1 },
	{ mode: 'slip', direction: 'later', label: LABELS.slipLater, delta: 1 },
	{ mode: 'slide', direction: 'earlier', label: LABELS.slideEarlier, delta: -1 },
	{ mode: 'slide', direction: 'later', label: LABELS.slideLater, delta: 1 },
]);

test.describe('Framescaper frame-canonical slip and slide qualification', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('menus and modified clip bodies slip and slide one exact-timed linked triplet', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const errors = collectClientErrors(page);
		const fixture = createDeterministicAvFixture('framescaper-slip-slide.webm');
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
		const source = baseline.videoSources.find(({ id }) => id === active.sourceId);
		expect(source.timingDecision).toMatchObject({ mode: 'exact', backend: 'container' });
		expect(source.startTimecode).toBeNull();
		expect(source.timingAsset).toMatchObject({
			sourceSha256: source.contentSha256,
			frameCount: source.sourceFrameCount,
		});
		const timingBytes = await persistedTimingAssetBytes(page, source.timingAsset.storageKey);
		const timing = validateVideoTimingAssetBytes(source.timingAsset, Uint8Array.from(timingBytes));
		expect(timing.frameCount).toBe(source.sourceFrameCount);
		expect(timing.presentationTicks).toHaveLength(source.sourceFrameCount);
		expect(active.sourceInFrame).toBeGreaterThan(0);
		expect(active.sourceInFrame + active.sourceFrameCount).toBeLessThan(source.sourceFrameCount);
		await selectVideoClip(editor, active.id);

		// Slip and slide stay opt-in: four existing-menu leaves and body modifiers,
		// without any default toolbar control or lingering transient affordance.
		await expect(editor.getByRole('button', { name: slipSlideLabelPattern() })).toHaveCount(0);
		await expect(editor.locator('[data-slip-slide-trim-guide]')).toHaveCount(0);
		await expect(editor.locator('[data-slip-slide-source-preview]')).toHaveCount(0);

		for (const [index, row] of MENU_ROWS.entries()) {
			await activateClipBoundaryByKeyboard(page, editor, row.label);
			const expected = row.mode === 'slip'
				? applySlip(baseline, active.id, row.delta, timing)
				: applySlide(baseline, active.id, row.delta);
			await expectPersistedTimeline(page, projectId, expected);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			await expect(editor.locator('[data-status]')).toContainText(
				expectedGermanStatus(baseline, expected, active.id, row.mode, row.delta),
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

		const slipped = applySlip(baseline, active.id, -1, timing);
		const slippedVideo = slipped.videos.find(({ id }) => id === active.id);
		await dragClipBody(page, editor, active, slipPointerFraction(timing, active, -1), ['Alt'], async () => {
			const preview = editor.locator(`[data-clip-id="${active.id}"][data-slip-slide-source-preview="true"]`);
			await expect(preview).toHaveCount(1);
			await expect(preview).toHaveAttribute(
				'data-slip-slide-preview-source-start',
				String(slippedVideo.sourceInFrame),
			);
			await expect(preview).toHaveAttribute(
				'data-slip-slide-preview-source-end',
				String(slippedVideo.sourceInFrame + slippedVideo.sourceFrameCount),
			);
			await expect(editor.locator('[data-slip-slide-trim-guide]')).toHaveCount(0);
		});
		await expectPersistedTimeline(page, projectId, slipped);
		await expect(editor.locator('[data-status]')).toContainText(
			expectedGermanStatus(baseline, slipped, active.id, 'slip', -1),
		);
		await clickHistory(editor, 'Rückgängig');
		await expectPersistedTimeline(page, projectId, baseline);
		await selectVideoClip(editor, active.id);

		await dragClipBody(page, editor, active, 1 / active.sequenceFrameCount, ['Alt', 'Shift'], async () => {
			const guides = editor.locator('[data-slip-slide-trim-guide="true"]');
			await expect(guides).toHaveCount(2);
			await expect(editor.locator('[data-slip-slide-guide-role="start"]')).toHaveCount(1);
			await expect(editor.locator('[data-slip-slide-guide-role="end"]')).toHaveCount(1);
			await expect(editor.locator('[data-slip-slide-source-preview]')).toHaveCount(0);
		});
		const slid = applySlide(baseline, active.id, 1);
		await expectPersistedTimeline(page, projectId, slid);
		await expect(editor.locator('[data-status]')).toContainText(
			expectedGermanStatus(baseline, slid, active.id, 'slide', 1),
		);
		await clickHistory(editor, 'Rückgängig');
		await expectPersistedTimeline(page, projectId, baseline);
		await selectVideoClip(editor, active.id);

		// Persisted lock authority disables all menu routes and refuses both body gestures.
		await chooseTrackMenuAction(
			page, editor,
			editor.locator(`[data-track-row][data-track-id="${active.trackId}"]`),
			'Spur sperren',
		);
		const locked = withTrackLock(baseline, active.trackId, true);
		await expectPersistedTimeline(page, projectId, locked);
		const boundaries = await openClipBoundariesByKeyboard(page, editor);
		for (const row of MENU_ROWS) await expect(getMenuItem(boundaries, row.label)).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await dragClipBody(page, editor, active, slipPointerFraction(timing, active, -1), ['Alt'], async () => {
			await expect(editor.locator('[data-slip-slide-trim-guide]')).toHaveCount(0);
			await expect(editor.locator('[data-slip-slide-source-preview]')).toHaveCount(0);
		});
		await dragClipBody(page, editor, active, 1 / active.sequenceFrameCount, ['Alt', 'Shift'], async () => {
			await expect(editor.locator('[data-slip-slide-trim-guide]')).toHaveCount(0);
			await expect(editor.locator('[data-slip-slide-source-preview]')).toHaveCount(0);
		});
		await expectPersistedTimeline(page, projectId, locked);

		await page.goto('/de/');
		const soundscaper = await waitForEditor(page);
		const soundscaperBoundaries = await openClipBoundariesByKeyboard(page, soundscaper);
		for (const row of MENU_ROWS) await expect(getMenuItem(soundscaperBoundaries, row.label)).toHaveCount(0);
		await expect(soundscaper.getByRole('button', { name: slipSlideLabelPattern() })).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

async function createContiguousMarkedEdits(page, editor, fixture) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	await expect(projectBin).toBeVisible();
	await closeWorkspacePanel(editor, 'project-bin');
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

	await setProgramFrame(editor, 0, await persistedSequenceRate(page));
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
	await expect(page.locator('[data-source-monitor]')).toHaveAttribute('data-source-monitor-frame', String(frame));
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

async function dragClipBody(page, editor, clip, pointerFraction, modifiers, whileDragging) {
	const group = editor.locator(`[data-clip-id="${clip.id}"][role="group"]`);
	const box = await group.boundingBox();
	expect(box).not.toBeNull();
	const startX = box.x + box.width / 2;
	const targetX = startX + pointerFraction * box.width;
	const y = box.y + box.height / 2;
	for (const modifier of modifiers) await page.keyboard.down(modifier);
	try {
		await page.mouse.move(startX, y);
		await page.mouse.down();
		await page.mouse.move(targetX, y, { steps: 4 });
		await whileDragging();
		await page.mouse.up();
	} finally {
		for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
	}
	await expect(editor.locator('[data-slip-slide-trim-guide]')).toHaveCount(0);
	await expect(editor.locator('[data-slip-slide-source-preview]')).toHaveCount(0);
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

function applySlip(original, activeClipId, delta, timing) {
	const next = structuredClone(original);
	const sourceVideo = original.videos.find(({ id }) => id === activeClipId);
	const video = next.videos.find(({ id }) => id === activeClipId);
	const oldInTicks = boundaryTicks(timing, sourceVideo.sourceInFrame);
	const tauTicks = boundaryTicks(timing, sourceVideo.sourceInFrame + delta) - oldInTicks;
	const mappedIn = nearestTimingBoundary(timing, oldInTicks + tauTicks);
	const mappedOut = nearestTimingBoundary(
		timing,
		boundaryTicks(timing, sourceVideo.sourceInFrame + sourceVideo.sourceFrameCount) + tauTicks,
	);
	video.sourceInFrame = mappedIn;
	video.sourceFrameCount = mappedOut - mappedIn;

	const sourceAudio = linkedAudio(original, sourceVideo);
	const audio = linkedAudio(next, video);
	const audioSource = original.audioSources.find(({ id }) => id === sourceAudio.sourceId);
	const sourceDelta = roundPointBigInt(
		tauTicks * BigInt(audioSource.sampleRate),
		BigInt(timing.timescale),
	);
	audio.sourceStartFrame = sourceAudio.sourceStartFrame + sourceDelta;
	audio.sourceDurationFrames = sourceAudio.sourceDurationFrames;
	audio.trimStartFrames = Math.max(0, sourceAudio.trimStartFrames + sourceDelta);
	audio.trimEndFrames = Math.max(0, sourceAudio.trimEndFrames - sourceDelta);
	return sortedTimeline(next);
}

function applySlide(original, activeClipId, delta) {
	const next = structuredClone(original);
	const center = original.videos.find(({ id }) => id === activeClipId);
	const left = original.videos.find((video) => video.trackId === center.trackId
		&& video.sequenceStartFrame + video.sequenceFrameCount === center.sequenceStartFrame);
	const right = original.videos.find((video) => video.trackId === center.trackId
		&& video.sequenceStartFrame === center.sequenceStartFrame + center.sequenceFrameCount);
	for (const [role, sourceVideo] of [['left', left], ['center', center], ['right', right]]) {
		const video = next.videos.find(({ id }) => id === sourceVideo.id);
		const oldEnd = sourceVideo.sequenceStartFrame + sourceVideo.sequenceFrameCount;
		const start = role === 'left' ? sourceVideo.sequenceStartFrame : sourceVideo.sequenceStartFrame + delta;
		const end = role === 'right' ? oldEnd : oldEnd + delta;
		if (role === 'left') {
			video.sourceFrameCount = roundPoint(
				(end - sourceVideo.sequenceStartFrame) * sourceVideo.sourceFrameCount,
				sourceVideo.sequenceFrameCount,
			);
		} else if (role === 'right') {
			const progress = roundPoint(
				(start - sourceVideo.sequenceStartFrame) * sourceVideo.sourceFrameCount,
				sourceVideo.sequenceFrameCount,
			);
			video.sourceInFrame = sourceVideo.sourceInFrame + progress;
			video.sourceFrameCount = sourceVideo.sourceFrameCount - progress;
		}
		video.sequenceStartFrame = start;
		video.sequenceFrameCount = end - start;
		applyLinkedAudioSlide(next, original, sourceVideo, video, role);
	}
	return sortedTimeline(next);
}

function applyLinkedAudioSlide(timing, original, sourceVideo, video, role) {
	const sourceAudio = linkedAudio(original, sourceVideo);
	const audio = linkedAudio(timing, video);
	const start = sampleAtSequenceFrame(timing, video.sequenceStartFrame);
	const end = sampleAtSequenceFrame(timing, video.sequenceStartFrame + video.sequenceFrameCount);
	audio.timelineStartFrame = start;
	audio.durationFrames = end - start;
	if (role === 'left') {
		const progress = roundPoint(
			(end - sourceAudio.timelineStartFrame) * sourceAudio.sourceDurationFrames,
			sourceAudio.durationFrames,
		);
		audio.sourceDurationFrames = progress;
		audio.trimEndFrames = Math.max(
			0,
			sourceAudio.trimEndFrames + sourceAudio.sourceDurationFrames - progress,
		);
	} else if (role === 'right') {
		const progress = roundPoint(
			(start - sourceAudio.timelineStartFrame) * sourceAudio.sourceDurationFrames,
			sourceAudio.durationFrames,
		);
		audio.sourceStartFrame = sourceAudio.sourceStartFrame + progress;
		audio.sourceDurationFrames = sourceAudio.sourceDurationFrames - progress;
		audio.trimStartFrames = Math.max(0, sourceAudio.trimStartFrames + progress);
	}
}

function boundaryTicks(timing, frame) {
	return frame === timing.frameCount ? timing.endTicks : timing.presentationTicks[frame];
}

function slipPointerFraction(timing, video, delta) {
	const sourceIn = boundaryTicks(timing, video.sourceInFrame);
	const sourceOut = boundaryTicks(timing, video.sourceInFrame + video.sourceFrameCount);
	return Number(boundaryTicks(timing, video.sourceInFrame + delta) - sourceIn)
		/ Number(sourceOut - sourceIn);
}

function nearestTimingBoundary(timing, target) {
	const boundaries = [...timing.presentationTicks, timing.endTicks];
	let low = 0;
	let high = boundaries.length - 1;
	while (low + 1 < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (boundaries[middle] <= target) low = middle;
		else high = middle;
	}
	return target - boundaries[low] < boundaries[high] - target ? low : high;
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
		const end = sampleAtSequenceFrame(timing, video.sequenceStartFrame + video.sequenceFrameCount);
		expect(audio.timelineStartFrame).toBe(start);
		expect(audio.durationFrames).toBe(end - start);
	}
	for (let index = 1; index < timing.videos.length; index += 1) {
		expect(timing.videos[index - 1].sequenceStartFrame
			+ timing.videos[index - 1].sequenceFrameCount)
			.toBe(timing.videos[index].sequenceStartFrame);
	}
}

function expectedGermanStatus(original, expected, activeClipId, mode, delta) {
	const video = expected.videos.find(({ id }) => id === activeClipId);
	if (mode === 'slip') {
		const source = original.videoSources.find(({ id }) => id === video.sourceId);
		return `Quelle um ${delta > 0 ? '+' : ''}${delta} Frames verschoben; Quellanfang ${sequenceTimecode(video.sourceInFrame, source.frameRate)}.`;
	}
	const end = video.sequenceStartFrame + video.sequenceFrameCount;
	return `Clip um ${delta > 0 ? '+' : ''}${delta} Frames verschoben; Programmbereich ${sequenceTimecode(video.sequenceStartFrame, original.sequence.rate)}–${sequenceTimecode(end, original.sequence.rate)}.`;
}

function sampleAtSequenceFrame(timing, frame) {
	return roundPoint(frame * timing.sampleRate * timing.sequence.rate.den, timing.sequence.rate.num);
}

function roundPoint(numerator, denominator) {
	const quotient = Math.trunc(numerator / denominator);
	const remainder = numerator - quotient * denominator;
	return Math.abs(remainder) * 2 >= denominator ? quotient + Math.sign(numerator) : quotient;
}

function roundPointBigInt(numerator, denominator) {
	const quotient = numerator / denominator;
	const remainder = numerator - quotient * denominator;
	return Number((remainder < 0n ? -remainder : remainder) * 2n >= denominator
		? quotient + (numerator < 0n ? -1n : 1n)
		: quotient);
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

function slipSlideLabelPattern() {
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
			const projects = await result(database.transaction(['projects'], 'readonly').objectStore('projects').getAll());
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
			const projects = await result(database.transaction(['projects'], 'readonly').objectStore('projects').getAll());
			return projects.flatMap((project) => where === 'bin' ? project.projectBin?.clips || [] : project.clips || []);
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, where: scope });
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
					id: clip.id,
					trackId: trackByClipId.get(clip.id),
					sourceId: clip.sourceId,
					avLinkId: clip.avLinkId,
					sequenceStartFrame: clip.sequenceStartFrame,
					sequenceFrameCount: clip.sequenceFrameCount,
					sourceInFrame: clip.sourceInFrame,
					sourceFrameCount: clip.sourceFrameCount,
					trimStartFrames: clip.trimStartFrames,
					trimEndFrames: clip.trimEndFrames,
				})),
				audios: project.clips.filter(({ kind }) => kind === 'audio').map((clip) => ({
					id: clip.id,
					trackId: trackByClipId.get(clip.id),
					sourceId: clip.sourceId,
					avLinkId: clip.avLinkId,
					timelineStartFrame: clip.timelineStartFrame,
					durationFrames: clip.durationFrames,
					sourceStartFrame: clip.sourceStartFrame,
					sourceDurationFrames: clip.sourceDurationFrames,
					trimStartFrames: clip.trimStartFrames,
					trimEndFrames: clip.trimEndFrames,
					fadeInFrames: clip.fadeInFrames,
					fadeOutFrames: clip.fadeOutFrames,
					reversed: clip.reversed,
				})),
				videoSources: project.sources.filter(({ kind }) => kind === 'video').map((source) => ({
					id: source.id,
					contentSha256: source.contentSha256,
					frameRate: source.frameRate,
					sourceFrameCount: source.sourceFrameCount,
					startTimecode: source.characteristics?.startTimecode ?? null,
					timingDecision: source.timingDecision,
					timingAsset: source.timingAsset,
				})),
				audioSources: project.sources.filter(({ kind }) => kind === 'audio').map((source) => ({
					id: source.id,
					frameCount: source.frameCount,
					sampleRate: source.sampleRate,
				})),
				tracks: project.tracks.map(({ id: trackId, type, locked }) => ({ id: trackId, type, locked })),
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
	timing.videoSources.sort((left, right) => left.id.localeCompare(right.id));
	timing.audioSources.sort((left, right) => left.id.localeCompare(right.id));
	timing.tracks.sort((left, right) => left.id.localeCompare(right.id));
	return timing;
}

async function setProgramFrame(editor, sequenceFrame, rate) {
	const timecode = sequenceTimecode(sequenceFrame, rate);
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', timecode);
}

function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
