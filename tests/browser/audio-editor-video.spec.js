import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.describe('audio editor video composition workflow', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('imports generated A/V fixtures, layers tracks, crossfades, rejects a third overlap, and reorders layers', async ({ page }) => {
		test.setTimeout(60_000);
		await page.setViewportSize({ width: 1_440, height: 1_200 });
		const red = await createGeneratedVideoFixture(page, {
			name: 'layer-red.webm',
			color: '#d92f45',
			accent: '#ffd6dc',
			frequency: 220,
			width: 96,
			height: 54,
		});
		const blue = await createGeneratedVideoFixture(page, {
			name: 'layer-blue.webm',
			color: '#245fce',
			accent: '#d8e5ff',
			frequency: 440,
			width: 54,
			height: 96,
		});
		const errors = collectClientErrors(page);
		const editor = await bootVideoEditor(page);
		await importTimelineFiles(editor, [
			red,
			blue,
			{ ...red, name: 'layer-red-copy.webm' },
		]);

		const videoRows = editor.locator('[data-video-track]');
		await expect(videoRows).toHaveCount(3);
		const firstVideoId = await videoRows.nth(0).getAttribute('data-track-id');
		const secondVideoId = await videoRows.nth(1).getAttribute('data-track-id');
		const thirdVideoId = await videoRows.nth(2).getAttribute('data-track-id');
		const firstVideo = videoTrackById(editor, firstVideoId);
		const secondVideo = videoTrackById(editor, secondVideoId);
		const thirdVideo = videoTrackById(editor, thirdVideoId);
		const firstAudio = await companionTrack(editor, firstVideo);
		const secondAudio = await companionTrack(editor, secondVideo);
		const thirdAudio = await companionTrack(editor, thirdVideo);

		await expect(firstVideo.locator('[data-clip-kind="video"]')).toHaveCount(1);
		await expect(secondVideo.locator('[data-clip-kind="video"]')).toHaveCount(1);
		await expect(thirdVideo.locator('[data-clip-kind="video"]')).toHaveCount(1);
		await expect(firstAudio.locator('[data-clip-id]')).toHaveCount(1);
		await expect(secondAudio.locator('[data-clip-id]')).toHaveCount(1);
		await expect(thirdAudio.locator('[data-clip-id]')).toHaveCount(1);

		const preview = editor.locator('[data-video-preview]');
		await expect(preview).toHaveAttribute('data-active-track-count', '3');
		await expect(preview.locator('[data-video-preview-layer]')).toHaveCount(3);
		await expect(preview.locator('[data-video-preview-clip]')).toHaveCount(3);
		await expect(preview.locator('[data-video-preview-layer]').last()).toHaveAttribute('data-track-id', firstVideoId);
		await expect(preview.locator('[data-video-preview-clip]').first()).toHaveCSS('object-fit', 'contain');
		await expect(preview.locator('[data-video-preview-clip]').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

		const secondClip = secondVideo.locator('[data-clip-kind="video"]').first();
		await beginClipDrag(page, secondClip, firstVideo, 0.42);
		await expect(firstVideo).toHaveAttribute('data-video-overlap-state', 'crossfade');
		await expect(firstVideo.locator('[data-automatic-crossfade="true"]')).toHaveCount(1);
		await expect(firstAudio.locator('[data-automatic-crossfade="true"]')).toHaveCount(1);
		await page.mouse.up();

		await expect(firstVideo.locator('[data-clip-kind="video"]')).toHaveCount(2);
		await expect(secondVideo.locator('[data-clip-kind="video"]')).toHaveCount(0);
		await expect(firstAudio.locator('[data-clip-id]')).toHaveCount(2);
		await expect(secondAudio.locator('[data-clip-id]')).toHaveCount(0);
		await expect(firstVideo).toHaveAttribute('data-video-overlap-state', 'crossfade');

		const thirdClip = thirdVideo.locator('[data-clip-kind="video"]').first();
		await beginClipDrag(page, thirdClip, firstVideo, 0.58);
		await expect(firstVideo).toHaveAttribute('data-video-overlap-state', 'invalid');
		await expect(firstVideo).toHaveAttribute('data-video-overlap-valid', 'false');
		await expect(firstVideo.locator('[data-invalid-video-overlap="true"]').first()).toBeVisible();
		await page.mouse.up();

		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'error');
		await expect(editor.locator('[data-status]')).toContainText(/overlap|transition/i);
		await expect(firstVideo.locator('[data-clip-kind="video"]')).toHaveCount(2);
		await expect(thirdVideo.locator('[data-clip-kind="video"]')).toHaveCount(1);
		await expect(thirdAudio.locator('[data-clip-id]')).toHaveCount(1);
		await expect(firstVideo).toHaveAttribute('data-video-overlap-state', 'crossfade');

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(firstVideo.locator('[data-clip-kind="video"]')).toHaveCount(1);
		await expect(secondVideo.locator('[data-clip-kind="video"]')).toHaveCount(1);
		await expect(firstAudio.locator('[data-clip-id]')).toHaveCount(1);
		await expect(secondAudio.locator('[data-clip-id]')).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(firstVideo.locator('[data-clip-kind="video"]')).toHaveCount(2);
		await expect(secondVideo.locator('[data-clip-kind="video"]')).toHaveCount(0);

		const fade = firstVideo.locator('[data-automatic-crossfade="true"]');
		const [fadeBox, rulerBox, playPauseBox] = await Promise.all([
			fade.boundingBox(),
			editor.locator('[data-ruler-interaction]').boundingBox(),
			editor.getByRole('button', { name: 'Play', exact: true }).boundingBox(),
		]);
		expect(fadeBox).not.toBeNull();
		expect(rulerBox).not.toBeNull();
		expect(playPauseBox).not.toBeNull();
		await page.mouse.click(
			fadeBox.x + fadeBox.width / 2,
			rulerBox.y + rulerBox.height * 0.75,
		);
		await page.mouse.click(
			playPauseBox.x + playPauseBox.width / 2,
			playPauseBox.y + playPauseBox.height / 2,
		);
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(preview).toHaveAttribute('data-active-track-count', '2');
		await expect(preview.locator('[data-video-preview-layer]')).toHaveCount(2);
		await expect(preview.locator('[data-video-preview-clip]')).toHaveCount(3);

		const outgoing = preview.locator('[data-transition-role="outgoing"]');
		const incoming = preview.locator('[data-transition-role="incoming"]');
		await expect(outgoing).toHaveCount(1);
		await expect(incoming).toHaveCount(1);
		await expect(incoming).toHaveCSS('mix-blend-mode', 'plus-lighter');
		const outgoingOpacity = Number(await outgoing.getAttribute('data-opacity'));
		const incomingOpacity = Number(await incoming.getAttribute('data-opacity'));
		expect(outgoingOpacity).toBeGreaterThan(0.3);
		expect(outgoingOpacity).toBeLessThan(0.7);
		expect(incomingOpacity).toBeGreaterThan(0.3);
		expect(incomingOpacity).toBeLessThan(0.7);
		expect(outgoingOpacity + incomingOpacity).toBeCloseTo(1, 6);

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => preview.locator('[data-video-preview-clip]').evaluateAll(
			(videos) => videos.some((video) => !video.paused),
		)).toBe(true);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		await thirdVideo.locator('.audio-editor-video-track-controls__title button').click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		await trackMenu.getByRole('button', { name: 'Move track to top', exact: true }).click();
		await expect(videoRows.first()).toHaveAttribute('data-track-id', thirdVideoId);
		await expect(preview.locator('[data-video-preview-layer]').last()).toHaveAttribute('data-track-id', thirdVideoId);

		await thirdVideo.locator('[data-track-action="visibility"]').click();
		await expect(thirdVideo).toHaveAttribute('data-hidden', 'true');
		await expect(preview.locator(`[data-video-preview-layer][data-track-id="${thirdVideoId}"]`)).toHaveCount(0);
		await expect(preview.locator('[data-video-preview-layer]').last()).toHaveAttribute('data-track-id', firstVideoId);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(thirdVideo).toHaveAttribute('data-hidden', 'false');
		await expect(preview.locator('[data-video-preview-layer]').last()).toHaveAttribute('data-track-id', thirdVideoId);
		expect(errors).toEqual([]);
	});
});

