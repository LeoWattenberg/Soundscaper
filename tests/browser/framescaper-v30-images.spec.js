/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseFileAction,
	collectClientErrors,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==',
	'base64',
);

registerAudioEditorHooks();

test.describe('Framescaper V30 timeline images', () => {
	test('adds, undoes, redoes, reopens, and exports an image from Generate', async ({ browserName, page }) => {
		test.skip(
			browserName !== 'chromium',
			'The maintained browser MP4 publication route requires Chromium shared-memory FFmpeg.',
		);
		test.setTimeout(360_000);
		const clientErrors = collectClientErrors(page);
		await installPinnedFfmpegRuntimeRoutes(page, {
			sameOriginRoot: '/__framescaper-v30-ffmpeg',
		});
		await installProductionIsolationHeaders(page, '/framescaper/en/');
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const chooserPromise = page.waitForEvent('filechooser');
		const generate = await openNestedCommandMenu(page, editor, 'Generate', []);
		await getMenuItem(generate, 'Add Images…').click();
		const chooser = await chooserPromise;
		await chooser.setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG });

		const imageClip = editor.locator('[data-clip-kind="image"]');
		await expect(imageClip).toHaveCount(1, { timeout: 30_000 });
		await expect(imageClip).toHaveAttribute('aria-label', 'Image clip: poster');
		await expect(imageClip.locator('[data-product-visual-thumbnail]')).toHaveCount(1);
		await expect.poll(() => storedImageState(page, projectId)).toMatchObject({
			schemaVersion: 30,
			sourceCount: 1,
			clipCount: 1,
			fileName: 'poster.png',
			width: 2,
			height: 2,
			timelineOwned: true,
			requiresTimelineImages: true,
		});
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(imageClip).toHaveCount(0);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(imageClip).toHaveCount(1);

		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(1);
		await expect.poll(() => storedImageState(page, projectId)).toMatchObject({
			schemaVersion: 30, sourceCount: 1, clipCount: 1, timelineOwned: true,
		});

		await chooseFileAction(page, editor, 'Export audio', { timeout: 120_000 });
		const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
		const canvasSize = dialog.locator('[data-export-field="canvasSize"] input');
		await canvasSize.nth(0).fill('64');
		await canvasSize.nth(1).fill('64');
		await dialog.locator('[data-export-field="canvasFrameRate"] input').fill('1');
		await dialog.locator('[data-export-action="start"]').getByRole('button').click();
		const download = dialog.locator('[data-export-download]');
		await waitForVideoPublication(page, editor, download, 120_000, clientErrors);
		await expect(download).toHaveAttribute('download', /\.mp4$/u);
		const witness = await download.evaluate(async (link) => {
			const response = await fetch(link.href);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const media = new Blob([bytes], { type: response.headers.get('content-type') || 'video/mp4' });
			const mediaUrl = URL.createObjectURL(media);
			let centerPixel;
			try {
				const video = document.createElement('video');
				video.muted = true;
				video.preload = 'auto';
				await new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error('Encoded image video did not decode.')), 15_000);
					video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
					video.addEventListener('error', () => {
						clearTimeout(timer);
						reject(video.error || new Error('Encoded image video failed to decode.'));
					}, { once: true });
					video.src = mediaUrl;
					video.load();
				});
				const canvas = document.createElement('canvas');
				canvas.width = 64;
				canvas.height = 64;
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) throw new Error('Encoded image witness canvas is unavailable.');
				context.drawImage(video, 0, 0, canvas.width, canvas.height);
				centerPixel = [...context.getImageData(32, 32, 1, 1).data];
			} finally {
				URL.revokeObjectURL(mediaUrl);
			}
			return {
				byteLength: bytes.byteLength,
				mimeType: response.headers.get('content-type'),
				box: String.fromCharCode(...bytes.subarray(4, 8)),
				centerPixel,
			};
		});
		expect(witness.byteLength).toBeGreaterThan(32);
		expect(witness.mimeType).toContain('video/mp4');
		expect(witness.box).toBe('ftyp');
		expect(witness.centerPixel[0]).toBeGreaterThan(160);
		expect(witness.centerPixel[1]).toBeLessThan(96);
		expect(witness.centerPixel[2]).toBeLessThan(96);
		expect(witness.centerPixel[3]).toBe(255);
		expect(clientErrors).toEqual([]);
	});
});

async function installProductionIsolationHeaders(page, path) {
	await page.route(`**${path}`, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'credentialless',
			},
		});
	});
	await page.route(/\/assets\/[^/?]*worker-[^/?]+\.js(?:\?.*)?$/u, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'Cross-Origin-Embedder-Policy': 'credentialless',
				'Cross-Origin-Resource-Policy': 'same-origin',
			},
		});
	});
}

async function waitForVideoPublication(page, editor, download, timeout, clientErrors) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await download.isVisible()) return;
		const status = await editor.locator('[data-status]').evaluate((element) => ({
			state: element.dataset.state ?? '', text: element.textContent ?? '',
		}));
		if (status.state === 'error') {
			throw new Error(`Video publication failed: ${status.text}; console=${JSON.stringify(clientErrors)}`);
		}
		await page.waitForTimeout(250);
	}
	throw new Error(`Video publication timed out: ${JSON.stringify({
		status: await editor.locator('[data-status]').evaluate((element) => ({
			state: element.dataset.state ?? '', text: element.textContent ?? '',
		})),
		clientErrors,
	})}`);
}

async function storedImageState(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error || new Error(`Could not open ${databaseName}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				const project = request.result;
				const sources = project?.sources?.filter((source) => source.kind === 'image') ?? [];
				const clips = project?.clips?.filter((clip) => clip.kind === 'image') ?? [];
				const clipIds = new Set(project?.tracks?.flatMap((track) => track.clipIds ?? []) ?? []);
				const requirements = project?.featureRequirements?.requirements ?? [];
				database.close();
				resolve({
					schemaVersion: project?.schemaVersion ?? null,
					sourceCount: sources.length,
					clipCount: clips.length,
					fileName: sources[0]?.original?.fileName ?? null,
					width: sources[0]?.canonical?.width ?? null,
					height: sources[0]?.canonical?.height ?? null,
					timelineOwned: clips.length === 1 && clipIds.has(clips[0].id),
					requiresTimelineImages: requirements.some(({ featureId }) => (
						featureId === 'org.soundscaper.capability.timeline-images-v1'
					)),
				});
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
