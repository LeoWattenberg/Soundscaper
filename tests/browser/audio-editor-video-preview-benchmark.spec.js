import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test('benchmarks the complete 720p video preview effect stack', async ({ page, context, browser }) => {
	test.skip(
		process.env.SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK !== '1',
		'Run explicitly with SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK=1.',
	);
	test.setTimeout(360_000);
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
	await page.addInitScript(() => {
		globalThis.__soundscaperPreviewFrameTimes = [];
		globalThis.__soundscaperMeasurePreviewFrames = false;
		const originalGetContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function getInstrumentedContext(type, ...args) {
			const renderingContext = originalGetContext.call(this, type, ...args);
			if (type !== 'webgl2' || !renderingContext || renderingContext.__soundscaperInstrumented) {
				return renderingContext;
			}
			const canvas = this;
			let boundFramebuffer = null;
			const originalBindFramebuffer = renderingContext.bindFramebuffer.bind(renderingContext);
			const originalDrawArrays = renderingContext.drawArrays.bind(renderingContext);
			renderingContext.bindFramebuffer = (target, framebuffer) => {
				if (target === renderingContext.FRAMEBUFFER) boundFramebuffer = framebuffer;
				return originalBindFramebuffer(target, framebuffer);
			};
			renderingContext.drawArrays = (mode, first, count) => {
				const result = originalDrawArrays(mode, first, count);
				if (
					boundFramebuffer === null
					&& canvas.hasAttribute('data-video-preview-canvas')
					&& globalThis.__soundscaperMeasurePreviewFrames
				) {
					renderingContext.finish();
					globalThis.__soundscaperPreviewFrameTimes.push(performance.now());
				}
				return result;
			};
			renderingContext.__soundscaperInstrumented = true;
			return renderingContext;
		};
	});

	const fixture = await createGeneratedVideoFixture(page, {
		name: 'video-preview-benchmark.webm',
		color: '#2f3e79',
		accent: '#f1c75b',
		frequency: 330,
		width: 1_280,
		height: 720,
		frameCount: 600,
		frameDelayMs: 40,
	});
	const editor = await bootVideoEditor(page);
	await importTimelineFiles(editor, [fixture]);
	const videoClip = editor.locator('[data-clip-kind="video"]').first();
	await videoClip.click({ button: 'right' });
	const clipMenu = page.locator('.audio-editor-clip-context-menu');
	await expect(clipMenu).toBeVisible();
	await clipMenu.locator('[data-action-id="clip-properties"]').click();
	const dialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
	const rack = dialog.locator('[data-video-effect-rack]');
	const picker = rack.locator('[data-video-effect-picker]');
	const addEffect = rack.getByRole('button', { name: 'Add effect', exact: true });
	const effectLabels = [
		'Color Adjust',
		'Pixelate',
		'Vignette',
		'Gaussian Blur',
		'Sharpen',
		'RGB Split',
	];
	for (let index = 0; index < effectLabels.length; index += 1) {
		await picker.getByRole('button').click();
		await page.locator('[role="option"]:visible').nth(index).click();
		await addEffect.click();
		await expect(rack.locator('[data-video-effect-id]')).toHaveCount(index + 1);
	}
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();

	const preview = editor.locator('[data-video-preview]');
	const canvas = preview.locator('[data-video-preview-canvas]');
	await preview.evaluate((element) => {
		element.style.position = 'fixed';
		element.style.inset = '0 auto auto 0';
		element.style.width = '1280px';
		element.style.height = '720px';
		element.style.minHeight = '0';
		element.style.zIndex = '9999';
		element.style.pointerEvents = 'none';
	});
	await expect(preview).toHaveAttribute('data-active-video-effect-count', '6');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect.poll(() => canvas.evaluate((element) => [element.width, element.height])).toEqual([1_280, 720]);

	const renderer = await canvas.evaluate((element) => {
		const gl = element.getContext('webgl2');
		const info = gl?.getExtension('WEBGL_debug_renderer_info');
		return {
			vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
			renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
		};
	});
	const cdp = await context.newCDPSession(page);
	await cdp.send('HeapProfiler.enable');
	await canvas.evaluate(() => {
		globalThis.__soundscaperPreviewFrameTimes.length = 0;
		globalThis.__soundscaperMeasurePreviewFrames = true;
	});
	await editor.getByRole('button', { name: 'Play', exact: true }).evaluate((button) => button.click());
	await expect.poll(
		() => canvas.evaluate(() => globalThis.__soundscaperPreviewFrameTimes.length),
		{ timeout: 60_000 },
	).toBeGreaterThanOrEqual(10);
	const warmupFrames = await canvas.evaluate(() => {
		globalThis.__soundscaperMeasurePreviewFrames = false;
		const count = globalThis.__soundscaperPreviewFrameTimes.length;
		globalThis.__soundscaperPreviewFrameTimes.length = 0;
		return count;
	});
	await cdp.send('HeapProfiler.collectGarbage');
	const heapBefore = await cdp.send('Runtime.getHeapUsage');
	await canvas.evaluate(() => {
		globalThis.__soundscaperPreviewFrameTimes.length = 0;
		globalThis.__soundscaperMeasurePreviewFrames = true;
	});
	await expect.poll(
		() => canvas.evaluate(() => globalThis.__soundscaperPreviewFrameTimes.length),
		{ timeout: 240_000 },
	).toBeGreaterThanOrEqual(121);
	const timings = await canvas.evaluate(() => {
		globalThis.__soundscaperMeasurePreviewFrames = false;
		const measured = globalThis.__soundscaperPreviewFrameTimes.slice(0, 121);
		globalThis.__soundscaperPreviewFrameTimes.length = 0;
		return measured;
	});
	await editor.getByRole('button', { name: 'Stop', exact: true }).evaluate((button) => button.click());
	await cdp.send('HeapProfiler.collectGarbage');
	const heapAfter = await cdp.send('Runtime.getHeapUsage');
	const browserEnvironment = await page.evaluate(() => ({
		devicePixelRatio: globalThis.devicePixelRatio,
		hardwareConcurrency: navigator.hardwareConcurrency,
		userAgent: navigator.userAgent,
	}));

	const intervals = timings.slice(1).map((time, index) => time - timings[index]);
	const sortedIntervals = intervals.toSorted((left, right) => left - right);
	const p95Ms = sortedIntervals[Math.ceil(sortedIntervals.length * 0.95) - 1];
	const meanMs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
	const result = {
		resolution: await canvas.evaluate((element) => [element.width, element.height]),
		effects: effectLabels,
		warmupFrames,
		measuredFrames: timings.length,
		measuredIntervals: intervals.length,
		p95Ms,
		p95Fps: 1_000 / p95Ms,
		meanMs,
		meanFps: 1_000 / meanMs,
		minMs: sortedIntervals[0],
		maxMs: sortedIntervals.at(-1),
		retainedJsHeapBeforeBytes: heapBefore.usedSize,
		retainedJsHeapAfterBytes: heapAfter.usedSize,
		retainedJsHeapDeltaBytes: heapAfter.usedSize - heapBefore.usedSize,
		renderer,
		browserVersion: browser.version(),
		browserEnvironment,
	};
	console.log(`SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK ${JSON.stringify(result)}`);
	expect(
		result.retainedJsHeapDeltaBytes,
		'retained JS heap growth after 120 measured frames and forced GC',
	).toBeLessThanOrEqual(1024 * 1024);
	expect(p95Ms, 'complete 1280x720 effect stack p95 frame interval').toBeLessThanOrEqual(33.34);
});

async function createGeneratedVideoFixture(page, options) {
	const base64 = await page.evaluate(async (fixture) => {
		const canvas = document.createElement('canvas');
		canvas.width = fixture.width;
		canvas.height = fixture.height;
		const context = canvas.getContext('2d');
		const videoStream = canvas.captureStream(30);
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
			videoBitsPerSecond: 1_500_000,
			audioBitsPerSecond: 32_000,
		});
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < fixture.frameCount; frame += 1) {
			context.fillStyle = fixture.color;
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = fixture.accent;
			const markerSize = Math.max(5, Math.round(Math.min(canvas.width, canvas.height) / 5));
			const denominator = Math.max(1, fixture.frameCount - 1);
			const markerX = Math.round((canvas.width - markerSize) * frame / denominator);
			context.fillRect(markerX, Math.round((canvas.height - markerSize) / 2), markerSize, markerSize);
			await new Promise((resolve) => setTimeout(resolve, fixture.frameDelayMs));
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
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('video-editor');
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
