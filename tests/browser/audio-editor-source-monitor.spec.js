import { expect, test } from '@playwright/test';

import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const MARK_IN = 4;
const MARK_OUT_FRAME = 13;
const MARKED_FRAMES = MARK_OUT_FRAME + 1 - MARK_IN;
const SOURCE_FRAMES = CFR.presentationTicks.length;

test.describe('3B-3b source monitor qualification', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('a marked range edits, matches back, and replaces in place', async ({ browserName, page }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(180_000);

		const editor = await openFramescaper(page);
		await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).not.toHaveLength(0);

		// The source opens on its own frame grid, at its head, with nothing marked.
		await page.locator('[data-bin-action="source-monitor"]').first().click();
		const monitor = page.locator('[data-source-monitor]');
		await expect(monitor).toBeVisible();
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', '0');
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '');

		await scrubTo(page, MARK_IN);
		await page.locator('[data-source-monitor-action="mark-in"]').click();
		await scrubTo(page, MARK_OUT_FRAME);
		await page.locator('[data-source-monitor-action="mark-out"]').click();
		// The out is exclusive, so marking a frame keeps it.
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', String(MARK_IN));
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', String(MARK_OUT_FRAME + 1));

		const rate = await sequenceRate(page);
		const markedExtent = Math.round(
			MARKED_FRAMES * rate.num * CFR.nominalRate.den / (rate.den * CFR.nominalRate.num),
		);
		const beforeOverwrite = await timelineVideoClips(page);
		expect(beforeOverwrite.length).toBe(1);

		// The marked range is shorter than what is on air, so the overwrite lands
		// in front of a surviving tail rather than replacing the whole clip.
		await page.locator('[data-bin-action="overwrite"]').first().click();
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).toHaveLength(2);
		const overwritten = await timelineVideoClips(page);
		expect(overwritten[0].sequenceStartFrame).toBe(0);
		expect(overwritten[0].sequenceFrameCount).toBe(markedExtent);
		expect(overwritten[0].sourceInFrame).toBe(MARK_IN);
		expect(overwritten[0].sourceFrameCount).toBe(MARKED_FRAMES);
		expect(overwritten[1].sequenceStartFrame).toBe(markedExtent);

		// Match-frame from the playhead, which is still at the head of the
		// programme, names the frame that landed there and leaves the monitor
		// holding exactly the material that clip uses.
		await scrubTo(page, 0);
		await page.locator('[data-source-monitor-action="match-frame"]').click();
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', String(MARK_IN));
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', String(MARK_IN));
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', String(MARK_IN + MARKED_FRAMES));

		// Replace keeps the placement and the extent and changes only the media.
		await scrubTo(page, MARK_IN + 2);
		await page.locator('[data-source-monitor-action="replace"]').click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.sourceInFrame, { timeout: 30_000 })
			.toBe(MARK_IN + 2);
		const replaced = await timelineVideoClips(page);
		expect(replaced).toHaveLength(2);
		expect(replaced[0].sequenceStartFrame).toBe(0);
		expect(replaced[0].sequenceFrameCount).toBe(markedExtent);
		expect(replaced[0].sourceFrameCount).toBe(MARKED_FRAMES);
		expect(replaced[1].sequenceStartFrame).toBe(markedExtent);
	});

	test('clearing the marks puts the whole source back in the edit', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(180_000);

		const editor = await openFramescaper(page);
		await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).not.toHaveLength(0);
		await page.locator('[data-bin-action="source-monitor"]').first().click();
		const monitor = page.locator('[data-source-monitor]');
		await expect(monitor).toBeVisible();

		await scrubTo(page, MARK_IN);
		await page.locator('[data-source-monitor-action="mark-in"]').click();
		await scrubTo(page, MARK_OUT_FRAME);
		await page.locator('[data-source-monitor-action="mark-out"]').click();
		await page.locator('[data-bin-action="overwrite"]').first().click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.sourceFrameCount, { timeout: 30_000 })
			.toBe(MARKED_FRAMES);

		// Marking changes what an edit uses, not how it resolves: with the marks
		// cleared the media's own boundaries fill in again, and the same action
		// places the whole source over everything the marked one left behind.
		await page.locator('[data-source-monitor-action="clear-marks"]').click();
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '');
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', '');
		await page.locator('[data-bin-action="overwrite"]').first().click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.sourceFrameCount, { timeout: 30_000 })
			.toBe(SOURCE_FRAMES);
		const whole = await timelineVideoClips(page);
		expect(whole).toHaveLength(1);
		expect(whole[0].sourceInFrame).toBe(0);
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

/** Put the monitor's playhead on one source frame through its own control. */
async function scrubTo(page, frame) {
	const scrub = page.locator('[data-source-monitor-scrub]');
	await scrub.fill(String(frame));
	await expect(page.locator('[data-source-monitor]'))
		.toHaveAttribute('data-source-monitor-frame', String(frame));
}

async function timelineVideoClips(page) {
	return (await persistedClips(page, 'timeline'))
		.map(({ id, sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount }) => ({
			id, sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
		}))
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
}

async function binVideoClips(page) {
	return persistedClips(page, 'bin');
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
