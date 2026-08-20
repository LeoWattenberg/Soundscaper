import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { createFramescaperProjectV19 } from '../../src/framescaper/editor-project-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createSoundscaperProjectV21 } from '../../src/soundscaper/editor-project-v21.ts';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	getMenuItem,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const FRAME_COUNT = 12_000;
const SAMPLE_RATE = 48_000;
const PROJECT_ID = 'browser-audio-warp-project';
const CLIP_ID = 'audio-warp-clip';
const TRACK_ID = 'audio-warp-track';

test.describe('audio warp and transient workflow', () => {
	registerAudioEditorHooks();

	test('Soundscaper authors a selected clip through its menu with accessible exact controls', async ({ browserName, page }) => {
		test.setTimeout(120_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-editor-surface="audio-warp"]')).toHaveCount(0);
		await openAudioWarpArchive(editor, false);
		await expect(editor).toHaveAttribute('data-project-id', PROJECT_ID, { timeout: 20_000 });
		await selectAudioWarpClip(page, editor);

		let dialog = await openAudioWarpDialog(page, editor);
		await expect(dialog.getByRole('button', { name: 'Analyze transients', exact: true })).toBeFocused();
		const runtimeStatus = dialog.getByRole('status').filter({ hasText: /^Runtime:/u });
		await expect(runtimeStatus).toHaveText('Runtime: realtime warp acceleration.');
		await expect(runtimeStatus).not.toContainText('scalar');
		await expect(dialog.getByText('No warp map is authored.', { exact: true })).toBeVisible();
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-audio-warp-dialog]');

		await dialog.getByRole('button', { name: 'Analyze transients', exact: true }).click();
		await expect(dialog.getByText(/\d+ transients found/u)).toBeVisible({ timeout: 20_000 });
		await expect(dialog).toContainText('Transient analysis complete.');

		await dialog.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		const map = dialog.getByRole('table', { name: 'Warp map points', exact: true });
		await expect(map.getByRole('row')).toHaveCount(3);
		await expect(dialog).toContainText('Identity warp map created.');
		await dialog.getByLabel('Outer position', { exact: true }).fill('1000');
		await dialog.getByLabel('Source sample', { exact: true }).fill('1000');
		await dialog.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(map.getByRole('row')).toHaveCount(4);
		await dialog.getByLabel('Marker 1 outer position', { exact: true }).fill('1100');
		await dialog.getByLabel('Marker 1 source sample', { exact: true }).fill('1100');
		await dialog.getByRole('button', { name: 'Move marker 1', exact: true }).click();
		await expect(dialog.getByLabel('Marker 1 outer position', { exact: true })).toHaveValue('1100/1');
		await dialog.getByRole('button', { name: 'Delete marker 1', exact: true }).click();
		await expect(map.getByRole('row')).toHaveCount(3);

		await dialog.getByLabel('Grid interval', { exact: true }).fill('2048');
		const strength = dialog.getByRole('slider', { name: /Quantization strength/u });
		await strength.focus();
		await page.keyboard.press('Home');
		await expect(strength).toHaveValue('0');
		await dialog.getByRole('button', { name: 'Quantize transients', exact: true }).click();
		await expect(dialog).toContainText('Transients quantized.');
		await expect(map.getByRole('row')).toHaveCount(3);

		await strength.focus();
		await page.keyboard.press('End');
		await expect(strength).toHaveValue('100');
		await dialog.getByRole('button', { name: 'Quantize transients', exact: true }).click();
		await expect(dialog).toContainText('Transients quantized.');
		await expect.poll(() => map.getByRole('row').count()).toBeGreaterThan(3);

		await strength.focus();
		await page.keyboard.press('Home');
		for (let index = 0; index < 50; index += 1) await page.keyboard.press('ArrowRight');
		await expect(strength).toHaveValue('50');
		await dialog.getByRole('button', { name: 'Quantize transients', exact: true }).click();
		await expect(dialog).toContainText('Transients quantized.');

		await dialog.getByRole('checkbox', { name: 'Enable groove template', exact: true }).click();
		await dialog.getByLabel(/Groove offsets/u).fill('0, 1/3, 2/3');
		const grooveStrength = dialog.getByRole('slider', { name: /Groove strength/u });
		await grooveStrength.focus();
		await page.keyboard.press('End');
		await dialog.getByRole('button', { name: 'Apply groove', exact: true }).click();
		await expect(dialog).toContainText('Groove applied.');

		// WebKit does not implement forced-color-adjust, so its computed value is
		// empty there rather than the authored 'none'.
		if (browserName !== 'webkit') {
			await page.emulateMedia({ forcedColors: 'active' });
			await expect(dialog.getByRole('group', { name: 'Quantization', exact: true })).toHaveCSS('forced-color-adjust', 'none');
		}
		await dialog.getByRole('button', { name: 'Clear warp map', exact: true }).click();
		await expect(dialog.getByText('No warp map is authored.', { exact: true })).toBeVisible();
		await expect(dialog).toContainText('Warp map cleared.');

		await page.emulateMedia({ forcedColors: 'none' });
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('menuitem', { name: 'Effect', exact: true })).toBeFocused();
		await chooseTrackMenuAction(page, editor, null, 'Lock track');
		await expectAudioWarpMenuDisabled(page, editor);
		await chooseTrackMenuAction(page, editor, null, 'Unlock track');
		dialog = await openAudioWarpDialog(page, editor);
		await expect(dialog.getByText('No warp map is authored.', { exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
	});

	test('native realtime and exact-offline production playback agree for a nonidentity map', async ({ page, browser }) => {
		test.setTimeout(120_000);
		await installWarpCapture(page);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });

		const realtime = await captureProductionWarpPlayback(page, 'realtime');
		const fallbackContext = await browser.newContext();
		let exact;
		try {
			const fallbackPage = await fallbackContext.newPage();
			await fallbackPage.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'Access-Control-Allow-Origin': '*' },
				body: JSON.stringify({ schemaVersion: 1, locales: {} }),
			}));
			await installWarpCapture(fallbackPage);
			await stubStorageEstimate(fallbackPage, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
			exact = await captureProductionWarpPlayback(fallbackPage, 'fallback');
		} finally {
			await fallbackContext.close();
		}
		expect(realtime.some((sample) => Math.abs(sample) > 0.1)).toBe(true);
		let maximumError = 0;
		for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
			maximumError = Math.max(maximumError, Math.abs(realtime[frame] - exact[frame]));
		}
		for (const frame of [0, 1, 3_999, 4_000, 4_001, 7_999, 8_000, 8_001, FRAME_COUNT - 1]) {
			expect(Math.abs(realtime[frame] - exact[frame]), `signal error at frame ${frame}`).toBeLessThanOrEqual(0.000_001);
		}
		expect(maximumError).toBeLessThanOrEqual(0.000_001);
	});

	test('runtime reports the exact offline fallback when realtime acceleration is unavailable', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(globalThis, 'AudioBufferSourceNode', { configurable: true, value: undefined });
			globalThis.__audioWarpOfflineRenders = 0;
			const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
			if (Offline?.prototype?.startRendering) {
				const original = Offline.prototype.startRendering;
				Offline.prototype.startRendering = function (...args) {
					globalThis.__audioWarpOfflineRenders += 1;
					return original.apply(this, args);
				};
			}
		});
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const editor = await bootEditor(page, '/embed/en/');
		await openAudioWarpArchive(editor, true);
		await selectAudioWarpClip(page, editor);
		const dialog = await openAudioWarpDialog(page, editor);
		const runtimeStatus = dialog.getByRole('status').filter({ hasText: /^Runtime:/u });
		await expect(runtimeStatus).toHaveText('Runtime: exact offline fallback (realtime acceleration unavailable).');
		await expect(runtimeStatus).not.toContainText('scalar');
		await page.keyboard.press('Escape');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__audioWarpOfflineRenders)).toBeGreaterThan(0);
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	});

	test('Framescaper preserves authored warp maps read-only and exposes no menu or surface', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await openAudioWarpArchive(editor, true, 'framescaper-v19');
		const decision = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(decision).toBeVisible();
		await expect(decision).toContainText('Audio warp maps');
		await expect(decision).toContainText('Unavailable · Bypass declared');
		await expect(decision).not.toContainText('Rendered fallback declared');
		await decision.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(editor.getByRole('menuitem', { name: 'Effect', exact: true })).toHaveCount(0);
		await expect(editor.locator('[data-editor-surface="audio-warp"]')).toHaveCount(0);
	});
});

