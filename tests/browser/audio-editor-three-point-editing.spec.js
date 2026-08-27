import { expect, test } from '@playwright/test';

import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import {
	DURABLE_MEDIA_STORAGE_REQUIRED,
	hasDurableMediaStorageCapability,
} from './helpers/durable-media-storage-capability.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const SOURCE_FRAMES = CFR.presentationTicks.length;

test.describe('3B-3a three-point editing qualification', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('a bin item overwrites and inserts into the targeted lane', async ({ page }) => {
		test.setTimeout(120_000);

		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);
		await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
		// The import lands in the Project Bin, which is where an edit is sourced.
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).not.toHaveLength(0);

		// A video lane exists, so it can be targeted explicitly.
		const target = editor.locator('[data-track-action="target"]').first();
		await expect(target).toBeVisible();
		await expect(target).toHaveAttribute('aria-pressed', 'true');

		const binItem = page.locator('[data-bin-action="overwrite"]').first();
		await expect(binItem).toBeVisible();
		const before = await timelineVideoClips(page);
		expect(before.length).toBe(1);

		// The existing clip covers the whole programme and the overwrite covers the
		// same span, so it is replaced in place rather than added beside.
		await binItem.click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.id, { timeout: 30_000 })
			.not.toBe(before[0].id);
		const overwritten = await timelineVideoClips(page);
		expect(overwritten.length).toBe(1);
		// The whole source decided the extent, so the placed clip carries every
		// source frame the probe found.
		expect(overwritten[0].sourceInFrame).toBe(0);
		expect(overwritten[0].sourceFrameCount).toBe(SOURCE_FRAMES);
		expect(overwritten[0].sequenceStartFrame).toBe(0);
		// The sequence runs at its own rate, so the extent is the source count
		// changed into that basis once — not copied across as if the grids matched.
		const rate = await sequenceRate(page);
		expect(overwritten[0].sequenceFrameCount).toBe(Math.round(
			SOURCE_FRAMES * rate.num * CFR.nominalRate.den / (rate.den * CFR.nominalRate.num),
		));

		// Insert opens the lane rather than replacing in place, so the programme
		// grows by the inserted span.
		const beforeInsert = await sequenceExtent(page);
		await page.locator('[data-bin-action="insert"]').first().click();
		await expect.poll(() => sequenceExtent(page), { timeout: 30_000 }).toBeGreaterThan(beforeInsert);

		// Undo is a property of the command system and is proved against the
		// document in tests/audio-editor-three-point-edit-commands.test.ts; this
		// spec proves the workflow reaches the document at all.
	});

	test('untargeting the only video lane refuses the edit instead of guessing', async ({
		page,
	}) => {
		test.setTimeout(120_000);

		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);
		await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).not.toHaveLength(0);

		const target = editor.locator('[data-track-action="target"]').first();
		await target.click();
		await expect(target).toHaveAttribute('aria-pressed', 'false');

		const before = await timelineVideoClips(page);
		await page.locator('[data-bin-action="overwrite"]').first().click();
		// The refusal is surfaced, and nothing was placed.
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
		expect(await timelineVideoClips(page)).toEqual(before);
	});
});

async function addToTimeline(editor) {
	const name = CFR.file.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', { name: `Add to timeline: ${name}`, exact: true }).click();
}

async function openFramescaper(page) {
	await page.goto('/framescaper/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function timelineVideoClips(page) {
	return (await persistedVideoClips(page))
		.map(({ id, sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount }) => ({
			id, sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
		}))
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
}

/** How much programme the sequence holds, in sequence frames. */
async function sequenceExtent(page) {
	const clips = await timelineVideoClips(page);
	return clips.reduce((end, clip) => Math.max(end, clip.sequenceStartFrame + clip.sequenceFrameCount), 0);
}

/** The rate of the sequence the edit landed in. */
async function sequenceRate(page) {
	return page.evaluate(async (databaseName) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const projects = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			return projects.flatMap((project) => project.sequences || [])[0]?.rate ?? null;
		} finally {
			database.close();
		}
	}, DATABASE_NAME);
}

async function binVideoClips(page) {
	return persistedClips(page, 'bin');
}

async function persistedVideoClips(page) {
	return persistedClips(page, 'timeline');
}

async function persistedClips(page, scope) {
	return page.evaluate(async ({ databaseName, where }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const projects = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			return projects.flatMap((project) => (
				where === 'bin' ? project.projectBin?.clips || [] : project.clips || []
			).filter((clip) => clip.kind === 'video'));
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, where: scope });
}
