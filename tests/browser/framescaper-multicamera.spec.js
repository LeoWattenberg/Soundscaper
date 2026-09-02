import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	closeWorkspacePanel,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const MULTICAMERA_REQUIREMENT_ID = 'framescaper.multicamera';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');

test.describe('Framescaper selected-web multicamera workflow', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('creates, switches, saves, and reopens an exact Framescaper-v1 camera group from Tracks', async ({ page, browserName }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit',
			'Playwright WebKit rejects the IndexedDB Blob write that persists imported A/V sources.');
		test.setTimeout(180_000);
		await page.setViewportSize({ width: 1_440, height: 1_100 });
		const editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await closeWorkspacePanel(editor, 'project-bin');
		await editor.getByRole('button', { name: 'Sequence timing', exact: true }).focus();
		await page.keyboard.press('Enter');
		const sequenceTiming = page.getByRole('dialog', { name: 'Sequence timing', exact: true });
		await expect(sequenceTiming).toBeVisible();
		await sequenceTiming.getByRole('combobox', { name: 'Frame rate', exact: true })
			.selectOption('25/1');
		await page.keyboard.press('Escape');
		await expect(sequenceTiming).toBeHidden();
		for (const fixture of [
			cameraFixture('camera-a.mp4'),
			cameraFixture('camera-b.mp4'),
		]) {
			await editor.locator('[data-import-input]').setInputFiles(fixture);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 90_000 });
		}
		const videoClips = editor.locator('[data-clip-kind="video"]');
		await expect(videoClips).toHaveCount(2, { timeout: 30_000 });
		await videoClips.first().focus();
		await videoClips.first().press('Enter');
		await expect(videoClips.first().locator('.clip-display')).toHaveClass(/clip-display--selected/u);

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

		await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const switched = await storedMulticamera(page, projectId);
		const reopened = await bootEditor(page, `/framescaper/en/?project=${encodeURIComponent(projectId)}`);
		await expect(reopened).toHaveAttribute('data-project-id', projectId);
		await expect.poll(() => storedMulticamera(page, projectId)).toEqual(switched);
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

function cameraFixture(name) {
	return {
		name,
		mimeType: CFR.file.mimeType,
		buffer: Buffer.from(CFR.file.buffer),
	};
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
