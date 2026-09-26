import { createHash } from 'node:crypto';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	closeWorkspacePanel,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

const MULTICAMERA_REQUIREMENT_ID = 'framescaper.multicamera';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const QUADRANTS = videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1');
const PREVIEW_TIMECODE = '00:00:00:10';

test.describe('Framescaper selected-web multicamera workflow', () => {
	test('creates, switches, saves, and reopens an exact Framescaper-v1 camera group from Tracks', async ({ page, browserName }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit',
			'Playwright WebKit rejects the IndexedDB Blob write that persists imported A/V sources.');
		test.setTimeout(180_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await closeWorkspacePanel(editor, 'project-bin');
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		await metadataPanel.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
		const sequenceTiming = metadataPanel.getByRole('tabpanel', { name: 'Sequence timing', exact: true });
		await expect(sequenceTiming).toBeVisible();
		await sequenceTiming.getByRole('combobox', { name: 'Frame rate', exact: true })
			.selectOption('25/1');
		await closeWorkspacePanel(editor, 'metadata');
		await expect(sequenceTiming).toBeHidden();
		for (const fixture of [
			cameraFixture(CFR, 'camera-a.mp4'),
			cameraFixture(QUADRANTS, 'camera-b.mp4'),
		]) {
			await editor.locator('[data-import-input]').setInputFiles(fixture);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 90_000 });
		}
		const videoClips = editor.locator('[data-clip-kind="video"]');
		await expect(videoClips).toHaveCount(2, { timeout: 30_000 });
		// Keep the alternate source in the project while the selected output clip
		// alone owns the program picture at the assertion frame.
		await editor.getByRole('button', { name: 'Hide video', exact: true }).last().click();
		await expect(editor.getByRole('button', { name: 'Show video', exact: true })).toHaveCount(1);
		await videoClips.first().focus();
		await videoClips.first().press('Enter');
		await expect(videoClips.first().locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		await seekFramescaperTimecode(page, editor, PREVIEW_TIMECODE);
		const originalPicture = await previewPictureDigest(editor);

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
		await assertMulticameraMenuAccessibility(page, editor, browserName);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect.poll(async () => JSON.stringify(await storedMulticamera(page, projectId)))
			.toContain('"groupCount":1');
		const created = await storedMulticamera(page, projectId);
		expect(created).toMatchObject({ schemaFamily: 'framescaper', schemaVersion: 1 });
		const initialActiveMemberId = created.activeMemberId;
		expect(initialActiveMemberId).toBeTruthy();
		expect(created.requirementIds).toContain(MULTICAMERA_REQUIREMENT_ID);

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect.poll(() => storedMulticamera(page, projectId)).toMatchObject({
			groupCount: 1,
			memberCount: 2,
		});
		await expect.poll(async () => (await storedMulticamera(page, projectId)).activeMemberId)
			.not.toBe(initialActiveMemberId);
		await expect.poll(() => previewPictureDigest(editor), { timeout: 30_000 })
			.not.toBe(originalPicture);
		const switchedPicture = await previewPictureDigest(editor);
		expect((await previewQuadrants(page, editor)).map((channels) => channels.map((value) => value > 150)))
			.toEqual([
				[true, false, false], [false, true, false],
				[false, false, true], [true, true, true],
			]);

		await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const switched = await storedMulticamera(page, projectId);
		const reopened = await bootEditor(page, `/framescaper/en/?project=${encodeURIComponent(projectId)}`);
		await expect(reopened).toHaveAttribute('data-project-id', projectId);
		await expect.poll(() => storedMulticamera(page, projectId)).toEqual(switched);
		await seekFramescaperTimecode(page, reopened, PREVIEW_TIMECODE);
		await expect.poll(() => previewPictureDigest(reopened), { timeout: 30_000 })
			.toBe(switchedPicture);
	});
});

async function assertMulticameraMenuAccessibility(page, editor, browserName) {
	await page.emulateMedia({ forcedColors: 'active' });
	const tracks = editor.getByRole('menubar', { name: /^(Application menu|Anwendungsmenü)$/ })
		.getByRole('menuitem', { name: 'Tracks', exact: true });
	await tracks.click();
	const tracksMenu = page.getByRole('menu', { name: 'Tracks', exact: true });
	const multicamera = tracksMenu.getByRole('menuitem', { name: /^Multicamera(?:\s|$)/u });
	await multicamera.focus();
	await page.keyboard.press('ArrowRight');
	const submenu = multicamera.getByRole('menu');
	await expect(submenu).toBeVisible();
	await submenu.evaluate((element) => { element.id = 'framescaper-multicamera-accessibility-menu'; });
	await assertAccessibleBasics(submenu);
	await assertNoSeriousAxeViolations(page, '#framescaper-multicamera-accessibility-menu');
	if (browserName !== 'webkit') {
		await expect(submenu.getByRole('menuitem', { name: /^Switch camera(?:\s|$)/u }))
			.toHaveCSS('forced-color-adjust', 'auto');
	}
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await page.emulateMedia({ forcedColors: 'none' });
}

function cameraFixture(media, name) {
	return {
		name,
		mimeType: media.file.mimeType,
		buffer: Buffer.from(media.file.buffer),
	};
}

async function previewPictureDigest(editor) {
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '', { timeout: 30_000 });
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	const canvas = editor.locator('[data-video-preview-canvas]');
	await expect(canvas).toBeVisible();
	return createHash('sha256').update(await canvas.screenshot()).digest('hex');
}

async function previewQuadrants(page, editor) {
	const png = await editor.locator('[data-video-preview-canvas]').screenshot();
	return page.evaluate(async (base64) => {
		const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		try {
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('Program picture pixels are unavailable.');
			context.drawImage(bitmap, 0, 0);
			return [0.3, 0.7].flatMap((y) => [0.3, 0.7].map((x) =>
				Array.from(context.getImageData(Math.floor(x * bitmap.width), Math.floor(y * bitmap.height), 1, 1).data).slice(0, 3)));
		} finally { bitmap.close(); }
	}, png.toString('base64'));
}

async function storedMulticamera(page, projectId) {
	const latest = await storedProject(page, projectId);
	const groups = latest?.multicameraGroups || [];
	const group = groups[0] || null;
	return {
		schemaFamily: latest?.schemaFamily ?? null,
		schemaVersion: latest?.schemaVersion ?? null,
		groupCount: groups.length,
		memberCount: group?.members?.length || 0,
		activeMemberId: group?.activeMemberId || null,
		requirementIds: (latest?.featureRequirements?.requirements || [])
			.map(({ id: requirementId }) => requirementId),
	};
}

async function storedProject(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const requestResult = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await requestResult(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'revisions'], 'readonly');
			const [project, revisions] = await Promise.all([
				requestResult(transaction.objectStore('projects').get(id)),
				requestResult(transaction.objectStore('revisions').getAll()),
			]);
			const latest = revisions
				.filter(({ projectId: revisionProjectId }) => revisionProjectId === id)
				.sort((left, right) => right.revision - left.revision)[0]?.project || project;
			return latest;
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
