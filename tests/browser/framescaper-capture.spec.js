/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseNestedCommandAction, closeWorkspacePanel,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
	trackNameText,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import {
	assertCaptureForcedColorContract,
	captureHarnessState,
	expectCaptureCalls,
	expectCapturePhase,
	installCaptureHarness,
	openRecordingSetup,
	projectBinCaptureCard,
	recordingSetupWorkspacePanel,
	selectSourceRoles,
	storedCaptureRecoveryState,
	storedCaptureState,
	storedProjectExists,
	waitForRecordingSetup,
} from './helpers/framescaper-capture-harness.js';

// Precise browser coverage can stall the bounded realtime audio storage queue.
const realtimeTest = test.extend({ browserCoverage: false });
const REQUIRED_SOURCE_COMBINATIONS = Object.freeze([
	Object.freeze({ roles: ['camera'], calls: ['user'], tracks: 1 }),
	Object.freeze({ roles: ['microphone'], calls: ['user'], tracks: 1 }),
	Object.freeze({ roles: ['display'], calls: ['display'], tracks: 2, systemAudio: true }),
	Object.freeze({ roles: ['camera', 'microphone'], calls: ['user'], tracks: 2 }),
	Object.freeze({ roles: ['display', 'microphone'], calls: ['display', 'user'], tracks: 2, systemAudio: false }),
	Object.freeze({ roles: ['camera', 'display', 'microphone'], calls: ['display', 'user'], tracks: 4, systemAudio: true }),
]);
test.describe('Framescaper v1 recoverable capture', () => {
	test.describe.configure({ mode: 'default' });
	registerAudioEditorHooks();

	test('is default-hidden and opens setup without implicit device access', async ({ page, browserName }) => {
		await installCaptureHarness(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const workspacePanel = recordingSetupWorkspacePanel(editor);

		await expect(workspacePanel).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Recording setup', exact: true })).toHaveCount(0);
		await expectCaptureCalls(page, []);

		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		const setupItem = getMenuItem(panels, 'Recording setup');
		await expect(setupItem).toBeEnabled();
		await expectCaptureCalls(page, []);
		await setupItem.focus();
		await setupItem.press('Enter');

		const panel = await waitForRecordingSetup(editor);
		await expect(panel.getByRole('status')).toContainText('Capture is inactive.');
		await expectCaptureCalls(page, []);
		await assertAccessibleBasics(panel);
		await assertNoSeriousAxeViolations(page, '[data-workspace-panel="recording-setup"]');
		await page.emulateMedia({ forcedColors: 'active' });
		await assertCaptureForcedColorContract(page, panel.getByRole('status'), browserName);
		await page.emulateMedia({ forcedColors: 'none' });

		const toolbarRecord = editor.getByRole('button', { name: 'Recording setup', exact: true });
		await expect(toolbarRecord).toBeVisible();
		await closeWorkspacePanel(editor, 'recording-setup');
		await expect(workspacePanel).toHaveCount(0);
		await expect(toolbarRecord).toBeFocused();
		await toolbarRecord.press('Enter');
		await waitForRecordingSetup(editor);
		await expectCaptureCalls(page, []);
	});

	test('fails closed on the embedded route without requesting permission', async ({ page }) => {
		await installCaptureHarness(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const panel = await openRecordingSetup(page, editor);

		await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
		await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
		await expectCaptureCalls(page, []);
		await assertAccessibleBasics(panel);
	});

		test('reports an unsupported standalone runtime without capture APIs', async ({ page }) => {
			await page.addInitScript(() => {
				let enumerateCalls = 0;
				Object.defineProperty(globalThis, '__framescaperCaptureUnsupportedEnumerateCalls', {
					configurable: true,
					get: () => enumerateCalls,
				});
				Object.defineProperty(navigator, 'mediaDevices', {
					configurable: true,
					value: Object.freeze({
						enumerateDevices: async () => { enumerateCalls += 1; return []; },
					}),
			});
			for (const name of ['MediaRecorder', 'MediaStreamTrackProcessor', 'AudioWorkletNode']) {
				Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
			}
		});
		const editor = await bootEditor(page, '/framescaper/en/');
		const panel = await openRecordingSetup(page, editor);

			await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
			await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
			expect(await page.evaluate(() => globalThis.__framescaperCaptureUnsupportedEnumerateCalls)).toBe(0);
			await assertAccessibleBasics(panel);
		});

	test('previews all six required combinations and optional system audio from direct gestures', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page);
			const editor = await bootEditor(page, '/framescaper/en/');
			const panel = await openRecordingSetup(page, editor);
			let expectedStops = 0;
			let requestOffset = 0;
			await expectCaptureCalls(page, []);

			for (const [index, combination] of REQUIRED_SOURCE_COMBINATIONS.entries()) {
			await page.evaluate((enabled) => {
				globalThis.__framescaperCaptureHarness.includeSystemAudio = enabled;
			}, combination.systemAudio !== false);
			await selectSourceRoles(panel, combination.roles);
			const preview = panel.getByRole('button', { name: 'Preview sources', exact: true });
			await expect(preview).toBeEnabled();
			await preview.focus();
			await preview.press('Enter');
			await expectCapturePhase(panel, 'previewing');

				const state = await captureHarnessState(page);
				expect(state.requests.slice(requestOffset).map(({ kind }) => kind)).toEqual(combination.calls);
				expect(state.enumerateCalls).toBe(index + 1);
			requestOffset = state.requests.length;
			if (combination.calls.includes('display')) {
				const displayRequest = state.requests.findLast(({ kind }) => kind === 'display');
				expect(displayRequest.constraints).toMatchObject({ video: true, audio: true });
			}
			if (combination.calls.includes('user')) {
				const userRequest = state.requests.findLast(({ kind }) => kind === 'user');
				expect(Boolean(userRequest.constraints.video)).toBe(combination.roles.includes('camera'));
				expect(Boolean(userRequest.constraints.audio)).toBe(combination.roles.includes('microphone'));
			}
			const systemAudio = panel.locator('article').filter({ hasText: 'System or tab audio' });
			await expect(systemAudio).toHaveCount(combination.systemAudio ? 1 : 0);

			if (combination.roles.length === 2 && combination.roles.includes('camera')) {
				await assertAccessibleBasics(panel);
			}
			await panel.getByRole('button', { name: 'Release sources', exact: true }).press('Enter');
			await expectCapturePhase(panel, 'inactive');
			expectedStops += combination.tracks;
			await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(expectedStops);
		}

		const finalState = await captureHarnessState(page);
		expect(finalState.displayCalls).toBe(3);
		expect(finalState.userCalls).toBe(5);
		expect(finalState.stopCalls).toBe(finalState.createdTracks);
	});

	realtimeTest('records, pauses, resumes, imports once, and reopens ordinary media', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page, { audioFrameIntervalMs: 500 }); // Leave time for WebKit's capture storage during menu navigation.
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		let panel = await openRecordingSetup(page, editor);
		const settings = editor.getByRole('button', { name: 'Customize toolbar', exact: true });
		await settings.click();
		const toolbarFlyout = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
		const recordToggle = toolbarFlyout.getByRole('checkbox', { name: 'Recording setup', exact: true });
		await expect(recordToggle).toHaveAttribute('aria-checked', 'true');
		await recordToggle.click();
		await expect(recordToggle).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await expect(editor.getByRole('button', { name: 'Recording setup', exact: true })).toHaveCount(0);

		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'previewing');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await expect(panel.getByRole('radio', { name: 'Project Bin and timeline', exact: true })).toBeChecked();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'armed');
		await expect(panel.getByRole('checkbox', { name: 'Microphone', exact: true })).toBeDisabled();
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(3);
		await expectCapturePhase(panel, 'recording');
		await closeWorkspacePanel(editor, 'recording-setup');
		await expect(editor.getByRole('button', { name: 'Stop and import', exact: true })).toBeVisible();
		panel = await openRecordingSetup(page, editor);
		await expectCapturePhase(panel, 'recording');

		await panel.getByRole('button', { name: 'Pause capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'paused');
		const pausedAt = (await captureHarnessState(page)).audioDataClosed;
		await panel.getByRole('button', { name: 'Resume capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThan(pausedAt + 2);

		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(1);
		await expectCapturePhase(panel, 'inactive', 30_000);
			await expect(trackNameText(editor).filter({ hasText: /^Microphone$/u })).toHaveCount(1);
			await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
			await expect.poll(() => storedCaptureState(page, projectId)).toMatchObject({
				schemaFamily: 'framescaper', schemaVersion: 1, sourceCount: 1, projectBinClipCount: 1,
			});
			const beforeReopen = await captureHarnessState(page);

		await page.goto(resolveBrowserProductTestUrl(`/framescaper/en/?project=${encodeURIComponent(projectId)}`));
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
		await expect(trackNameText(editor).filter({ hasText: /^Microphone$/u })).toHaveCount(1);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
			const reopenedHarness = await captureHarnessState(page);
			expect(reopenedHarness.requests).toEqual([]);
			expect(reopenedHarness.enumerateCalls).toBe(0);
			expect(beforeReopen.requests).toHaveLength(1);
			expect(beforeReopen.enumerateCalls).toBe(1);
		});

		test('publishes mixed capture while unavailable browser proxies fail closed', async ({ page }) => {
			test.setTimeout(180_000);
		await installCaptureHarness(page, { persistentQuota: true, videoKind: 'cfr' });
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		let panel = await openRecordingSetup(page, editor);

		await selectSourceRoles(panel, ['camera', 'display', 'microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'previewing');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording', 30_000);
		await expect.poll(async () => (
			await captureHarnessState(page)
		).audioProcessorConstructions).toBe(2);
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(2);
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(editor.locator('[data-editor-toast]').filter({
			hasText: 'capture derivatives completed with failures',
		})).toContainText('This runtime cannot generate captured video proxies.', { timeout: 90_000 });

			for (const name of ['Camera', 'Screen', 'Microphone', 'System Audio']) {
				await expect(trackNameText(editor).filter({ hasText: new RegExp(`^${name}$`, 'u') })).toHaveCount(1);
				await expect(projectBinCaptureCard(editor, `${name} Capture`)).toBeVisible();
			}
			expect((await captureHarnessState(page)).videoDataEvents).toBe(2);
			await expect.poll(
				() => storedCaptureState(page, projectId),
				{ timeout: 90_000 },
			).toMatchObject({
				schemaFamily: 'framescaper', schemaVersion: 1,
				sourceCount: 4,
				videoSourceCount: 2,
				proxyAttachmentCount: 0,
				videoSources: Array(2).fill({ characteristicsBackend: 'container', proxyAttached: false }),
				projectBinClipCount: 4,
			});

		await page.goto(resolveBrowserProductTestUrl(`/framescaper/en/?project=${encodeURIComponent(projectId)}`));
		editor = await waitForEditor(page);
		panel = await openRecordingSetup(page, editor);
		await expectCapturePhase(panel, 'inactive');
		for (const name of ['Camera', 'Screen', 'Microphone', 'System Audio']) {
			await expect(projectBinCaptureCard(editor, `${name} Capture`)).toBeVisible();
		}
			const reopenedHarness = await captureHarnessState(page);
			expect(reopenedHarness.requests).toEqual([]);
			expect(reopenedHarness.enumerateCalls).toBe(0);
	});

	test('keeps capture bound to its origin while another project is edited', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const originProjectId = await editor.getAttribute('data-project-id');
		expect(originProjectId).toBeTruthy();
		let panel = await openRecordingSetup(page, editor);

		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('radio', { name: 'Timeline', exact: true }).check();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (
			await captureHarnessState(page)
		).audioProcessorConstructions).toBe(1);

		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', originProjectId);
		const editedProjectTrackCount = await trackNameText(editor).count();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(trackNameText(editor)).toHaveCount(editedProjectTrackCount + 1);
		panel = await waitForRecordingSetup(editor);
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toHaveCount(0);

		const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
		await expect(tabs).toHaveCount(2);
		await tabs.first().click();
		await expect(editor).toHaveAttribute('data-project-id', originProjectId);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toHaveCount(0);
		await expect(trackNameText(editor).filter({ hasText: /^Microphone$/u })).toHaveCount(1);
	});

	realtimeTest('refuses confirmed deletion of a recording origin until Stop and import', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page, { audioFrameIntervalMs: 500 });
		const editor = await bootEditor(page, '/framescaper/en/');
		const originId = await editor.getAttribute('data-project-id');
		expect(originId).toBeTruthy();
		await expect.poll(() => storedProjectExists(page, originId)).toBe(true);
		const panel = await openRecordingSetup(page, editor);
		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('radio', { name: 'Project Bin', exact: true }).check();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(2);
		const framesBeforeDelete = (await captureHarnessState(page)).audioDataClosed;

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
		const confirm = page.getByRole('dialog', { name: 'Delete this project?' });
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(editor.locator('[data-editor-toast="workspace-error"]'))
			.toContainText(/capture protects .* from delete until stop or discard/u);
		await expect(confirm).toBeVisible();
		await expect(editor).toHaveAttribute('data-project-id', originId);
		await expect.poll(() => storedProjectExists(page, originId)).toBe(true);
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThan(framesBeforeDelete);
		expect((await captureHarnessState(page)).stopCalls).toBe(0);
		await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(confirm).toBeHidden();
		await expect(editor).not.toHaveAttribute('data-project-id', originId);
		await expect.poll(() => storedProjectExists(page, originId)).toBe(false);
	});

	realtimeTest('allows deletion of another project during capture of its origin', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page, { audioFrameIntervalMs: 500 });
		const editor = await bootEditor(page, '/framescaper/en/');
		const originId = await editor.getAttribute('data-project-id');
		expect(originId).toBeTruthy();
		await expect.poll(() => storedProjectExists(page, originId)).toBe(true);
		const panel = await openRecordingSetup(page, editor);
		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');

		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', originId);
		const otherId = await editor.getAttribute('data-project-id');
		expect(otherId).toBeTruthy();
		await expect.poll(() => storedProjectExists(page, otherId)).toBe(true);
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
		await expectCapturePhase(panel, 'recording');
		const confirm = page.getByRole('dialog', { name: 'Delete this project?' });
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(confirm).toBeHidden({ timeout: 30_000 });
		await expect(editor).not.toHaveAttribute('data-project-id', otherId);
		await expect.poll(() => storedProjectExists(page, otherId)).toBe(false);
		await expect.poll(() => storedProjectExists(page, originId)).toBe(true);
	});

	test('releases display media on later permission denial and recovers a source-ended prefix after reload', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page);
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		let panel = await openRecordingSetup(page, editor);

		await selectSourceRoles(panel, ['display', 'microphone']);
		await page.evaluate(() => { globalThis.__framescaperCaptureHarness.denyNextUser = true; });
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'failed');
		await expect(panel.getByRole('status')).toContainText('Fixture user-media permission denied.');
		let state = await captureHarnessState(page);
		expect(state.requests.map(({ kind }) => kind)).toEqual(['display', 'user']);
		expect(state.stopCalls).toBe(2);
		await panel.getByRole('button', { name: 'Try again', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive');

		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'previewing');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('radio', { name: 'Project Bin', exact: true }).check();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(2);
		expect(await page.evaluate(() => globalThis.__framescaperCaptureHarness.endNewest('microphone'))).toBe(true);
		await expectCapturePhase(panel, 'recovery');
		await expect(panel.getByRole('status')).toContainText('A required capture source ended.');
		await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(3);
		await expect.poll(() => storedCaptureRecoveryState(page, projectId), { timeout: 30_000 }).toEqual({
			state: 'sealed', retainedPresentationRangeCount: 1,
		});

		await page.goto(resolveBrowserProductTestUrl(`/framescaper/en/?project=${encodeURIComponent(projectId)}`));
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
		panel = await openRecordingSetup(page, editor);
		await expectCapturePhase(panel, 'recovery');
		await expect(panel.getByRole('button', { name: 'Recover capture', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Delete capture', exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Import playable data as-is', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
			state = await captureHarnessState(page);
			expect(state.requests).toEqual([]);
			expect(state.enumerateCalls).toBe(0);
		});
});
