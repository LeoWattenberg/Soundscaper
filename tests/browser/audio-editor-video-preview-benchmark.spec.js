import { createHash } from 'node:crypto';

import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsAssistance,
} from '../../src/framescaper/editor-project-feature-requirements-assistance.ts';
import { validateFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { expect, test } from './helpers/nightly-packaged-electron.js';

import {
	createVideoPreviewBenchmarkFixture,
	videoPreviewBenchmarkMedia,
} from './fixtures/video-preview-benchmark-media.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { packagedRuntimeEnvironmentFingerprint } from './helpers/packaged-runtime-environment.js';
import { waitForPreviewFrameSample } from './helpers/preview-frame-sampling.js';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const WARMUP_TRIAL_COUNT = 1;
const MEASURED_TRIAL_COUNT = 5;
const MEASURED_FRAMES_PER_TRIAL = 121;
const MEASURED_INTERVALS_PER_TRIAL = MEASURED_FRAMES_PER_TRIAL - 1;
const FORCED_COLLECTIONS_PER_SNAPSHOT = 3;
const EFFECT_TYPES = Object.freeze([
	'color-adjust',
	'pixelate',
	'vignette',
	'gaussian-blur',
	'sharpen',
	'rgb-split',
	'chroma-key',
	'luma-key',
	'spill-suppression',
	'glow',
	'outline',
	'drop-shadow',
]);
const EFFECT_STACK = Object.freeze(EFFECT_TYPES.map((type, index) => createVideoEffect(type, {
	id: `m1-video-effect-${String(index + 1)}`,
})));

test('benchmarks the complete 720p video preview effect stack', async ({ runtimeBrowser, runtimeBaseURL }) => {
	test.skip(
		process.env.SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK !== '1',
		'Run explicitly with SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK=1.',
	);
	test.setTimeout(720_000);

	const fixture = createVideoPreviewBenchmarkFixture();
	const runtimeFixtureSha256 = createHash('sha256').update(fixture.buffer).digest('hex');
	expect(fixture.buffer.byteLength, 'runtime fixture byte length').toBe(videoPreviewBenchmarkMedia.byteLength);
	expect(runtimeFixtureSha256, 'runtime fixture SHA-256').toBe(videoPreviewBenchmarkMedia.sourceSha256);

	const warmup = await runPreviewTrial({
		runtimeBrowser,
		runtimeBaseURL,
		fixture,
		measured: false,
		trial: 0,
	});
	const trials = [];
	for (let trialIndex = 0; trialIndex < MEASURED_TRIAL_COUNT; trialIndex += 1) {
		const trial = await runPreviewTrial({
			runtimeBrowser,
			runtimeBaseURL,
			fixture,
			measured: true,
			trial: trialIndex + 1,
		});
		expect(trial.renderer, `trial ${String(trialIndex + 1)} renderer`).toEqual(warmup.renderer);
		trials.push(trial);
	}

	const rendererClass = softwareRenderer(warmup.renderer) ? 'software' : 'hardware';
	const environmentFingerprint = packagedRuntimeEnvironmentFingerprint(runtimeBrowser, warmup.renderer);
	const diagnostic = {
		schemaVersion: 1,
		profile: 'deterministic-video-preview-12fx-v2',
		observationClass: 'fresh-context-presentation-cadence-and-retained-js-heap-v1',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: videoPreviewBenchmarkMedia.id,
		environmentId: process.env.SOUNDSCAPER_M1_OBSERVED_ENVIRONMENT_ID ?? 'local-browser-correctness',
		rendererClass,
		environmentFingerprint,
		fixture: {
			width: videoPreviewBenchmarkMedia.display.width,
			height: videoPreviewBenchmarkMedia.display.height,
			effectCount: EFFECT_TYPES.length,
			measuredIntervals: MEASURED_INTERVALS_PER_TRIAL,
			sourceFrameRate: videoPreviewBenchmarkMedia.frameRate,
			sourceFrameCount: videoPreviewBenchmarkMedia.frameCount,
			sourceByteLength: fixture.buffer.byteLength,
			sourceSha256: runtimeFixtureSha256,
		},
		sampling: {
			warmupTrials: WARMUP_TRIAL_COUNT,
			measuredTrials: MEASURED_TRIAL_COUNT,
			measuredFramesPerTrial: MEASURED_FRAMES_PER_TRIAL,
			measuredIntervalsPerTrial: MEASURED_INTERVALS_PER_TRIAL,
			forcedCollectionsPerSnapshot: FORCED_COLLECTIONS_PER_SNAPSHOT,
		},
		trials: trials.map(({ renderer: _renderer, ...trial }) => trial),
	};
	console.log(`SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK ${JSON.stringify(diagnostic)}`);

	if (rendererClass === 'hardware') {
		const frameIntervals = diagnostic.trials.flatMap(({ frameTimestampsMs }) => (
			frameTimestampsMs.slice(1).map((time, index) => time - frameTimestampsMs[index])
		));
		const retainedHeapDeltas = diagnostic.trials.map(({ heapBefore, heapAfter }) => (
			heapAfter.usedSize - heapBefore.usedSize
		));
		expect(
			nearestRankP95(retainedHeapDeltas),
			'retained JS heap growth p95 across five fresh-context trials',
		).toBeLessThanOrEqual(1024 * 1024);
		expect(
			nearestRankP95(frameIntervals),
			'complete 1280x720 effect stack frame-interval p95',
		).toBeLessThanOrEqual(33.34);
	}
});

async function runPreviewTrial({ runtimeBrowser, runtimeBaseURL, fixture, measured, trial }) {
	const context = await runtimeBrowser.newContext({
		viewport: { width: 1_280, height: 720 },
		deviceScaleFactor: 1,
		serviceWorkers: 'block',
	});
	try {
		const page = await context.newPage();
		await installBenchmarkRoutes(page);
		const productUrl = resolveBrowserProductTestUrl('/framescaper/de/');
		await page.goto(/^https?:\/\//u.test(productUrl)
			? productUrl
			: new URL(productUrl, runtimeBaseURL).href);
		let editor = await bootVideoEditor(page);
		await importTimelineFiles(editor, [fixture]);
		await seedPreviewBenchmarkEffectStack(page, editor, EFFECT_STACK);
		await page.reload();
		editor = await bootVideoEditor(page);
		await enablePreviewBenchmarkLoop(editor);
		const canvas = await configurePreviewViewport(editor);
		const renderer = await previewRenderer(canvas);
		const cdp = measured ? await context.newCDPSession(page) : null;
		if (cdp !== null) await cdp.send('HeapProfiler.enable');
		const heapBefore = cdp === null
			? null
			: await usedHeapAfterCollections(cdp, FORCED_COLLECTIONS_PER_SNAPSHOT);
		await canvas.evaluate(() => {
			globalThis.__soundscaperPreviewFrameTimes.length = 0;
			globalThis.__soundscaperMeasurePreviewFrames = true;
		});
		const play = await startPreviewBenchmarkPlayback(editor);
		const playElement = await play.elementHandle();
		if (!playElement) throw new Error('The preview benchmark transport control is unavailable.');
		let frameTimestampsMs;
		try {
			frameTimestampsMs = await canvas.evaluate(waitForPreviewFrameSample, {
				transportButton: playElement,
				frameCount: MEASURED_FRAMES_PER_TRIAL,
				pollIntervalMs: 100,
				stallTimeoutMs: 10_000,
			});
		} finally {
			await playElement.dispose();
		}
		await editor.locator('[data-transport="stop"] button').evaluate((button) => button.click());
		if (cdp === null) return Object.freeze({ renderer });
		const heapAfter = await usedHeapAfterCollections(cdp, FORCED_COLLECTIONS_PER_SNAPSHOT);
		return Object.freeze({
			trial,
			frameTimestampsMs: Object.freeze(frameTimestampsMs),
			heapBefore,
			heapAfter,
			forcedCollectionsBefore: FORCED_COLLECTIONS_PER_SNAPSHOT,
			forcedCollectionsAfter: FORCED_COLLECTIONS_PER_SNAPSHOT,
			renderer,
		});
	} finally {
		await context.close();
	}
}

async function enablePreviewBenchmarkLoop(editor) {
	const loop = editor.locator('.kw-audio-editor__transport-state button');
	await expect(loop, 'one full-stack preview loop control').toHaveCount(1);
	if (await loop.getAttribute('aria-pressed') !== 'true') await loop.click();
	await expect(loop).toHaveAttribute('aria-pressed', 'true');
}

async function startPreviewBenchmarkPlayback(editor) {
	const play = editor.locator(
		'[data-transport="play"] .kw-audio-editor__split-button-main button',
	);
	if (await play.getAttribute('aria-pressed') !== 'true') {
		await play.evaluate((button) => button.click());
	}
	await expect(play).toHaveAttribute('aria-pressed', 'true');
	return play;
}

async function installBenchmarkRoutes(page) {
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
				) globalThis.__soundscaperPreviewFrameTimes.push(performance.now());
				return result;
			};
			renderingContext.__soundscaperInstrumented = true;
			return renderingContext;
		};
	});
}

