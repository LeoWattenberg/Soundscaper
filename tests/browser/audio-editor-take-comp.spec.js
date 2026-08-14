import { expect, test } from './audio-editor-test-fixtures.js';

import {
	createAudioSourceV10,
	createAudioTrackV10,
} from '../../src/common/editor/project-v10.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectV19 } from '../../src/framescaper/editor-project-v19.ts';
import { createSoundscaperProjectV21 } from '../../src/soundscaper/editor-project-v21.ts';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	clipByName,
	collectClientErrors,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';

const FRAME_COUNT = 12_000;
const SAMPLE_RATE = 48_000;
const PROJECT_ID = 'browser-take-comp-project';
const TRACK_ID = 'take-comp-track';

test.describe('take lane and comp workflow', () => {
	registerAudioEditorHooks();

	test('Soundscaper reaches every comp edit through its menu and publishes flattened PCM', async ({ browserName, page }) => {
		test.setTimeout(120_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-editor-surface="take-comp"]')).toHaveCount(0);
		await installAudioResumeProbe(page);
		await openTakeCompArchive(editor, 'soundscaper');
		await expect(editor).toHaveAttribute('data-project-id', PROJECT_ID, { timeout: 20_000 });
		await expect(page.getByRole('dialog', { name: 'Project features unavailable', exact: true })).toHaveCount(0);

		const track = editor.locator(`[data-track-row][data-track-id="${TRACK_ID}"]`);
		await expect(track).toBeVisible();
		await track.locator('.track-control-panel__track-name-text').click();
		await expect(track.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');

		let dialog = await openTakeCompDialog(page, editor);
		await expect(dialog.locator('[data-take-comp-group]')).toBeFocused();
		await expect(dialog.locator('.audio-editor-take-comp__lanes > [role="listitem"]')).toHaveCount(2);
		await expect(dialog.getByRole('button', { name: 'Select Take A', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(dialog.getByRole('button', { name: 'Select Take B', exact: true })).toHaveAttribute('aria-pressed', 'false');
		await expect(dialog.getByRole('row', { name: /region-a take-a.*100.*5000/iu })).toBeVisible();
		await expect(dialog.getByRole('row', { name: /region-b take-b.*5000.*10000/iu })).toBeVisible();
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-take-comp-dialog]');

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('menuitem', { name: 'Tracks', exact: true })).toBeFocused();
		await chooseCommandAction(page, editor, 'Tracks', 'Lock track');
		dialog = await openTakeCompDialog(page, editor);
		await expect(dialog.getByText('Take operations are unavailable while the owning track is locked.', { exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Audition lane', exact: true }).first()).toBeDisabled();
		await expect(dialog.getByRole('button', { name: 'Flatten comp', exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'Tracks', 'Unlock track');

		dialog = await openTakeCompDialog(page, editor);
		const takeResumeBaseline = await audioResumeCount(page);
		await dialog.getByRole('button', { name: 'Audition Take A', exact: true }).click();
		await expect.poll(() => audioResumeCount(page)).toBeGreaterThan(takeResumeBaseline);
		const laneResumeBaseline = await audioResumeCount(page);
		await dialog.getByRole('button', { name: 'Audition lane', exact: true }).first().click();
		await expect.poll(() => audioResumeCount(page)).toBeGreaterThan(laneResumeBaseline);

		const sharedBoundary = dialog.getByText('Shared boundary: region-a → region-b', { exact: true }).locator('..');
		await sharedBoundary.getByRole('spinbutton').fill('4800');
		await sharedBoundary.getByRole('button', { name: 'Apply shared boundary', exact: true }).click();
		await expect(dialog.getByRole('row', { name: /region-a take-a.*100.*4800/iu })).toBeVisible();
		await expect(dialog.getByRole('row', { name: /region-b take-b.*4800.*10000/iu })).toBeVisible();

		const firstRegion = dialog.getByRole('row', { name: /region-a take-a/iu });
		await firstRegion.getByRole('spinbutton').first().fill('200');
		await firstRegion.getByRole('button', { name: 'Apply start', exact: true }).click();
		await expect(dialog.getByRole('row', { name: /region-a take-a.*200.*4800/iu })).toBeVisible();

		await dialog.getByRole('button', { name: 'Select Take B', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Select Take B', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await dialog.getByLabel('Range start sample', { exact: true }).fill('2500');
		await dialog.getByLabel('Range end sample', { exact: true }).fill('3500');
		await dialog.getByRole('button', { name: 'Promote range', exact: true }).click();
		await expect(dialog.getByRole('table', { name: 'Comp regions', exact: true }).getByRole('row')).toHaveCount(5);

		// WebKit does not implement forced-color-adjust, so its computed value is
		// empty there rather than the authored 'none'.
		if (browserName !== 'webkit') {
			await page.emulateMedia({ forcedColors: 'active' });
			await expect(dialog.getByRole('button', { name: 'Select Take A', exact: true })).toHaveCSS('forced-color-adjust', 'none');
		}
		await dialog.getByRole('button', { name: 'Flatten comp', exact: true }).click();
		await expect(dialog.locator('[data-take-comp-empty]')).toContainText('This project has no take groups yet.');
		await expect(clipByName(editor, 'group-a — flattened take.wav')).toBeVisible();
		await expect(dialog).toContainText('Take comp flattened.');

		await page.emulateMedia({ forcedColors: 'none' });
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		dialog = await openTakeCompDialog(page, editor);
		await expect(dialog.getByRole('table', { name: 'Comp regions', exact: true }).getByRole('row')).toHaveCount(5);
		await dialog.getByRole('button', { name: 'Remove take group', exact: true }).click();
		await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		dialog = await openTakeCompDialog(page, editor);
		await expect(dialog.locator('[data-take-comp-group]')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('Framescaper keeps take comps unavailable with bypass-only preservation and no menu', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await openTakeCompArchive(editor, 'framescaper');
		const decision = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(decision).toBeVisible();
		await expect(decision).toContainText('Take lanes and comps');
		await expect(decision).toContainText('Unavailable · Bypass declared');
		await expect(decision).not.toContainText('Rendered fallback declared');
		await decision.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await editor.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
		const menu = page.getByRole('menu', { name: 'Tracks', exact: true });
		await expect(menu.getByRole('menuitem', { name: 'Take lanes and comps', exact: true })).toHaveCount(0);
		await expect(editor.locator('[data-editor-surface="take-comp"]')).toHaveCount(0);
	});
});

async function openTakeCompDialog(page, editor) {
	await chooseCommandAction(page, editor, 'Tracks', 'Take lanes and comps');
	const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function openTakeCompArchive(editor, productId) {
	await editor.locator('[data-aup4-input]').setInputFiles({
		name: 'take-comp-workflow.scape',
		mimeType: SCAPE_MIME_TYPE,
		buffer: await takeCompArchive(productId),
	});
}

const archivePromises = new Map();
function takeCompArchive(productId) {
	if (!archivePromises.has(productId)) archivePromises.set(productId, createTakeCompArchive(productId));
	return archivePromises.get(productId);
}

async function createTakeCompArchive(productId) {
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `browser-take-comp-fixture-${String(Date.now())}`,
		preferOpfs: false,
	});
	const sources = [
		createAudioSourceV10({
			id: 'source-a', storageKey: 'source-a', name: 'Take A',
			frameCount: FRAME_COUNT, channelCount: 1, sampleRate: SAMPLE_RATE,
		}),
		createAudioSourceV10({
			id: 'source-b', storageKey: 'source-b', name: 'Take B',
			frameCount: FRAME_COUNT, channelCount: 1, sampleRate: SAMPLE_RATE,
		}),
	];
	try {
		await Promise.all([
			persistTone(store, sources[0], 330),
			persistTone(store, sources[1], 660),
		]);
		const createProject = productId === 'soundscaper'
			? createSoundscaperProjectV21
			: (options) => createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, options);
		const project = createProject({
			id: PROJECT_ID,
			title: 'Browser take comp project',
			now: '2026-08-12T12:00:00.000Z',
			sampleRate: SAMPLE_RATE,
			masterChannels: 1,
			sources,
			tracks: [createAudioTrackV10({ id: TRACK_ID, name: 'Vocal', clipIds: [] })],
			sequences: [{ id: 'main-sequence', trackIds: [TRACK_ID] }],
			primarySequenceId: 'main-sequence',
			takeGroups: [{
				id: 'group-a', sequenceId: 'main-sequence', trackId: TRACK_ID,
				startSample: 100, endSample: 10_000,
				laneOrder: ['lane-a', 'lane-b'],
				lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
				takes: [
					{ id: 'take-a', laneId: 'lane-a', sourceId: 'source-a', startSample: 100, endSample: 10_000, sourceStartSample: 0 },
					{ id: 'take-b', laneId: 'lane-b', sourceId: 'source-b', startSample: 100, endSample: 10_000, sourceStartSample: 200 },
				],
				compRegions: [
					{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 5000 },
					{ id: 'region-b', takeId: 'take-b', startSample: 5000, endSample: 10_000 },
				],
			}],
		});
		const exported = await exportScapeProject(project, store);
		if (!(exported.blob instanceof Blob)) throw new Error('Take comp fixture export did not return a Blob.');
		return Buffer.from(await exported.blob.arrayBuffer());
	} finally {
		await store.close();
	}
}

async function persistTone(store, source, frequency) {
	const writer = await store.beginSourceWrite(source.storageKey, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
	const samples = new Float32Array(source.frameCount);
	for (let frame = 0; frame < samples.length; frame += 1) {
		samples[frame] = Math.sin(2 * Math.PI * frequency * frame / source.sampleRate) * 0.2;
	}
	await writer.write([samples]);
	await writer.commit();
}

async function installAudioResumeProbe(page) {
	await page.evaluate(() => {
		globalThis.__takeCompAudioResumes = 0;
		const resume = AudioContext.prototype.resume;
		AudioContext.prototype.resume = function captureTakeCompAudioResume(...args) {
			globalThis.__takeCompAudioResumes += 1;
			return resume.apply(this, args);
		};
	});
}

function audioResumeCount(page) {
	return page.evaluate(() => globalThis.__takeCompAudioResumes);
}
