import { expect, test } from '@playwright/test';

import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');

test.describe('3B-4a shuttle and edit-point navigation', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('the fixed shuttle and edit-point keys drive one programme playhead', async ({ browserName, page }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(180_000);

		const editor = await openFramescaper(page);
		await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).toHaveLength(1);

		// Three head inserts make four contiguous edits without inventing a test-only
		// document. Their starts and the programme tail are the distinct edit points.
		await page.locator('[data-bin-action="insert"]').first().click();
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).toHaveLength(2);
		await page.locator('[data-bin-action="insert"]').first().click();
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).toHaveLength(3);
		await page.locator('[data-bin-action="insert"]').first().click();
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).toHaveLength(4);
		const clips = await timelineVideoClips(page);
		const editPoints = [...new Set(clips.flatMap((clip) => [
			clip.sequenceStartFrame,
			clip.sequenceStartFrame + clip.sequenceFrameCount,
		]))].sort((left, right) => left - right);
		expect(editPoints).toHaveLength(5);

		const readout = editor.locator('[data-sequence-timecode]');
		const rate = await sequenceRate(page);
		expect(rate.den).toBe(1);
		await expectSequenceFrame(readout, rate.num, editPoints[0]);

		// Shuttle and edit-point navigation is reached by its fixed workspace keys; the
		// menubar no longer carries a transport menu for them.
		await pressWorkspaceKey(page, editor, 'ArrowDown');
		await expectSequenceFrame(readout, rate.num, editPoints[1]);
		for (let index = 2; index < editPoints.length; index += 1) {
			await pressWorkspaceKey(page, editor, 'ArrowDown');
			await expectSequenceFrame(readout, rate.num, editPoints[index]);
		}
		await pressWorkspaceKey(page, editor, 'ArrowDown');
		await expectSequenceFrame(readout, rate.num, editPoints.at(-1));
		await pressWorkspaceKey(page, editor, 'ArrowUp');
		await expectSequenceFrame(readout, rate.num, editPoints.at(-2));
		await pressWorkspaceKey(page, editor, 'ArrowUp');
		await expectSequenceFrame(readout, rate.num, editPoints.at(-3));
		for (let index = editPoints.length - 4; index >= 1; index -= 1) {
			await pressWorkspaceKey(page, editor, 'ArrowUp');
			await expectSequenceFrame(readout, rate.num, editPoints[index]);
		}
		await expectSequenceFrame(readout, rate.num, editPoints[1]);

		// Forward shuttle and keyboard stop operate on the same session.
		await pressWorkspaceKey(page, editor, 'L');
		await expect.poll(() => sequenceFrame(readout, rate.num)).toBeGreaterThan(editPoints[1]);
		await pressWorkspaceKey(page, editor, 'K');
		const forwardStopFrame = await sequenceFrame(readout, rate.num);
		expect(forwardStopFrame).toBeGreaterThan(editPoints[1]);
		await expectSequenceFrame(readout, rate.num, forwardStopFrame);

		// A held L emits one deliberate keydown followed by repeat=true. It stays at
		// +1x; a later deliberate L advances exactly one rung to +2x. Neither press
		// reaches the legacy Loop preference binding in Framescaper.
		await beginStatusObservation(editor);
		await focusWorkspace(editor);
		await editor.evaluate((element) => {
			const emit = (type, repeat = false) => element.dispatchEvent(new KeyboardEvent(type, {
				bubbles: true,
				cancelable: true,
				key: 'l',
				repeat,
			}));
			emit('keydown');
			emit('keydown', true);
			emit('keyup');
			emit('keydown');
			emit('keyup');
		});
		await expectObservedStatus(editor, /2(?:x|×)/u);
		// The shuttle rung is reported in the status line rather than a menu check mark.
		await page.keyboard.press('Escape');
		await pressWorkspaceKey(page, editor, 'K');

		// Reverse supplies descending sequence boundaries, then K holds that frame
		// rather than calling the ordinary zero-resetting Stop command.
		const reverseStart = await sequenceFrame(readout, rate.num);
		await pressWorkspaceKey(page, editor, 'J');
		await expect.poll(() => sequenceFrame(readout, rate.num)).toBeLessThan(reverseStart);
		await pressWorkspaceKey(page, editor, 'K');
		const reverseStopFrame = await sequenceFrame(readout, rate.num);
		expect(reverseStopFrame).toBeLessThan(reverseStart);

		// The feature remains menu-only when its menus are closed.
		await expect(editor.getByRole('button', { name: /(?:Reverse|Forward) shuttle/u })).toHaveCount(0);
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

async function focusWorkspace(editor) {
	await editor.evaluate((element) => {
		element.tabIndex = -1;
		element.focus({ preventScroll: true });
	});
}

async function pressWorkspaceKey(page, editor, key) {
	await focusWorkspace(editor);
	await page.keyboard.press(key);
}

// Observe the editor root rather than the status node itself. A re-render can
// replace that node outright, which orphans an observer bound to it: the array
// then keeps only the announcement present at setup and every later one is lost.
// That is how a held-L shuttle run reported just "Shuttle stopped …" on Firefox
// while the +2x rung it was asserting had been announced on a fresh node.
async function beginStatusObservation(editor) {
	await editor.evaluate((element) => {
		const previous = globalThis.__soundscaperShuttleStatusObservation;
		previous?.observer?.disconnect();
		const values = [];
		const read = () => element.querySelector('[data-status]')?.textContent || '';
		const record = () => {
			const value = read();
			if (values.at(-1) !== value) values.push(value);
		};
		const observer = new MutationObserver(record);
		observer.observe(element, { childList: true, characterData: true, subtree: true });
		globalThis.__soundscaperShuttleStatusObservation = { observer, values };
		record();
	});
}

async function expectObservedStatus(editor, expected) {
	await expect.poll(() => editor.evaluate(() => (
		globalThis.__soundscaperShuttleStatusObservation?.values ?? []
	))).toContainEqual(expect.stringMatching(expected));
	await editor.evaluate(() => {
		globalThis.__soundscaperShuttleStatusObservation?.observer?.disconnect();
		delete globalThis.__soundscaperShuttleStatusObservation;
	});
}

async function expectSequenceFrame(readout, framesPerSecond, expected) {
	await expect.poll(() => sequenceFrame(readout, framesPerSecond)).toBe(expected);
}

async function sequenceFrame(readout, framesPerSecond) {
	const label = await readout.getAttribute('data-sequence-timecode');
	const match = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/u.exec(label || '');
	if (!match) return null;
	const [, hours, minutes, seconds, frames] = match.map(Number);
	return (((hours * 60 + minutes) * 60 + seconds) * framesPerSecond) + frames;
}

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

async function timelineVideoClips(page) {
	return (await persistedClips(page, 'timeline'))
		.map(({ id, sequenceStartFrame, sequenceFrameCount }) => ({
			id, sequenceStartFrame, sequenceFrameCount,
		}))
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
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
