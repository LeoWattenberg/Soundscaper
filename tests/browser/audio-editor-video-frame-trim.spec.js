import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	importFiles,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { hasMediaRecorderCapability } from './helpers/media-recorder-capability.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRIM_LEFT = 'Trim left edge to playhead';
const TRIM_RIGHT = 'Trim right edge to playhead';

test.describe('Framescaper frame-canonical edge trim integration', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('menus and a pointer handle trim one linked A/V pair on the sequence frame grid', async ({ page }) => {
		test.skip(!await page.evaluate(hasMediaRecorderCapability), 'Generated WebM fixtures require MediaRecorder.');
		test.setTimeout(180_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const errors = collectClientErrors(page);
		const fixture = await createGeneratedAvFixture(page);
		const editor = await bootFramescaper(page);
		await importFiles(editor, [fixture]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await expect.poll(() => persistedTiming(page, projectId), { timeout: 30_000 }).not.toBeNull();

		const initial = await persistedTiming(page, projectId);
		expect(initial.video.avLinkId).toBeTruthy();
		expect(initial.video.avLinkId).toBe(initial.audio.avLinkId);
		expect(initial.sequence.rate.den).toBe(1);
		expect(initial.sampleRate % initial.sequence.rate.num).toBe(0);
		expect(initial.video.sequenceFrameCount).toBeGreaterThanOrEqual(8);
		assertLinkedPresentation(initial);
		await selectOnlyVideoClip(editor);

		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClip.locator('.clip-display__handle--trim-left')).toHaveCount(1);
		await expect(videoClip.locator('.clip-display__handle--trim-right')).toHaveCount(1);
		await expect(editor.getByRole('button', { name: TRIM_LEFT, exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: TRIM_RIGHT, exact: true })).toHaveCount(0);

		const initialEnd = initial.video.sequenceStartFrame + initial.video.sequenceFrameCount;
		const leftFrame = initial.video.sequenceStartFrame + Math.max(
			1,
			Math.floor(initial.video.sequenceFrameCount / 4),
		);
		const leftTimecode = sequenceTimecode(leftFrame, initial.sequence.rate.num);
		await setProgramPlayhead(editor, leftFrame, leftTimecode, initial);
		await activateTrimMenuByKeyboard(page, editor, TRIM_LEFT);
		await expect(editor.locator('[data-status]')).toContainText(`Trimmed left edge to ${leftTimecode}.`);
		const left = await expectPersistedVideoRange(page, projectId, leftFrame, initialEnd);
		expect(left.video.sequenceFrameCount).toBe(initialEnd - leftFrame);
		assertLinkedPresentation(left);

		await clickHistory(editor, 'Undo');
		await expectPersistedTiming(page, projectId, initial);
		await clickHistory(editor, 'Redo');
		await expectPersistedTiming(page, projectId, left);

		const rightFrame = leftFrame + Math.max(2, Math.floor((initialEnd - leftFrame) * 3 / 4));
		expect(rightFrame).toBeLessThan(initialEnd);
		const rightTimecode = sequenceTimecode(rightFrame, initial.sequence.rate.num);
		await setProgramPlayhead(editor, rightFrame, rightTimecode, initial);
		await activateTrimMenuByKeyboard(page, editor, TRIM_RIGHT);
		await expect(editor.locator('[data-status]')).toContainText(`Trimmed right edge to ${rightTimecode}.`);
		const right = await expectPersistedVideoRange(page, projectId, leftFrame, rightFrame);
		assertLinkedPresentation(right);

		await clickHistory(editor, 'Undo');
		await expectPersistedTiming(page, projectId, left);
		await clickHistory(editor, 'Redo');
		await expectPersistedTiming(page, projectId, right);

		const beforePointerBox = await videoClip.boundingBox();
		const rightHandle = videoClip.locator('.clip-display__handle--trim-right');
		const handleBox = await rightHandle.boundingBox();
		expect(beforePointerBox).not.toBeNull();
		expect(handleBox).not.toBeNull();
		const startX = handleBox.x + handleBox.width / 2;
		const pointerX = Math.max(beforePointerBox.x + 8, startX - 12);
		const pointerY = handleBox.y + handleBox.height / 2;
		const samplesPerSequenceFrame = right.sampleRate / right.sequence.rate.num;
		const videoStartSample = right.video.sequenceStartFrame * samplesPerSequenceFrame;
		const videoDurationSamples = right.video.sequenceFrameCount * samplesPerSequenceFrame;
		const requestedBoundarySample = videoStartSample + Math.round(
			(pointerX - beforePointerBox.x) * videoDurationSamples / beforePointerBox.width,
		);
		const expectedPointerEnd = Math.round(requestedBoundarySample / samplesPerSequenceFrame);
		expect(expectedPointerEnd).toBeLessThan(rightFrame);
		expect(expectedPointerEnd).toBeGreaterThan(leftFrame);

		await page.mouse.move(startX, pointerY);
		await page.mouse.down();
		await page.mouse.move(pointerX, pointerY, { steps: 5 });
		await page.mouse.up();
		const pointer = await expectPersistedVideoRange(page, projectId, leftFrame, expectedPointerEnd);
		assertLinkedPresentation(pointer);
		const afterPointerBox = await videoClip.boundingBox();
		expect(afterPointerBox).not.toBeNull();
		expect(Math.abs(afterPointerBox.x + afterPointerBox.width - pointerX)).toBeLessThanOrEqual(2.5);

		await page.goto('/en/');
		const soundscaper = await waitForEditor(page);
		const soundscaperBoundaries = await openClipBoundariesByKeyboard(page, soundscaper);
		await expect(getMenuItem(soundscaperBoundaries, TRIM_LEFT)).toHaveCount(0);
		await expect(getMenuItem(soundscaperBoundaries, TRIM_RIGHT)).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

async function bootFramescaper(page) {
	const editor = await bootEditor(page, '/framescaper/en/');
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await expect(editor.locator('[data-video-preview]')).toBeVisible();
	return editor;
}

async function selectOnlyVideoClip(editor) {
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

async function setProgramPlayhead(editor, sequenceFrame, timecode, timing) {
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', timecode);
	const expectedSample = sequenceFrame * timing.sampleRate / timing.sequence.rate.num;
	await expect(editor.getByRole('slider', { name: 'Playhead', exact: true }))
		.toHaveAttribute('aria-valuenow', String(expectedSample));
}

async function activateTrimMenuByKeyboard(page, editor, label) {
	const boundaries = await openClipBoundariesByKeyboard(page, editor);
	const item = getMenuItem(boundaries, label);
	await expect(item).toBeEnabled();
	await item.focus();
	await page.keyboard.press('Enter');
}

async function openClipBoundariesByKeyboard(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	const edit = menubar.getByRole('menuitem', { name: 'Edit', exact: true });
	await edit.focus();
	await page.keyboard.press('Enter');
	const editMenu = page.getByRole('menu', { name: 'Edit', exact: true });
	await expect(editMenu).toBeVisible();
	const boundariesItem = getMenuItem(editMenu, 'Audio clips');
	await boundariesItem.focus();
	await page.keyboard.press('ArrowRight');
	const boundaries = boundariesItem.getByRole('menu');
	await expect(boundaries).toBeVisible();
	return boundaries;
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

async function expectPersistedVideoRange(page, projectId, expectedStart, expectedEnd) {
	await expect.poll(async () => {
		const timing = await persistedTiming(page, projectId);
		return timing && [
			timing.video.sequenceStartFrame,
			timing.video.sequenceStartFrame + timing.video.sequenceFrameCount,
		];
	}).toEqual([expectedStart, expectedEnd]);
	return persistedTiming(page, projectId);
}

async function expectPersistedTiming(page, projectId, expected) {
	await expect.poll(() => persistedTiming(page, projectId)).toEqual(expected);
}

function assertLinkedPresentation(timing) {
	const samplesPerSequenceFrame = timing.sampleRate / timing.sequence.rate.num;
	const expectedStart = timing.video.sequenceStartFrame * samplesPerSequenceFrame;
	const expectedDuration = timing.video.sequenceFrameCount * samplesPerSequenceFrame;
	expect(timing.audio.timelineStartFrame).toBe(expectedStart);
	expect(timing.audio.durationFrames).toBe(expectedDuration);
}

async function persistedTiming(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const project = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').get(id),
			);
			const video = project?.clips?.find((clip) => clip.kind === 'video');
			const audio = project?.clips?.find((clip) => clip.kind === 'audio');
			const sequence = project?.sequences?.find((item) => item.id === video?.sequenceId);
			if (!project || !video || !audio || !sequence) return null;
			return {
				sampleRate: project.sampleRate,
				sequence: { id: sequence.id, rate: sequence.rate },
				video: {
					id: video.id,
					avLinkId: video.avLinkId,
					sequenceStartFrame: video.sequenceStartFrame,
					sequenceFrameCount: video.sequenceFrameCount,
					sourceInFrame: video.sourceInFrame,
					sourceFrameCount: video.sourceFrameCount,
				},
				audio: {
					id: audio.id,
					avLinkId: audio.avLinkId,
					timelineStartFrame: audio.timelineStartFrame,
					durationFrames: audio.durationFrames,
					sourceStartFrame: audio.sourceStartFrame,
					sourceDurationFrames: audio.sourceDurationFrames,
				},
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId });
}

function sequenceTimecode(frame, framesPerSecond) {
	const frames = frame % framesPerSecond;
	const wholeSeconds = Math.floor(frame / framesPerSecond);
	const seconds = wholeSeconds % 60;
	const wholeMinutes = Math.floor(wholeSeconds / 60);
	const minutes = wholeMinutes % 60;
	const hours = Math.floor(wholeMinutes / 60);
	return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':');
}

async function createGeneratedAvFixture(page) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 54;
		const context = canvas.getContext('2d');
		const videoStream = canvas.captureStream(15);
		const audioContext = new AudioContext({ sampleRate: 48_000 });
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		const audioDestination = audioContext.createMediaStreamDestination();
		oscillator.frequency.value = 330;
		gain.gain.value = 0.06;
		oscillator.connect(gain).connect(audioDestination);
		oscillator.start();
		await audioContext.resume();
		const stream = new MediaStream([
			...videoStream.getVideoTracks(),
			...audioDestination.stream.getAudioTracks(),
		]);
		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
			? 'video/webm;codecs=vp8,opus'
			: 'video/webm';
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: 120_000,
			audioBitsPerSecond: 32_000,
		});
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < 14; frame += 1) {
			context.fillStyle = frame % 2 ? '#245fce' : '#d92f45';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#ffffff';
			context.fillRect(frame * 5, 20, 12, 12);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		oscillator.stop();
		await audioContext.close();
		const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	});
	return {
		name: 'framescaper-frame-trim.webm',
		mimeType: 'video/webm',
		buffer: Buffer.from(base64, 'base64'),
	};
}

function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
