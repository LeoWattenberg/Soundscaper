import { expect, test } from '@playwright/test';

import {
	resolveVideoSourceDisplaySize,
	resolveVideoSourcePresentation,
} from '../../src/common/editor/video-source-presentation.ts';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { chooseDropdown, openExportDialog } from './audio-editor-test-helpers.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const DATABASE_NAME = 'kw-media-audio-editor';
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const ROTATED_ANAMORPHIC = videoSourceGeometryMedia.find(
	({ id }) => id === 'geometry-rotated-anamorphic-mp4-v1',
);

test.describe('3B-2b source display geometry qualification', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('the probe reports coded geometry and each engine resolves its own residual', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(90_000);

		const editor = await openFramescaper(page);
		await editor.locator('[data-import-input]').setInputFiles(
			videoSourceGeometryMedia.map(({ file }) => file),
		);
		await expect.poll(async () => (await persistedVideoSources(page)).length, {
			timeout: 45_000,
		}).toBe(videoSourceGeometryMedia.length);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');

		const sources = await persistedVideoSources(page);
		for (const fixture of videoSourceGeometryMedia) {
			const source = sources.find(({ name }) => name === fixture.file.name);
			expect(source, `${fixture.id} must persist a source`).toBeTruthy();
			expect(source.contentSha256).toBe(fixture.sourceSha256);

			// Coded geometry, the rotation, and the pixel aspect ratio are three
			// facts about one frame: the probe reads frames the display matrix has
			// not been applied to, so the size it reports is the coded size.
			expect(source.characteristics.codedWidth).toBe(fixture.coded.width);
			expect(source.characteristics.codedHeight).toBe(fixture.coded.height);
			expect(source.characteristics.rotationDegrees).toBe(fixture.rotationDegrees);
			expect(source.characteristics.pixelAspectRatio).toEqual(fixture.pixelAspectRatio);

			// The engines genuinely disagree about how much of that geometry they
			// present, and the document records what this engine did present.
			const presented = fixture.presentedByEngine[browserName];
			expect({ width: source.width, height: source.height }).toEqual(presented);
			expect(resolveVideoSourceDisplaySize(source)).toEqual(fixture.display);

			// Whatever the browser did, the render that decodes the container owes
			// the pixel aspect ratio and nothing else.
			const presentation = resolveVideoSourcePresentation(source);
			if (fixture.pixelAspectRatio.num === fixture.pixelAspectRatio.den) {
				expect(presentation).toBeNull();
			} else {
				expect(presentation.autorotate).toBe(true);
				expect(presentation.sampleAspect).toEqual(fixture.pixelAspectRatio);
				expect({ width: presentation.scaledWidth, height: presentation.scaledHeight })
					.toEqual(fixture.display);
			}
		}

		// The disclosure stays truthful: an ordinary rotated clip is reconciled,
		// not reported as geometry the product cannot explain.
		await addToTimeline(editor, ROTATED_ANAMORPHIC);
		await editor.getByRole('button', { name: 'Source properties', exact: true }).focus();
		await page.keyboard.press('Enter');
		const properties = page.getByRole('dialog', { name: 'Source properties', exact: true });
		await expect(properties.locator('[data-source-property="Coded size"] dd')).toHaveText('32 × 24');
		await expect(properties.locator('[data-source-property="Display size"] dd')).toHaveText('24 × 64');
		await expect(properties.locator('[data-source-note]')).toHaveCount(0);
	});

	test('an anamorphic source exports at its display geometry with the picture upright', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName === 'webkit', 'Milestone 3 inherits the explicit WebKit qualification deferral.');
		test.setTimeout(180_000);

		const editor = await openFramescaper(page);
		await editor.locator('[data-import-input]').setInputFiles([ROTATED_ANAMORPHIC.file]);
		await expect.poll(async () => (await persistedVideoSources(page)).length, {
			timeout: 45_000,
		}).toBe(1);
		await addToTimeline(editor, ROTATED_ANAMORPHIC);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
		await exportDialog.locator('[data-export-action="start"]').getByRole('button').click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 120_000 });

		const rendered = await download.evaluate(async (link) => {
			const url = URL.createObjectURL(await (await fetch(link.href)).blob());
			const video = document.createElement('video');
			video.muted = true;
			video.playsInline = true;
			video.src = url;
			document.body.append(video);
			try {
				await new Promise((resolve, reject) => {
					video.addEventListener('loadeddata', resolve, { once: true });
					video.addEventListener('error', () => reject(new Error('the exported video did not decode')), { once: true });
					setTimeout(() => reject(new Error('the exported video timed out')), 15_000);
				});
				// Decoding is not painting: a headless engine presents frames only
				// once playback is running.
				await video.play();
				const canvas = document.createElement('canvas');
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				const context = canvas.getContext('2d', { willReadFrequently: true });
				// The picture has no black quadrant, so an all-black read means the
				// frame has not been presented yet.
				const painted = () => {
					context.drawImage(video, 0, 0, canvas.width, canvas.height);
					const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
					return data.some((channel, index) => index % 4 !== 3 && channel > 40);
				};
				for (let attempt = 0; attempt < 60 && !painted(); attempt += 1) {
					await new Promise((resolve) => { setTimeout(resolve, 100); });
				}
				video.pause();
				const quadrant = (x, y) => {
					const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
					if (red > 140 && green < 110 && blue < 110) return 'red';
					if (green > 140 && red < 110 && blue < 110) return 'green';
					if (blue > 140 && red < 110 && green < 110) return 'blue';
					if (red > 170 && green > 170 && blue > 170) return 'white';
					return `rgb(${red},${green},${blue})`;
				};
				const insetX = Math.round(canvas.width / 4);
				const insetY = Math.round(canvas.height / 4);
				return {
					width: video.videoWidth,
					height: video.videoHeight,
					topLeft: quadrant(insetX, insetY),
					topRight: quadrant(canvas.width - insetX, insetY),
					bottomLeft: quadrant(insetX, canvas.height - insetY),
					bottomRight: quadrant(canvas.width - insetX, canvas.height - insetY),
				};
			} finally {
				video.remove();
				URL.revokeObjectURL(url);
			}
		});

		// The canvas is the source's display geometry, so the picture fills it:
		// an export that dropped the pixel aspect ratio letterboxes instead.
		expect({ width: rendered.width, height: rendered.height }).toEqual(ROTATED_ANAMORPHIC.display);
		// A quarter turn counter-clockwise carries the source's top right corner
		// to the top left. The export declares no rotation of its own, so this is
		// what a player shows without turning the picture a second time.
		expect(rendered).toMatchObject({
			topLeft: 'green',
			topRight: 'white',
			bottomLeft: 'red',
			bottomRight: 'blue',
		});
	});
});

async function addToTimeline(editor, fixture) {
	const name = fixture.file.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', { name: `Add to timeline: ${name}`, exact: true }).click();
}

async function openFramescaper(page) {
	await page.goto('/framescaper/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function persistedVideoSources(page) {
	return page.evaluate(async ({ databaseName, sourceNames }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const projects = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			const sources = projects.flatMap((project) => (project.sources || []).filter((source) => (
				source.kind === 'video' && sourceNames.includes(source.name)
			)));
			return sources.filter((source, index) => (
				sources.findIndex((candidate) => candidate.name === source.name) === index
			));
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		sourceNames: videoSourceGeometryMedia.map(({ file }) => file.name),
	});
}