async function openAudioWarpDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function selectAudioWarpClip(page, editor) {
	const clip = clipByName(editor, 'Warp drums');
	await clip.focus();
	await page.keyboard.press('Enter');
	await expect(clip.locator('[data-selected="true"]').first()).toBeVisible();
}

async function expectAudioWarpMenuDisabled(page, editor) {
	await editor.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	const effectMenu = page.getByRole('menu', { name: 'Effect', exact: true });
	const pitchAndTempo = getMenuItem(effectMenu, 'Pitch and tempo');
	await pitchAndTempo.focus();
	await page.keyboard.press('ArrowRight');
	const submenu = pitchAndTempo.getByRole('menu');
	await expect(submenu).toBeVisible();
	await expect(getMenuItem(submenu, 'Audio warp and transients')).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
}

async function captureProductionWarpPlayback(page, mode) {
	const editor = await bootEditor(page, `/embed/en/?warpCapture=${mode}`);
	const fixture = `nonidentity-${mode}`;
	await openAudioWarpArchive(editor, fixture);
	await expect(editor).toHaveAttribute('data-project-id', `${PROJECT_ID}-${fixture}`, { timeout: 20_000 });
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__audioWarpCaptureStarts ?? 0)).toBeGreaterThan(0);
	return page.evaluate(async () => {
		const context = globalThis.__audioWarpCaptureContext;
		if (!context) throw new Error('Production playback did not create its capture AudioContext.');
		const rendered = await context.startRendering();
		return [...rendered.getChannelData(0)];
	});
}

