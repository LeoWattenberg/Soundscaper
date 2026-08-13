import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const DATABASE_NAME = 'kw-media-framescaper-editor-v18';
const MULTICAMERA_REQUIREMENT_ID = 'framescaper.multicamera';

test.describe('Framescaper V18 multicamera workflow', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('creates, switches, saves, and reopens an exact V18 camera group from Tracks', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit',
			'Playwright WebKit rejects the IndexedDB Blob write that persists imported A/V sources.');
		test.setTimeout(180_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
		if (await projectBin.isVisible()) {
			await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
			await expect(projectBin).toBeHidden();
		}
		await editor.getByRole('button', { name: 'Sequence timing', exact: true }).focus();
		await page.keyboard.press('Enter');
		const sequenceTiming = page.getByRole('dialog', { name: 'Sequence timing', exact: true });
		await expect(sequenceTiming).toBeVisible();
		await sequenceTiming.getByRole('combobox', { name: 'Frame rate', exact: true })
			.selectOption('15/1');
		await page.keyboard.press('Escape');
		await expect(sequenceTiming).toBeHidden();
		for (const fixture of [
			createDeterministicAvFixture('camera-a.webm'),
			createDeterministicAvFixture('camera-b.webm', { variant: 'portrait' }),
		]) {
			await editor.locator('[data-import-input]').setInputFiles(fixture);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 90_000 });
		}
		const videoClips = editor.locator('[data-clip-kind="video"]');
		await expect(videoClips).toHaveCount(2, { timeout: 30_000 });
		await videoClips.first().focus();
		await videoClips.first().press('Enter');
		await expect(videoClips.first().locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		// The synthetic WebM ends between nominal 15 fps frame boundaries. Trim
		// that partial tail through the real canonical keyboard route so the
		// camera group owns an exact one-to-one source interval.
		const outputClipId = await videoClips.first().getAttribute('data-clip-id');
		expect(outputClipId).toBeTruthy();
		const beforeTrim = await storedProject(page, projectId);
		const outputClip = beforeTrim.clips.find(({ id }) => id === outputClipId);
		const linkedAudioClip = beforeTrim.clips.find(({ kind, avLinkId }) => (
			kind === 'audio' && avLinkId && avLinkId === outputClip?.avLinkId
		));
		expect(linkedAudioClip?.id).toBeTruthy();
		const linkedAudio = editor.locator(`[data-clip-id="${linkedAudioClip.id}"][role="group"]`);
		await linkedAudio.focus();
		await linkedAudio.press('Control+Shift+ArrowLeft');
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await videoClips.first().focus();
		await videoClips.first().press('Enter');

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
		await expect.poll(() => editor.locator('[data-status]').textContent())
			.toMatch(/multicamera|camera group/iu);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect.poll(async () => JSON.stringify(await storedMulticamera(page, projectId)))
			.toContain('"groupCount":1');
		const created = await storedMulticamera(page, projectId);
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

		await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const switched = await storedMulticamera(page, projectId);
		const reopened = await bootEditor(page, `/framescaper/en/?project=${encodeURIComponent(projectId)}`);
		await expect(reopened).toHaveAttribute('data-project-id', projectId);
		await expect.poll(() => storedMulticamera(page, projectId)).toEqual(switched);
	});
});

async function storedMulticamera(page, projectId) {
	const latest = await storedProject(page, projectId);
	const groups = latest?.multicameraGroups || [];
	const group = groups[0] || null;
	return {
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
	}, { databaseName: DATABASE_NAME, id: projectId });
}
