import { expect, test } from '@playwright/test';

import {
	resolveVideoSourceDisplaySize,
	resolveVideoSourcePresentation,
} from '../../src/common/editor/video-source-presentation.ts';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { chooseDropdown, openExportDialog } from './audio-editor-test-helpers.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import {
	decodePinnedVideoRgbFrame,
	readRgbPixel,
} from './helpers/pinned-video-frame-decoder.mjs';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
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
		// The export runs the production FFmpeg core, which competes for CPU with
		// every other worker when the whole suite runs.
		test.setTimeout(300_000);

		// Production serves Framescaper with the isolation headers from
		// public/_headers. Vite preview does not apply that deployment file, so
		// reproduce the production response before exercising V27's bounded
		// SharedArrayBuffer frame stream.
		await installProductionIsolationHeaders(page, '/framescaper/en/');
		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasWebGl2Capability),
			'The browser video export composites each frame through WebGL2, '
				+ 'which this browser environment refuses; the export surfaces the disclosed failure status instead.',
		);
		expect(await page.evaluate(() => ({
			crossOriginIsolated: globalThis.crossOriginIsolated,
			sharedArrayBuffer: typeof globalThis.SharedArrayBuffer,
		}))).toEqual({ crossOriginIsolated: true, sharedArrayBuffer: 'function' });
		await editor.locator('[data-import-input]').setInputFiles([ROTATED_ANAMORPHIC.file]);
		await expect.poll(async () => (await persistedVideoSources(page)).length, {
			timeout: 45_000,
		}).toBe(1);
		await addToTimeline(editor, ROTATED_ANAMORPHIC);

		// The direct route writes the finished file straight to its target and
		// publishes no download, so the target is where the exported bytes are.
		await installVideoSaveTarget(page);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
		await exportDialog.locator('[data-export-action="start"]').getByRole('button').click();
		await expect.poll(
			() => page.evaluate(() => globalThis.__videoSaveTarget.closes),
			{ timeout: 240_000 },
		).toBe(1);

		const publication = await page.evaluate(() => {
			const state = globalThis.__videoSaveTarget;
			const byteLength = state.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
			const bytes = new Uint8Array(byteLength);
			let offset = 0;
			for (const chunk of state.chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			const binary = [];
			for (let start = 0; start < bytes.byteLength; start += 32_768) {
				binary.push(String.fromCharCode(...bytes.subarray(start, start + 32_768)));
			}
			return { fileName: state.fileName, byteLength, base64: btoa(binary.join('')) };
		});
		// Firefox on Windows can advance and fire presentation callbacks while
		// returning only black pixels from HTMLVideoElement canvas readback. Decode
		// the exact bytes written to the target with Soundscaper's pinned software
		// core so this export proof is independent of that compositor surface.
		const { base64, ...published } = publication;
		const decoded = await decodePinnedVideoRgbFrame(Buffer.from(base64, 'base64'));
		const insetX = Math.round(decoded.width / 4);
		const insetY = Math.round(decoded.height / 4);
		const rendered = {
			...published,
			width: decoded.width,
			height: decoded.height,
			topLeft: quadrant(decoded, insetX, insetY),
			topRight: quadrant(decoded, decoded.width - insetX, insetY),
			bottomLeft: quadrant(decoded, insetX, decoded.height - insetY),
			bottomRight: quadrant(decoded, decoded.width - insetX, decoded.height - insetY),
		};

		// The decoded frame is the source's display geometry, so the picture fills it:
		// an export that dropped the pixel aspect ratio letterboxes instead.
		expect({ width: rendered.width, height: rendered.height }).toEqual(ROTATED_ANAMORPHIC.display);
		// A quarter turn counter-clockwise carries the source's top right corner
		// to the top left. The export declares no rotation of its own, so this is
		// what a player shows without turning the picture a second time.
		expect(rendered.fileName).toMatch(/\.mp4$/u);
		expect(rendered.byteLength).toBeGreaterThan(0);
		expect(rendered).toMatchObject({
			topLeft: 'green',
			topRight: 'white',
			bottomLeft: 'red',
			bottomRight: 'blue',
		});
	});
});

function quadrant(frame, x, y) {
	const [red, green, blue] = readRgbPixel(frame, { x, y });
	if (red > 140 && green < 110 && blue < 110) return 'red';
	if (green > 140 && red < 110 && blue < 110) return 'green';
	if (blue > 140 && red < 110 && green < 110) return 'blue';
	if (red > 170 && green > 170 && blue > 170) return 'white';
	return `rgb(${String(red)},${String(green)},${String(blue)})`;
}

/** Collect the bytes the direct export route writes to its prepared target. */
async function installVideoSaveTarget(page) {
	await page.evaluate(() => {
		const state = { chunks: [], closes: 0, fileName: null };
		globalThis.__videoSaveTarget = state;
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async (options) => {
				state.fileName = options?.suggestedName ?? null;
				return {
					name: state.fileName,
					createWritable: async () => ({
						async write(chunk) {
							const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(await new Blob([chunk]).arrayBuffer());
							state.chunks.push(bytes.slice());
						},
						async close() { state.closes += 1; },
						async abort() {},
					}),
				};
			},
		});
	});
}

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
	await page.route('**/assets/worker-*.js', async (route) => {
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
