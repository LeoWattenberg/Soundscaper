import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	getMenuItem,
	importFiles,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { hasMediaRecorderCapability } from './helpers/media-recorder-capability.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const DATABASE_NAME = 'kw-media-audio-editor';

test.describe('Framescaper linked audio and video visibility menus', () => {
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
		test.skip(!await page.evaluate(hasMediaRecorderCapability), 'Generated WebM fixtures require MediaRecorder.');
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const errors = collectClientErrors(page);
		const fixture = await createGeneratedAvFixture(page);
		const editor = await bootFramescaper(page);
		await importFiles(editor, [fixture]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await expect.poll(async () => Boolean((await persistedMediaState(page, projectId))?.links.video.avLinkId))
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
		}).toBe(true);
		const relinked = (await persistedMediaState(page, projectId)).links;
		const relinkedLinkId = relinked.video.avLinkId;
		expect(relinkedLinkId).toBeTruthy();

		await clickHistory(editor, 'Undo');
		await expectPersistedLinks(page, projectId, unlinked);
		await clickHistory(editor, 'Redo');
		await expectPersistedLinks(page, projectId, linksWithId(initial.links, relinkedLinkId));

		await expectTopLevelMenuItem(page, editor, 'Tracks', 'Hide video');
		await chooseCommandAction(page, editor, 'Tracks', 'Hide video');
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
		await expectTopLevelMenuItem(page, restored, 'Tracks', 'Show video');
		await chooseCommandAction(page, restored, 'Tracks', 'Show video');
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
	const menu = await openApplicationMenu(page, editor, menuLabel);
	const submenuItem = getMenuItem(menu, submenuLabel);
	await submenuItem.focus();
	await page.keyboard.press('ArrowRight');
	const submenu = submenuItem.getByRole('menu');
	await expect(submenu).toBeVisible();
	const item = getMenuItem(submenu, itemLabel);
	await expect(item).toBeVisible();
	await expect(item).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
}

async function expectTopLevelMenuItem(page, editor, menuLabel, itemLabel) {
	const menu = await openApplicationMenu(page, editor, menuLabel);
	const item = getMenuItem(menu, itemLabel);
	await expect(item).toBeVisible();
	await expect(item).toBeEnabled();
	await page.keyboard.press('Escape');
}

async function openApplicationMenu(page, editor, label) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: label, exact: true }).click();
	const menu = page.getByRole('menu', { name: label, exact: true });
	await expect(menu).toBeVisible();
	return menu;
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
	await expect.poll(async () => (await persistedMediaState(page, projectId))?.links ?? null)
		.toEqual(expected);
}

async function expectPersistedHidden(page, projectId, expected) {
	await expect.poll(async () => (await persistedMediaState(page, projectId))?.videoTrack.hidden ?? null)
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

async function createGeneratedAvFixture(page) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 54;
		const context = canvas.getContext('2d');
		const videoStream = canvas.captureStream(15);
		const audioContext = new AudioContext({ sampleRate: 48_000 });
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		const audioDestination = audioContext.createMediaStreamDestination();
		oscillator.frequency.value = 330;
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
			videoBitsPerSecond: 120_000,
			audioBitsPerSecond: 32_000,
		});
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < 14; frame += 1) {
			context.fillStyle = frame % 2 ? '#245fce' : '#d92f45';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#ffffff';
			context.fillRect(frame * 5, 20, 12, 12);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		oscillator.stop();
		await audioContext.close();
		const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	});
	return {
		name: 'framescaper-menu-controls.webm',
		mimeType: 'video/webm',
		buffer: Buffer.from(base64, 'base64'),
	};
}

function collectClientErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}
