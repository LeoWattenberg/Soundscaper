import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
	M3_LONGFORM_EDITORIAL_FIXTURE_ID,
	M3_LONGFORM_EDITORIAL_PROFILE,
	M3_LONGFORM_EDITORIAL_SPECIFICATION,
	M3_LONGFORM_EDITORIAL_WORKLOAD_ID,
	createM3LongformEditorialWorkload,
} from '../../src/common/editor/quality/m3-longform-editorial-workload.ts';
import {
	bootEditor,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const DATABASE_NAME = 'kw-media-audio-editor';
const ENVIRONMENT_ID = 'reference-linux-gpu-01';
const SAMPLE_RATE = 48_000;
const VIDEO_FRAME_SAMPLES = 1_600;
const PIXELS_PER_SECOND = 120;
const CLIP_CONTENT_OFFSET = 12;

registerAudioEditorHooks();

test('collects the opt-in two-hour editorial diagnostic without qualifying the host', async ({
	page,
	context,
	browser,
}) => {
	test.skip(
		process.env.SOUNDSCAPER_M3_LONGFORM_BENCHMARK !== '1',
		'Run explicitly through quality:collect:m3-longform.',
	);
	test.setTimeout(360_000);
	await page.setViewportSize({ width: 1_440, height: 900 });
	const workload = createM3LongformEditorialWorkload();
	const expectedPositions = workload.editPlan.expectedClipPositions;
	const fixture = fixtureIdentity(workload);

	await bootEditor(page, '/embed/en/');
	await seedProject(page, workload.project);
	await page.reload();
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('.application-header__windows-title'))
		.toContainText('Milestone 3 two-hour editorial workload');
	await expect(editor).toHaveAttribute('data-track-count', '26');

	const positionChecks = await persistedPositionChecks(page, expectedPositions);
	expect(positionChecks).toHaveLength(26);
	expect(positionChecks.every(({ audioPositionErrorSamples }) => audioPositionErrorSamples === 0)).toBe(true);
	expect(positionChecks.every(({ videoPositionErrorFrames }) => videoPositionErrorFrames === 0)).toBe(true);

	const timeline = editor.locator('[data-timeline]');
	const ruler = editor.locator('[data-ruler]');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect(ruler).toBeVisible();

	await seekOnTimeline(page, timeline, ruler, playhead, SAMPLE_RATE * 30);
	const cdp = await context.newCDPSession(page);
	await cdp.send('HeapProfiler.enable');
	const beforeBytes = await usedHeapAfterCollections(cdp, 3);
	const seekTrials = [];
	for (const checkpointSample of M3_LONGFORM_EDITORIAL_SPECIFICATION.seekCheckpointsSamples) {
		seekTrials.push(await seekOnTimeline(
			page,
			timeline,
			ruler,
			playhead,
			checkpointSample,
		));
	}
	const scrollFrameIntervalsMs = await measureTimelineScrollFrames(
		timeline,
		M3_LONGFORM_EDITORIAL_SPECIFICATION.scrollFrameIntervalSampleCount,
	);
	const afterBytes = await usedHeapAfterCollections(cdp, 3);
	const renderer = await rendererDiagnostic(page);
	const environmentFingerprint = await browserFingerprint(page, browser, renderer);

	const diagnostic = {
		schemaVersion: 1,
		profile: M3_LONGFORM_EDITORIAL_PROFILE,
		observationClass: 'timeline-coordinate-diagnostic-no-decoded-media',
		workloadId: M3_LONGFORM_EDITORIAL_WORKLOAD_ID,
		fixtureId: M3_LONGFORM_EDITORIAL_FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		rendererClass: renderer.rendererClass,
		environmentFingerprint,
		fixture,
		positionChecks,
		seekWarmupTrialCount: 1,
		seekTrials,
		scrollFrameIntervalsMs,
		retainedHeap: {
			beforeBytes,
			afterBytes,
			forcedCollectionsBefore: 3,
			forcedCollectionsAfter: 3,
		},
	};
	console.log(`SOUNDSCAPER_M3_LONGFORM_EDITORIAL ${JSON.stringify(diagnostic)}`);
});

function fixtureIdentity(workload) {
	const specification = workload.specification;
	return {
		generatorRevision: specification.generatorRevision,
		seed: specification.seed,
		durationSeconds: specification.durationSeconds,
		sampleRate: specification.sampleRate,
		videoFrameRate: specification.videoFrameRate,
		audioTrackCount: specification.audioTrackCount,
		proxyVideoTrackCount: specification.proxyVideoTrackCount,
		editCount: specification.editCount,
		commandsPerTransaction: specification.commandsPerTransaction,
		operationCounts: specification.operationCounts,
		projectSha256: sha256(JSON.stringify(workload.project)),
		editPlanSha256: sha256(JSON.stringify(workload.editPlan.commands)),
	};
}

async function seedProject(page, project) {
	await page.evaluate(async ({ databaseName, document }) => {
		const request = (value) => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result);
			value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'settings'], 'readwrite');
			const completion = new Promise((resolve, reject) => {
				transaction.oncomplete = resolve;
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			transaction.objectStore('projects').put(document);
			const settings = transaction.objectStore('settings');
			settings.put({ key: 'soundscaper:last-project-id', value: document.id });
			settings.put({ key: 'last-project-id', value: document.id });
			settings.put({ key: 'soundscaper:audio-editor-recent-project-ids', value: [document.id] });
			settings.put({ key: 'soundscaper:timeline-ruler-playback', value: false });
			await completion;
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, document: project });
}

