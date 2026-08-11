import { expect, test, toneA, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	getMenuItem,
	importFiles,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const DATABASE_NAME = 'kw-media-audio-editor';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const TRANSPORT_MENU = 'Playback and recording';

test.describe('persisted shared track locking', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('Soundscaper lock survives undo, redo, reload, and Framescaper handoff', async ({ page }) => {
		test.setTimeout(120_000);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [toneA]);
		await selectAudioTrack(editor, toneA.name);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const trackId = await selectedTrackId(page, projectId);
		expect(trackId).toBeTruthy();

		await expectNoVisibleLockControl(editor);
		await chooseCommandAction(page, editor, 'Tracks', 'Lock track');
		await expectPersistedLock(page, projectId, trackId, true);
		await expectNoVisibleLockControl(editor);

		await clickHistory(editor, 'Undo');
		await expectPersistedLock(page, projectId, trackId, false);
		await clickHistory(editor, 'Redo');
		await expectPersistedLock(page, projectId, trackId, true);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		await page.reload();
		let restored = await waitForEditor(page);
		await selectAudioTrack(restored, toneA.name);
		await expectTrackMenuItem(page, restored, 'Unlock track', true);
		await expectPersistedLock(page, projectId, trackId, true);

		await chooseCommandAction(page, restored, 'File', 'Edit in Framescaper');
		await page.waitForURL((url) => (
			url.pathname === '/framescaper/en/' && url.searchParams.get('project') === projectId
		));
		restored = await waitForEditor(page);
		await selectAudioTrack(restored, toneA.name);
		await expectTrackMenuItem(page, restored, 'Unlock track', true);
		await chooseCommandAction(page, restored, 'Tracks', 'Unlock track');
		await expectPersistedLock(page, projectId, trackId, false);
		await expectNoVisibleLockControl(restored);
	});

	test('a locked Framescaper video lane refuses trim and is skipped by edit navigation', async ({ page }) => {
		test.setTimeout(120_000);
		const editor = await bootEditor(page, '/framescaper/en/');
		await editor.locator('[data-import-input]').setInputFiles([CFR.file]);
		await addVideoToTimeline(editor);
		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClip).toHaveCount(1, { timeout: 30_000 });
		await videoClip.focus();
		await videoClip.press('Enter');
		await expect(videoClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const state = await videoState(page, projectId);
		expect(state).not.toBeNull();
		expect(state.video.sequenceFrameCount).toBeGreaterThan(2);
		await setProgramFrame(editor, state.sequence.rate.num, 1);

		await chooseCommandAction(page, editor, 'Tracks', 'Lock track');
		await expectPersistedLock(page, projectId, state.track.id, true);
		await expectNoVisibleLockControl(editor);
		await expectTrimItemsDisabled(page, editor);

		const before = await editor.locator('[data-sequence-timecode]')
			.getAttribute('data-sequence-timecode');
		await chooseNestedCommandAction(
			page, editor, TRANSPORT_MENU, ['Shuttle and edit points', 'Next edit'],
		);
		await expect(editor.locator('[data-status]')).toContainText('No next edit point');
		await expect(editor.locator('[data-sequence-timecode]'))
			.toHaveAttribute('data-sequence-timecode', before);

		await chooseCommandAction(page, editor, 'Tracks', 'Unlock track');
		await expectPersistedLock(page, projectId, state.track.id, false);
		await expectTrimItemsEnabled(page, editor);
	});
});

async function addVideoToTimeline(editor) {
	const name = CFR.file.name.replace(/\.[^.]+$/u, '');
	const action = editor.getByRole('button', { name: `Add to timeline: ${name}`, exact: true });
	await expect(action).toBeVisible({ timeout: 60_000 });
	await action.click();
}

async function selectAudioTrack(editor, name) {
	const clip = clipByName(editor, name);
	const row = clip.locator('xpath=ancestor::div[@data-track-row]');
	await expect(row).toHaveCount(1);
	await row.locator('.track-control-panel__track-name-text').click();
	await expect(row.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
}

async function expectTrackMenuItem(page, editor, label, enabled) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Tracks', exact: true });
	const item = getMenuItem(menu, label);
	await expect(item).toBeVisible();
	if (enabled) await expect(item).toBeEnabled();
	else await expect(item).toBeDisabled();
	await page.keyboard.press('Escape');
}

async function expectNoVisibleLockControl(editor) {
	await expect(editor.getByRole('button', { name: 'Lock track', exact: true })).toHaveCount(0);
	await expect(editor.getByRole('button', { name: 'Unlock track', exact: true })).toHaveCount(0);
}

async function expectTrimItemsDisabled(page, editor) {
	const menu = await openAudioClipsMenu(page, editor);
	await expect(getMenuItem(menu, 'Trim left edge to playhead')).toBeDisabled();
	await expect(getMenuItem(menu, 'Trim right edge to playhead')).toBeDisabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
}

async function expectTrimItemsEnabled(page, editor) {
	const menu = await openAudioClipsMenu(page, editor);
	await expect(getMenuItem(menu, 'Trim left edge to playhead')).toBeEnabled();
	await expect(getMenuItem(menu, 'Trim right edge to playhead')).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
}

async function openAudioClipsMenu(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Edit', exact: true }).click();
	const edit = page.getByRole('menu', { name: 'Edit', exact: true });
	const boundary = getMenuItem(edit, 'Audio clips');
	await boundary.focus();
	await page.keyboard.press('ArrowRight');
	const menu = boundary.getByRole('menu');
	await expect(menu).toBeVisible();
	return menu;
}

async function setProgramFrame(editor, rate, sequenceFrame) {
	const timecode = `00:00:00:${String(sequenceFrame).padStart(2, '0')}`;
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]'))
		.toHaveAttribute('data-sequence-timecode', timecode);
	expect(rate).toBeGreaterThan(sequenceFrame);
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

async function expectPersistedLock(page, projectId, trackId, locked) {
	await expect.poll(() => persistedLock(page, projectId, trackId)).toBe(locked);
}

async function persistedLock(page, projectId, trackId) {
	return page.evaluate(async ({ databaseName, id, selectedTrackId: target }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const project = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').get(id),
			);
			return project?.tracks?.find(({ id: trackId }) => trackId === target)?.locked ?? null;
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId, selectedTrackId: trackId });
}

async function selectedTrackId(page, projectId) {
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
			return project?.tracks?.find(({ clipIds }) => clipIds?.length)?.id ?? null;
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId });
}

async function videoState(page, projectId) {
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
			const video = project?.clips?.find(({ kind }) => kind === 'video');
			const track = project?.tracks?.find(({ type }) => type === 'video');
			const sequence = project?.sequences?.find(({ id: sequenceId }) => sequenceId === video?.sequenceId);
			return video && track && sequence ? { video, track, sequence } : null;
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId });
}
