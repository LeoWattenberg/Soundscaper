/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeWorkspacePanel,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
	trackNameText,
} from './audio-editor-test-helpers.js';
import { installWebVcrHost } from './helpers/web-vcr-host.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

// Realtime recording needs an uninterrupted storage queue.
const realtimeTest = test.extend({ browserCoverage: false });

test.describe('Framescaper Web VCR', () => {
	registerAudioEditorHooks();

	test('opens from capture options and drives the packaged host lifecycle', async ({ browserName, page }) => {
		test.skip(
			browserName !== 'chromium',
			'The packaged Web VCR capture adapter requires Chromium MediaStreamTrackProcessor support.',
		);
		await installWebVcrHost(page);
		const editor = await bootEditor(page, '/framescaper/en/');

		const panels = await openNestedCommandMenu(page, editor, 'Window', []);
		await getMenuItem(panels, 'Recording setup').click();
		const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
		await expect(setup).toBeVisible();
		await expect(setup.getByRole('status')).not.toContainText('Checking capture support');

		await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();

		const workspacePanel = editor.locator('[data-workspace-panel="web-vcr"]');
		const panel = workspacePanel.locator('[data-framescaper-web-vcr]');
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
		await expect(panel.getByRole('status')).toContainText('Web VCR is ready to record.');
		await expect(panel.locator('video[aria-label="Web page preview"]')).toBeVisible();
		await expect(editor.locator('[data-workspace-panel="recording-setup"]')).toBeHidden();

		const address = panel.getByRole('textbox', { name: 'HTTPS address', exact: true });
		await address.fill('https://media.example.test/watch');
		await panel.getByRole('button', { name: 'Go', exact: true }).click();
		await expect(address).toHaveValue('https://media.example.test/watch');
		await expect(panel.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
		await panel.getByRole('button', { name: 'Back', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Forward', exact: true })).toBeEnabled();
		await panel.getByRole('button', { name: 'Forward', exact: true }).click();
		await panel.getByRole('button', { name: 'Reload', exact: true }).click();

		const interaction = panel.getByRole('application', { name: 'Interact with web page', exact: true });
		await interaction.click({ position: { x: 40, y: 30 } });
		await interaction.press('x');
		await interaction.press('Escape');
		await expect(address).toBeFocused();

		await panel.getByRole('combobox', { name: 'Capture resolution', exact: true }).selectOption('720p');
		await expect(panel).toContainText('1280 × 720');
		await panel.getByRole('checkbox', { name: 'Auto-crop', exact: true }).uncheck();
		const aspect = panel.getByRole('combobox', { name: 'Crop aspect', exact: true });
		await expect(aspect).toBeEnabled();
		await aspect.selectOption('1:1');
		await panel.getByRole('button', { name: 'Move crop area', exact: true }).press('ArrowRight');
		await panel.getByRole('checkbox', { name: 'Mute local audio', exact: true }).check();
		await panel.getByRole('checkbox', {
			name: 'Stop automatically when the target video ends', exact: true,
		}).check();

		const clearButton = panel.getByRole('button', { name: 'Clear browser data', exact: true });
		await clearButton.focus();
		await clearButton.press('Enter');
		const clear = panel.getByRole('group', { name: 'Clear browser data', exact: true });
		await expect(clear.getByRole('alert')).toContainText('cookies, cache and sign-ins');
		const confirmClear = clear.getByRole('button', { name: 'Permanently clear browser data', exact: true });
		await confirmClear.focus();
		await confirmClear.press('Enter');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
		await expect(address).toHaveValue('about:blank');

		await expect.poll(() => webVcrState(page)).toMatchObject({
			openCalls: 2,
			previewCalls: 3,
			prepareCaptureCalls: 3,
		});
		const beforeClose = await webVcrState(page);
		expect(beforeClose.commandKinds).toEqual(expect.arrayContaining([
			'navigate', 'go-back', 'go-forward', 'reload',
			'pointer-input', 'key-input', 'set-resolution', 'set-auto-crop',
			'set-crop', 'set-monitor-muted', 'set-auto-stop',
			'request-data-clear', 'clear-browser-data',
		]));

		await closeWorkspacePanel(editor, 'web-vcr');
		await expect.poll(() => webVcrState(page)).toMatchObject({ disposedSessions: 1 });
	});

	realtimeTest('records and reopens a Web VCR screen and system-audio take', async ({ browserName, page }) => {
		test.skip(browserName !== 'chromium', 'Web VCR capture requires Chromium MediaStreamTrackProcessor support.');
		test.setTimeout(120_000);
		await installWebVcrHost(page, { recordingFixture: true });
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const panels = await openNestedCommandMenu(page, editor, 'Window', []);
		await getMenuItem(panels, 'Recording setup').click();
		const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
		await expect(setup).toBeVisible();
		await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
		await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();

		const panel = editor.locator('[data-workspace-panel="web-vcr"] [data-framescaper-web-vcr]');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
		const record = panel.getByRole('button', { name: 'Record web capture', exact: true });
		await expect(record).toBeEnabled();
		await record.press('Enter');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'recording', { timeout: 30_000 });
		await expect.poll(async () => (await webVcrState(page)).audioDataClosed, {
			timeout: 30_000,
		}).toBeGreaterThanOrEqual(3);
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready', { timeout: 60_000 });
		await expect(trackNameText(editor).filter({ hasText: /^Screen$/u })).toHaveCount(1);
		await expect(trackNameText(editor).filter({ hasText: /^System Audio$/u })).toHaveCount(1);
		const capturedItems = editor.getByRole('listitem', { name: /^Project bin: Web Capture /u });
		await expect(capturedItems).toHaveCount(2);
		await expect(capturedItems.first()).toContainText('WEBM');
		await expect(capturedItems.last()).toContainText('SOUNDSCAPER-PCM');
		await expect.poll(() => storedWebVcrTake(page, projectId)).toMatchObject({
			sourceKinds: ['audio', 'video'], projectBinClipCount: 2,
		});
		expect((await webVcrState(page)).captureStates).toEqual([
			'preparing', 'recording', 'finalizing', 'ready',
		]);

		await page.goto(resolveBrowserProductTestUrl(`/framescaper/en/?project=${encodeURIComponent(projectId)}`));
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
		await expect(trackNameText(editor).filter({ hasText: /^Screen$/u })).toHaveCount(1);
		await expect(trackNameText(editor).filter({ hasText: /^System Audio$/u })).toHaveCount(1);
		await expect(editor.getByRole('listitem', { name: /^Project bin: Web Capture /u })).toHaveCount(2);
	});
});

async function storedWebVcrTake(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'revisions'], 'readonly');
			const [project, revisions] = await Promise.all([
				result(transaction.objectStore('projects').get(id)),
				result(transaction.objectStore('revisions').getAll()),
			]);
			const latest = revisions
				.filter(({ projectId: revisionProjectId }) => revisionProjectId === id)
				.sort((left, right) => right.revision - left.revision)[0]?.project || project;
			return {
				sourceKinds: (latest?.sources ?? []).map(({ kind }) => kind).sort(),
				projectBinClipCount: latest?.projectBin?.clips?.length ?? -1,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function webVcrState(page) {
	return page.evaluate(() => ({
		audioDataClosed: globalThis.__framescaperWebVcrHarness.audioDataClosed,
		captureStates: globalThis.__framescaperWebVcrHarness.captureStates,
		commandKinds: globalThis.__framescaperWebVcrHarness.commands.map(({ kind }) => kind),
		disposedSessions: globalThis.__framescaperWebVcrHarness.disposedSessions,
		openCalls: globalThis.__framescaperWebVcrHarness.openCalls,
		prepareCaptureCalls: globalThis.__framescaperWebVcrHarness.prepareCaptureCalls,
		previewCalls: globalThis.__framescaperWebVcrHarness.previewCalls,
	}));
}
