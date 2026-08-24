import { expect, test } from '@playwright/test';

import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../../src/common/editor/video-source-professional-characteristics-v25.ts';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const EXACT_FRAME_COUNT = CFR.presentationTicks.length;
// What an ingest whose probe never ran would have written: no reading at all,
// and a nominal rate decided at import.
const FABRICATED_RATE = { num: 30, den: 1 };
const FABRICATED_FRAME_COUNT = Math.round(
	EXACT_FRAME_COUNT * FABRICATED_RATE.num * CFR.nominalRate.den / (FABRICATED_RATE.den * CFR.nominalRate.num),
);

test.describe('3B-2c re-import upgrade qualification', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('a source imported without a probe is re-read into exact timing', async ({ browserName, page }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(120_000);

		let editor = await openFramescaper(page);
		await importFixture(editor, page);

		// The import itself reads the file exactly, which is the state the upgrade
		// has to reproduce from nothing but the same bytes.
		const imported = await persistedVideoSource(page);
		expect(imported.frameRate).toEqual(CFR.nominalRate);
		expect(imported.sourceFrameCount).toBe(EXACT_FRAME_COUNT);
		expect(imported.timingDecision.mode).toBe('exact');

		// Degrading a document the editor has not finished writing would be
		// overwritten by its own pending save.
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
		await degradeToUnprobedIngest(page);
		await page.reload();
		editor = await reopenFramescaper(page);
		await editor.locator('[data-clip-kind="video"]').first().click();

		const degraded = await persistedVideoSource(page);
		expect(degraded.frameRate).toEqual(FABRICATED_RATE);
		expect(degraded.timingAsset).toBeNull();

		const placementBefore = await clipPlacement(page);
		const properties = await openSourceProperties(editor, page);
		// The panel discloses the staleness, and the action that repairs it is on
		// the same surface as the disclosure.
		await expect(properties.locator('[data-source-note="timing-unprobed"]')).toBeVisible();
		await properties.locator('[data-source-reprobe]').click();
		await expect(properties.locator('[data-source-reprobe-outcome]'))
			.toHaveAttribute('data-source-reprobe-outcome', 'upgraded', { timeout: 60_000 });

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
		const upgraded = await persistedVideoSource(page);
		expect(upgraded.frameRate).toEqual(CFR.nominalRate);
		expect(upgraded.sourceFrameCount).toBe(EXACT_FRAME_COUNT);
		expect(upgraded.timingDecision).toEqual({
			mode: 'exact',
			rate: CFR.nominalRate,
			backend: 'ffmpeg',
		});
		expect(upgraded.timingAsset).toMatchObject({
			sourceSha256: CFR.sourceSha256,
			frameCount: EXACT_FRAME_COUNT,
		});
		// The bytes are the identity and nothing about them moved.
		expect(upgraded.contentSha256).toBe(CFR.sourceSha256);
		expect(upgraded.sampleFrameCount).toBe(degraded.sampleFrameCount);
		// Every clip cut against the fabricated grid now shows the same media on
		// the real one, and none of them moved in its sequence.
		const clips = await persistedVideoClips(page);
		expect(clips.length).toBeGreaterThan(0);
		for (const clip of clips) {
			expect(clip.sourceInFrame).toBe(0);
			expect(clip.sourceFrameCount).toBe(EXACT_FRAME_COUNT);
		}
		expect(await clipPlacement(page)).toEqual(placementBefore);
		// The disclosure that motivated the action is gone.
		await expect(properties.locator('[data-source-note="timing-unprobed"]')).toHaveCount(0);
	});

	test('re-reading a source the document already describes exactly changes nothing', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(120_000);

		const editor = await openFramescaper(page);
		await importFixture(editor, page);
		const imported = await persistedVideoSource(page);

		const properties = await openSourceProperties(editor, page);
		await properties.locator('[data-source-reprobe]').click();
		await expect(properties.locator('[data-source-reprobe-outcome]'))
			.toHaveAttribute('data-source-reprobe-outcome', 'unchanged', { timeout: 60_000 });

		// A re-read that agrees writes nothing at all, not even a revision of the
		// same values.
		expect(await persistedVideoSource(page)).toEqual(imported);
	});
});