async function installWarpCapture(page) {
	await page.addInitScript(({ frameCount, sampleRate }) => {
		const NativeOfflineAudioContext = globalThis.OfflineAudioContext
			|| globalThis.webkitOfflineAudioContext;
		const NativeAudioBufferSourceNode = globalThis.AudioBufferSourceNode;
		if (!NativeOfflineAudioContext) throw new Error('OfflineAudioContext is required for warp parity.');
		class CapturingAudioContext extends NativeOfflineAudioContext {
			constructor() {
				super(2, frameCount, sampleRate);
				globalThis.__audioWarpCaptureContext = this;
				globalThis.__audioWarpCaptureStarts = 0;
			}
			resume() { return Promise.resolve(); }
			close() { return Promise.resolve(); }
			createBufferSource() {
				const source = super.createBufferSource();
				const start = source.start.bind(source);
				source.start = (...args) => {
					globalThis.__audioWarpCaptureStarts += 1;
					return start(...args);
				};
				return source;
			}
		}
		Object.defineProperty(globalThis, 'AudioContext', {
			configurable: true, value: CapturingAudioContext,
		});
		Object.defineProperty(globalThis, 'webkitAudioContext', {
			configurable: true, value: CapturingAudioContext,
		});
		if (new URL(globalThis.location.href).searchParams.get('warpCapture') === 'fallback') {
			Object.defineProperty(globalThis, 'AudioBufferSourceNode', {
				configurable: true, value: undefined,
			});
		} else {
			Object.defineProperty(globalThis, 'AudioBufferSourceNode', {
				configurable: true, value: NativeAudioBufferSourceNode,
			});
		}
	}, { frameCount: FRAME_COUNT, sampleRate: SAMPLE_RATE });
}

