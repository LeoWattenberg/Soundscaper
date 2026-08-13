import { expect, test } from '@playwright/test';

import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { chooseNestedCommandAction, getMenuItem } from './audio-editor-test-helpers.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const TRANSPORT_MENU = 'Playback and recording';
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

	test('the Transport submenu and fixed keys share one programme playhead', async ({ browserName, page }) => {
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

		// Every command is discoverable in the existing menu; one menu activation
		// and the matching workspace keys then traverse strict, non-wrapping points.
		const initialMenu = await openShuttleMenu(page, editor);
		for (const label of [
			'Previous edit',
			'Reverse shuttle',
			'Shuttle stop',
			'Forward shuttle',
			'Next edit',
		]) {
			await expect(getMenuItem(initialMenu, label)).toBeVisible();
		}
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await chooseNestedCommandAction(page, editor, TRANSPORT_MENU, ['Shuttle and edit points', 'Next edit']);
		await expectSequenceFrame(readout, rate.num, editPoints[1]);
		for (let index = 2; index < editPoints.length; index += 1) {
			await pressWorkspaceKey(page, editor, 'ArrowDown');
			await expectSequenceFrame(readout, rate.num, editPoints[index]);
		}
		await pressWorkspaceKey(page, editor, 'ArrowDown');
		await expectSequenceFrame(readout, rate.num, editPoints.at(-1));
		await pressWorkspaceKey(page, editor, 'ArrowUp');
		await expectSequenceFrame(readout, rate.num, editPoints.at(-2));
		await chooseNestedCommandAction(page, editor, TRANSPORT_MENU, ['Shuttle and edit points', 'Previous edit']);
		await expectSequenceFrame(readout, rate.num, editPoints.at(-3));
		for (let index = editPoints.length - 4; index >= 1; index -= 1) {
			await pressWorkspaceKey(page, editor, 'ArrowUp');
			await expectSequenceFrame(readout, rate.num, editPoints[index]);
		}
		await expectSequenceFrame(readout, rate.num, editPoints[1]);

		// Menu forward shuttle and keyboard stop operate on the same session.
		await chooseNestedCommandAction(page, editor, TRANSPORT_MENU, ['Shuttle and edit points', 'Forward shuttle']);
		await expect.poll(() => sequenceFrame(readout, rate.num)).toBeGreaterThan(editPoints[1]);
		await pressWorkspaceKey(page, editor, 'K');
		const forwardStopFrame = await sequenceFrame(readout, rate.num);
		expect(forwardStopFrame).toBeGreaterThan(editPoints[1]);
		const stoppedMenu = await openShuttleMenu(page, editor);
		await expect(getMenuItem(stoppedMenu, 'Shuttle stop')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await expectSequenceFrame(readout, rate.num, forwardStopFrame);

		// A held L emits one deliberate keydown followed by repeat=true. It stays at
		// +1x; a later deliberate L advances exactly one rung to +2x. Neither press
		// reaches the legacy Loop preference binding in Framescaper.
		await focusWorkspace(editor);
		await page.keyboard.down('l');
		await page.keyboard.down('l');
		await page.keyboard.up('l');
		await expect(editor.locator('[data-status]')).toContainText(/1(?:x|×)/u);
		await pressWorkspaceKey(page, editor, 'L');
		await expect(editor.locator('[data-status]')).toContainText(/2(?:x|×)/u);
		const runningMenu = await openShuttleMenu(page, editor);
		await expect(getMenuItem(runningMenu, 'Forward shuttle')).toHaveAttribute('aria-checked', 'true');
		await expect(getMenuItem(page.getByRole('menu', { name: TRANSPORT_MENU, exact: true }), 'Loop'))
			.toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
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

async function openShuttleMenu(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: TRANSPORT_MENU, exact: true }).click();
	const transport = page.getByRole('menu', { name: TRANSPORT_MENU, exact: true });
	await expect(transport).toBeVisible();
	const shuttleItem = getMenuItem(transport, 'Shuttle and edit points');
	await shuttleItem.focus();
	await page.keyboard.press('ArrowRight');
	const shuttle = shuttleItem.getByRole('menu');
	await expect(shuttle).toBeVisible();
	return shuttle;
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