async function createGeneratedVideoFixture(page, options) {
	const base64 = await page.evaluate(async (fixture) => {
		const canvas = document.createElement('canvas');
		canvas.width = fixture.width;
		canvas.height = fixture.height;
		const context = canvas.getContext('2d');
		const videoStream = canvas.captureStream(15);
		const audioContext = new AudioContext({ sampleRate: 48_000 });
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		const audioDestination = audioContext.createMediaStreamDestination();
		oscillator.frequency.value = fixture.frequency;
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
			context.fillStyle = fixture.color;
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = fixture.accent;
			const markerSize = Math.max(5, Math.round(Math.min(canvas.width, canvas.height) / 5));
			const markerX = Math.round((canvas.width - markerSize) * frame / 13);
			context.fillRect(markerX, Math.round((canvas.height - markerSize) / 2), markerSize, markerSize);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		oscillator.stop();
		await audioContext.close();
		const blob = new Blob(chunks, { type: 'video/webm' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	}, options);
	return {
		name: options.name,
		mimeType: 'video/webm',
		buffer: Buffer.from(base64, 'base64'),
	};
}

async function bootVideoEditor(page) {
	await page.goto('/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await expect(editor.locator('[data-video-preview]')).toBeVisible();
	return editor;
}

async function importTimelineFiles(editor, files) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
}

function videoTrackById(editor, trackId) {
	return editor.locator(`[data-video-track][data-track-id="${trackId}"]`);
}

async function companionTrack(editor, videoTrack) {
	const index = Number(await videoTrack.getAttribute('data-track-index'));
	const companion = editor.locator('[data-track-row]').nth(index + 1);
	await expect(companion).not.toHaveAttribute('data-video-track', '');
	return companion;
}

async function beginClipDrag(page, clip, destinationTrack, horizontalFraction) {
	await clip.scrollIntoViewIfNeeded();
	const destinationLane = destinationTrack.locator('[data-track-lane]');
	const [clipBox, headerBox, laneBox] = await Promise.all([
		clip.boundingBox(),
		clip.locator('.audio-editor-video-clip__header').boundingBox(),
		destinationLane.boundingBox(),
	]);
	expect(clipBox).not.toBeNull();
	expect(headerBox).not.toBeNull();
	expect(laneBox).not.toBeNull();
	const startX = headerBox.x + headerBox.width / 2;
	const startY = headerBox.y + headerBox.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(
		startX + clipBox.width * horizontalFraction,
		laneBox.y + Math.min(42, laneBox.height / 2),
		{ steps: 8 },
	);
}

function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
