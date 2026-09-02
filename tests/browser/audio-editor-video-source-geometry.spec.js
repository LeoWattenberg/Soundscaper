import { expect, test } from '@playwright/test';

import {
	resolveVideoSourceDisplaySize,
	resolveVideoSourcePresentation,
} from '../../src/common/editor/video-source-presentation.ts';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { openExportDialog } from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import {
	DURABLE_MEDIA_STORAGE_REQUIRED,
	hasDurableMediaStorageCapability,
} from './helpers/durable-media-storage-capability.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const ROTATED_ANAMORPHIC = videoSourceGeometryMedia.find(
	({ id }) => id === 'geometry-rotated-anamorphic-mp4-v1',
);

test.describe('3B-2b source display geometry qualification', () => {
	test.beforeEach(async ({ page }) => {
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
		test.setTimeout(90_000);

		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);
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
			expect(source.characteristics.backend).toBe('container');

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

	test('an anamorphic composed source publishes through the keyed browser export path', async ({
		page,
	}) => {
		test.setTimeout(90_000);

		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);
		await editor.locator('[data-import-input]').setInputFiles([ROTATED_ANAMORPHIC.file]);
		await expect.poll(async () => (await persistedVideoSources(page)).length, {
			timeout: 45_000,
		}).toBe(1);
		await addToTimeline(editor, ROTATED_ANAMORPHIC);

		// This source needs the composed-graph path. Framescaper owns the exact keyed
		// compositor, so the browser-native tier can publish it without an FFmpeg fallback.
		await installVideoSaveTarget(page);
		const exportDialog = await openExportDialog(page, editor, { label: 'Export video' });
		const format = exportDialog.getByRole('group', { name: 'Format', exact: true });
		await format.getByRole('button').click();
		await page.getByRole('option', { name: 'MP4 video', exact: true }).click();
		await exportDialog.getByRole('button', { name: 'Start export', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__videoSaveTarget.closes), {
			timeout: 45_000,
		}).toBe(1);
		await expect(editor.locator('[data-editor-status]')).toHaveAttribute('data-state', 'success');
		await expect(exportDialog).toBeVisible();
		const target = await page.evaluate(() => ({
			chunkCount: globalThis.__videoSaveTarget.chunks.length,
			byteLength: globalThis.__videoSaveTarget.chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
			closes: globalThis.__videoSaveTarget.closes,
			fileName: globalThis.__videoSaveTarget.fileName,
		}));
		expect(target).toMatchObject({
			closes: 1,
			fileName: expect.stringMatching(/\.mp4$/u),
		});
		expect(target.chunkCount).toBeGreaterThan(0);
		expect(target.byteLength).toBeGreaterThan(0);
	});
});

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

async function addToTimeline(editor, fixture) {
	const name = fixture.file.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', { name: `Add to timeline: ${name}`, exact: true }).click();
}

async function openFramescaper(page) {
	await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
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