async function bootVideoEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: /^(Decline|Ablehnen)$/u });
	if (await decline.isVisible()) await decline.click();
	if (await editor.getAttribute('data-workspace-preset') !== 'video-editor') {
		await page.locator('[data-sidebar] [data-workspace-select]').selectOption('video-editor');
	}
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await expect(editor.locator('[data-video-preview]')).toBeVisible();
	return editor;
}

async function configurePreviewViewport(editor) {
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
	await expect(preview).toHaveAttribute('data-active-video-effect-count', String(EFFECT_TYPES.length));
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect.poll(
		() => canvas.evaluate((element) => [element.width, element.height]),
		{ timeout: 30_000 },
	).toEqual([1_280, 720]);
	return canvas;
}

async function seedPreviewBenchmarkEffectStack(page, editor, effects) {
	const projectId = await editor.getAttribute('data-project-id');
	if (!projectId) throw new Error('The preview benchmark project identity is unavailable.');
	const project = await page.evaluate(async ({ databaseName, id }) => {
		const request = (value) => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result);
			value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			return await request(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
		} finally {
			database.close();
		}
	}, {
		databaseName: FRAMESCAPER_DATABASE_NAME,
		id: projectId,
	});
	if (!project) throw new Error(`Preview benchmark project ${projectId} was not found.`);
	const clip = project.clips?.find((candidate) => candidate.kind === 'video');
	if (!clip) throw new Error(`Preview benchmark project ${projectId} has no video clip.`);
	clip.videoEffects = structuredClone(effects);
	project.revision += 1;
	project.updatedAt = new Date().toISOString();
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(
		FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE,
		project,
	);
	validateFramescaperProject(FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE, project);
	await page.evaluate(async ({ databaseName, document }) => {
		const request = (value) => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result);
			value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction('projects', 'readwrite');
			const completion = new Promise((resolve, reject) => {
				transaction.oncomplete = resolve;
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			transaction.objectStore('projects').put(document);
			await completion;
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, document: project });
}

async function previewRenderer(canvas) {
	return canvas.evaluate((element) => {
		const gl = element.getContext('webgl2');
		const info = gl?.getExtension('WEBGL_debug_renderer_info');
		return {
			vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
			renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
		};
	});
}

async function usedHeapAfterCollections(cdp, collectionCount) {
	for (let collection = 0; collection < collectionCount; collection += 1) {
		await cdp.send('HeapProfiler.collectGarbage');
	}
	const { usedSize, totalSize } = await cdp.send('Runtime.getHeapUsage');
	return Object.freeze({ usedSize, totalSize });
}

async function importTimelineFiles(editor, files) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
}

function nearestRankP95(samples) {
	const sorted = samples.toSorted((left, right) => left - right);
	return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function softwareRenderer(renderer) {
	return /swiftshader|llvmpipe|software|offscreen/iu.test(`${String(renderer.vendor)} ${String(renderer.renderer)}`);
}