async function persistedPositionChecks(page, expectedPositions) {
	return page.evaluate(async ({ databaseName, fixtureId, expected, videoFrameSamples }) => {
		const request = (value) => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result);
			value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const project = await request(
				database.transaction('projects', 'readonly').objectStore('projects').get(fixtureId),
			);
			if (!project) throw new Error(`Persisted long-form project ${fixtureId} was not found.`);
			const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
			return expected.map((position) => {
				const clip = clipById.get(position.clipId);
				if (!clip) throw new Error(`Persisted long-form clip ${position.clipId} was not found.`);
				const observedTimelineSample = position.kind === 'video'
					? clip.sequenceStartFrame * videoFrameSamples
					: clip.timelineStartFrame;
				const observedVideoFrame = position.kind === 'video' ? clip.sequenceStartFrame : null;
				return {
					clipId: position.clipId,
					kind: position.kind,
					audioPositionErrorSamples: Math.abs(observedTimelineSample - position.timelineSample),
					videoPositionErrorFrames: position.videoFrame === null
						? 0
						: Math.abs(observedVideoFrame - position.videoFrame),
				};
			});
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		fixtureId: M3_LONGFORM_EDITORIAL_FIXTURE_ID,
		expected: expectedPositions,
		videoFrameSamples: VIDEO_FRAME_SAMPLES,
	});
}

async function seekOnTimeline(page, timeline, ruler, playhead, checkpointSample) {
	if (checkpointSample === 0) {
		const startedAt = await page.evaluate(() => performance.now());
		await playhead.focus();
		await page.keyboard.press('Home');
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		const elapsedMs = await page.evaluate((start) => performance.now() - start, startedAt);
		return { checkpointSample, observedAudioSample: 0, observedVideoFrame: 0, elapsedMs };
	}
	const clickX = await timeline.evaluate((element, options) => new Promise((resolve) => {
		const targetPixel = options.checkpointSample / options.sampleRate * options.pixelsPerSecond;
		const maximumScroll = element.scrollWidth - element.clientWidth;
		element.scrollLeft = Math.min(maximumScroll, Math.max(0, targetPixel - 100));
		requestAnimationFrame(() => resolve(
			options.contentOffset + targetPixel - element.scrollLeft,
		));
	}), {
		checkpointSample,
		sampleRate: SAMPLE_RATE,
		pixelsPerSecond: PIXELS_PER_SECOND,
		contentOffset: CLIP_CONTENT_OFFSET,
	});
	const startedAt = await page.evaluate(() => performance.now());
	await ruler.click({ position: { x: clickX, y: 28 } });
	await expect(playhead).toHaveAttribute('aria-valuenow', String(checkpointSample));
	const elapsedMs = await page.evaluate((start) => performance.now() - start, startedAt);
	const observedAudioSample = Number(await playhead.getAttribute('aria-valuenow'));
	return {
		checkpointSample,
		observedAudioSample,
		observedVideoFrame: observedAudioSample / VIDEO_FRAME_SAMPLES,
		elapsedMs,
	};
}

async function measureTimelineScrollFrames(timeline, sampleCount) {
	return timeline.evaluate((element, expectedSamples) => new Promise((resolve, reject) => {
		const maximum = element.scrollWidth - element.clientWidth;
		if (!(maximum > 0)) {
			reject(new Error('Long-form timeline is not horizontally scrollable.'));
			return;
		}
		const frameTimes = [];
		const sample = (time) => {
			frameTimes.push(time);
			if (frameTimes.length === expectedSamples + 1) {
				resolve(frameTimes.slice(1).map((value, index) => value - frameTimes[index]));
				return;
			}
			element.scrollLeft = maximum * frameTimes.length / expectedSamples;
			requestAnimationFrame(sample);
		};
		element.scrollLeft = 0;
		requestAnimationFrame(sample);
	}), sampleCount);
}

async function usedHeapAfterCollections(cdp, collectionCount) {
	for (let index = 0; index < collectionCount; index += 1) {
		await cdp.send('HeapProfiler.collectGarbage');
	}
	return (await cdp.send('Runtime.getHeapUsage')).usedSize;
}

async function rendererDiagnostic(page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
		const info = gl?.getExtension('WEBGL_debug_renderer_info');
		const vendor = gl
			? String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR))
			: 'unavailable';
		const renderer = gl
			? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
			: 'unavailable';
		const joined = `${vendor} ${renderer}`;
		return {
			vendor,
			renderer,
			rendererClass: !gl
				? 'unknown'
				: /swiftshader|llvmpipe|software|offscreen/iu.test(joined) ? 'software' : 'hardware',
		};
	});
}

async function browserFingerprint(page, browser, renderer) {
	const values = await page.evaluate(() => ({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		logicalCpuCount: navigator.hardwareConcurrency,
		deviceMemoryGiB: navigator.deviceMemory ?? null,
		displayMode: `${screen.width}x${screen.height}@${devicePixelRatio}`,
		displayRefreshHz: null,
		powerProfile: null,
	}));
	return {
		...values,
		browserVersion: browser.version(),
		browserBinarySha256: null,
		gpuVendor: renderer.vendor,
		gpuModel: renderer.renderer,
		gpuMemoryBytes: null,
		gpuDriver: null,
	};
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