async function importFixture(editor, page) {
	await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
	await expect.poll(() => persistedVideoSource(page), { timeout: 60_000 }).toBeTruthy();
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	const name = CFR.file.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', { name: `Add to timeline: ${name}`, exact: true }).click();
}

async function openSourceProperties(editor, page) {
	await editor.getByRole('button', { name: 'Source properties', exact: true }).focus();
	await page.keyboard.press('Enter');
	const properties = page.getByRole('dialog', { name: 'Source properties', exact: true });
	await expect(properties.locator('[data-source-properties]')).not.toHaveAttribute('data-source-properties', 'empty');
	return properties;
}

/**
 * Rewrite the persisted document into the shape an ingest with no timing probe
 * produced: a fabricated nominal rate, nothing reported, no timing asset, and
 * every clip cut against that fabricated grid. The document stays a legal one —
 * this is the state the upgrade exists to repair, not an invalid fixture.
 */
async function degradeToUnprobedIngest(page) {
	await page.evaluate(async ({ databaseName, rate, frameCount, exactFrameCount, characteristics }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const store = database.transaction(['projects'], 'readwrite').objectStore('projects');
			for (const project of await request(store.getAll())) {
				const scale = (value) => Math.round(value * frameCount / exactFrameCount);
				for (const source of project.sources || []) {
					if (source.kind !== 'video') continue;
					source.frameRate = rate;
					source.sourceFrameCount = frameCount;
					source.timingAsset = null;
					source.timingDecision = {
						mode: 'conform-cfr-at-ingest',
						rate,
						reason: 'timing-probe-unavailable',
						failures: [],
					};
					source.characteristics = characteristics;
					source.videoCodec = 'unknown';
				}
				// An ingest that reported nothing owned neither a characteristics
				// record nor a timing asset, so the manifest has to say so too or
				// the document contradicts itself and will not open.
				const unowned = new Set(['framescaper.source-characteristics', 'framescaper.video-timing-assets']);
				if (project.featureRequirements?.requirements) {
					project.featureRequirements = {
						...project.featureRequirements,
						requirements: project.featureRequirements.requirements.filter(
							({ id }) => !unowned.has(id),
						),
					};
				}
				const clips = [...(project.clips || []), ...(project.projectBin?.clips || [])];
				for (const clip of clips) {
					if (clip.kind !== 'video') continue;
					const start = Math.min(scale(clip.sourceInFrame), frameCount - 1);
					const end = Math.min(scale(clip.sourceInFrame + clip.sourceFrameCount), frameCount);
					clip.sourceInFrame = start;
					clip.sourceFrameCount = Math.max(1, end - start);
				}
				await request(store.put(project));
			}
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		rate: FABRICATED_RATE,
		frameCount: FABRICATED_FRAME_COUNT,
		exactFrameCount: EXACT_FRAME_COUNT,
		characteristics: createUnreportedVideoSourceCharacteristicsV25(),
	});
}

async function clipPlacement(page) {
	return (await persistedVideoClips(page)).map(({ id, sequenceStartFrame, sequenceFrameCount }) => (
		[id, sequenceStartFrame, sequenceFrameCount]
	));
}

async function openFramescaper(page) {
	await page.goto('/framescaper/en/');
	return bindEditor(page);
}

async function reopenFramescaper(page) {
	return bindEditor(page);
}

async function bindEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function persistedVideoSource(page) {
	const projects = await persistedProjects(page);
	return projects
		.flatMap((project) => project.sources || [])
		.find((source) => source.kind === 'video' && source.name === CFR.file.name) ?? null;
}

async function persistedVideoClips(page) {
	const projects = await persistedProjects(page);
	return projects
		.flatMap((project) => [...(project.clips || []), ...(project.projectBin?.clips || [])])
		.filter((clip) => clip.kind === 'video');
}

async function persistedProjects(page) {
	return page.evaluate(async (databaseName) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			return await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
		} finally {
			database.close();
		}
	}, DATABASE_NAME);
}