async function openAudioWarpArchive(editor, withWarpMap, authority = 'soundscaper-v21') {
	await editor.locator('[data-aup4-input]').setInputFiles({
		name: `audio-warp-${withWarpMap ? 'authored' : 'plain'}.scape`,
		mimeType: SCAPE_MIME_TYPE,
		buffer: await audioWarpArchive(withWarpMap, authority),
	});
}

const archives = new Map();
function audioWarpArchive(withWarpMap, authority) {
	const key = `${authority}:${String(withWarpMap)}`;
	if (!archives.has(key)) archives.set(key, createAudioWarpArchive(withWarpMap, authority));
	return archives.get(key);
}

async function createAudioWarpArchive(withWarpMap, authority) {
	const nonidentity = typeof withWarpMap === 'string' && withWarpMap.startsWith('nonidentity-');
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `browser-audio-warp-fixture-${String(withWarpMap)}-${String(Date.now())}`,
		preferOpfs: false,
	});
	const source = createAudioSource({
		id: 'audio-warp-source', storageKey: 'audio-warp-source', name: 'Warp drum source',
		frameCount: FRAME_COUNT, channelCount: 1, sampleRate: SAMPLE_RATE,
	});
	const clip = createAudioClip({
		id: CLIP_ID, sourceId: source.id, title: 'Warp drums',
		timelineStartFrame: 0, durationFrames: FRAME_COUNT,
		sourceStartFrame: 0, sourceDurationFrames: FRAME_COUNT,
		warpMap: nonidentity
			? nonidentityWarpMap()
			: withWarpMap ? identityWarpMap() : null,
	});
	try {
		await persistAttacks(store, source, nonidentity);
		const options = {
			id: nonidentity ? `${PROJECT_ID}-${String(withWarpMap)}` : PROJECT_ID,
			title: 'Browser audio warp project',
			now: '2026-08-12T12:00:00.000Z',
			sampleRate: SAMPLE_RATE,
			masterChannels: 2,
			sources: [source],
			clips: [clip],
			tracks: [createAudioTrack({ id: TRACK_ID, name: 'Drums', clipIds: [CLIP_ID] })],
		};
		const project = authority === 'framescaper-v19'
			? createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, options)
			: createSoundscaperProjectV21(options);
		const exported = await exportScapeProject(project, store);
		if (!(exported.blob instanceof Blob)) throw new Error('Audio warp fixture export did not return a Blob.');
		return Buffer.from(await exported.blob.arrayBuffer());
	} finally {
		await store.close();
	}
}

function identityWarpMap() {
	return {
		feature: 'audio-warp',
		points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: FRAME_COUNT, source: FRAME_COUNT, mode: 'forward' },
		],
	};
}

function nonidentityWarpMap() {
	return {
		feature: 'audio-warp',
		points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 4_000, source: 2_000, mode: 'forward' },
			{ outer: 8_000, source: 10_000, mode: 'forward' },
			{ outer: FRAME_COUNT, source: FRAME_COUNT, mode: 'forward' },
		],
	};
}

async function persistAttacks(store, source, paritySignal = false) {
	const writer = await store.beginSourceWrite(source.storageKey, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
	const samples = new Float32Array(source.frameCount);
	if (paritySignal) {
		for (let frame = 0; frame < samples.length; frame += 1) {
			samples[frame] = ((frame % 257) - 128) / 256;
		}
		for (const impulse of [2_000, 10_000]) samples[impulse] = 1;
	} else {
		for (const onset of [1_500, 5_000, 8_500]) {
			for (let frame = onset; frame < onset + 384; frame += 1) samples[frame] = 0.8;
		}
	}
	await writer.write([samples]);
	await writer.commit();
}
