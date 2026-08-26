import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const PERSISTENCE_TIMEOUT = { timeout: 15_000 };

test.describe('Framescaper linked audio menus and video visibility controls', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('links audio and shows or hides the selected video through application menus', async ({ page }) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const errors = collectClientErrors(page);
		const fixture = createDeterministicAvFixture('framescaper-menu-controls.webm');
		const editor = await bootFramescaper(page);
		await importFiles(editor, [fixture]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await expect.poll(async () => Boolean((await persistedMediaState(page, projectId))?.links.video.avLinkId), PERSISTENCE_TIMEOUT)
			.toBe(true);
		const initial = await persistedMediaState(page, projectId);
		expect(initial).not.toBeNull();
		expect(initial.links.video.avLinkId).toBe(initial.links.audio.avLinkId);
		const initialLinkId = initial.links.video.avLinkId;
		const unlinked = linksWithId(initial.links, null);

		const videoTrack = editor.locator(`[data-video-track][data-track-id="${initial.videoTrack.id}"]`);
		const previewLayer = editor.locator(
			`[data-video-preview-layer][data-track-id="${initial.videoTrack.id}"]`,
		);
		await expect(videoTrack).toHaveAttribute('data-hidden', 'false');
		await expect(previewLayer).toHaveCount(1);
		await selectOnlyVideoClip(editor);

		// The feature adds application-menu commands, not another default-visible
		// clip control. The video row retains its one pre-existing visibility button.
		await expect(editor.getByRole('button', { name: /^(?:Link|Unlink) audio$/u })).toHaveCount(0);
		await expect(videoTrack.getByRole('button', { name: 'Hide video', exact: true })).toHaveCount(1);

		await expectNestedMenuItem(page, editor, 'Edit', 'Audio clips', 'Unlink audio');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
		await expectPersistedLinks(page, projectId, unlinked);

		await clickHistory(editor, 'Undo');
		await expectPersistedLinks(page, projectId, linksWithId(initial.links, initialLinkId));
		await clickHistory(editor, 'Redo');
		await expectPersistedLinks(page, projectId, unlinked);

		await expectNestedMenuItem(page, editor, 'Edit', 'Audio clips', 'Link audio');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Link audio']);
		await expect.poll(async () => {
			const links = (await persistedMediaState(page, projectId))?.links;
			return Boolean(
				links?.video.avLinkId
				&& links.video.avLinkId === links.audio.avLinkId
				&& links.video.avLinkId !== initialLinkId,
			);
		}, PERSISTENCE_TIMEOUT).toBe(true);
		const relinked = (await persistedMediaState(page, projectId)).links;
		const relinkedLinkId = relinked.video.avLinkId;
		expect(relinkedLinkId).toBeTruthy();

		await clickHistory(editor, 'Undo');
		await expectPersistedLinks(page, projectId, unlinked);
		await clickHistory(editor, 'Redo');
		await expectPersistedLinks(page, projectId, linksWithId(initial.links, relinkedLinkId));

		// Picture visibility is the video track's mute control now, not a menu command.
		await videoTrack.getByRole('button', { name: 'Hide video', exact: true }).click();
		await expect(videoTrack).toHaveAttribute('data-hidden', 'true');
		await expect(previewLayer).toHaveCount(0);
		await expectPersistedHidden(page, projectId, true);

		await clickHistory(editor, 'Undo');
		await expect(videoTrack).toHaveAttribute('data-hidden', 'false');
		await expect(previewLayer).toHaveCount(1);
		await expectPersistedHidden(page, projectId, false);
		await clickHistory(editor, 'Redo');
		await expect(videoTrack).toHaveAttribute('data-hidden', 'true');
		await expect(previewLayer).toHaveCount(0);
		await expectPersistedHidden(page, projectId, true);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		await page.reload();
		const restored = await waitForFramescaper(page);
		const restoredTrack = restored.locator(
			`[data-video-track][data-track-id="${initial.videoTrack.id}"]`,
		);
		const restoredLayer = restored.locator(
			`[data-video-preview-layer][data-track-id="${initial.videoTrack.id}"]`,
		);
		await expect(restoredTrack).toHaveAttribute('data-hidden', 'true');
		await expect(restoredLayer).toHaveCount(0);
		await expectPersistedHidden(page, projectId, true);

		await selectOnlyVideoClip(restored);
		await restoredTrack.getByRole('button', { name: 'Show video', exact: true }).click();
		await expect(restoredTrack).toHaveAttribute('data-hidden', 'false');
		await expect(restoredLayer).toHaveCount(1);
		await expectPersistedHidden(page, projectId, false);
		await expectPersistedLinks(page, projectId, linksWithId(initial.links, relinkedLinkId));
		expect(errors).toEqual([]);
	});
});

async function bootFramescaper(page) {
	const editor = await bootEditor(page, '/framescaper/en/');
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await expect(editor.locator('[data-video-preview]')).toBeVisible();
	return editor;
}

async function waitForFramescaper(page) {
	const editor = await waitForEditor(page);
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await expect(editor.locator('[data-video-preview]')).toBeVisible();
	return editor;
}

async function selectOnlyVideoClip(editor) {
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

async function expectNestedMenuItem(page, editor, menuLabel, submenuLabel, itemLabel) {
	const submenu = await openNestedCommandMenu(page, editor, menuLabel, [submenuLabel]);
	const item = getMenuItem(submenu, itemLabel);
	await expect(item).toBeVisible();
	await expect(item).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
}

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

function linksWithId(links, avLinkId) {
	return {
		audio: { id: links.audio.id, avLinkId },
		video: { id: links.video.id, avLinkId },
	};
}

async function expectPersistedLinks(page, projectId, expected) {
	await expect.poll(async () => (await persistedMediaState(page, projectId))?.links ?? null, PERSISTENCE_TIMEOUT)
		.toEqual(expected);
}

async function expectPersistedHidden(page, projectId, expected) {
	await expect.poll(async () => (await persistedMediaState(page, projectId))?.videoTrack.hidden ?? null, PERSISTENCE_TIMEOUT)
		.toBe(expected);
}

async function persistedMediaState(page, projectId) {
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
			const video = project?.clips?.find((clip) => clip.kind === 'video');
			const audio = project?.clips?.find((clip) => clip.kind === 'audio');
			const videoTrack = project?.tracks?.find((track) => track.type === 'video');
			if (!video || !audio || !videoTrack) return null;
			return {
				links: {
					audio: { id: audio.id, avLinkId: audio.avLinkId },
					video: { id: video.id, avLinkId: video.avLinkId },
				},
				videoTrack: { id: videoTrack.id, hidden: videoTrack.hidden },
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId });
}

function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
