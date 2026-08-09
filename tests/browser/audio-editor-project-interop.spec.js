import {
	aup4NativeRichFixture,
	createAup3Fixture,
	createAup4MissingEffectFixture,
	expect,
	readFile,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	clipField,
	closeAup4CompatibilityReport,
	closeDialog,
	closeEffectsPanel,
	collectClientErrors,
	commitInput,
	importFiles,
	openAnalysisPanel,
	openClipProperties,
	openEffectsForTrack,
	registerAudioEditorHooks,
	seekOnRuler,
	showToolbarButton,
	trackNameText,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('duplicates, deletes, and opens local projects through accessible menus and dialogs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Duplicate project');
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		await chooseFileAction(page, editor, 'Delete project');

		const confirm = page.getByRole('dialog', { name: 'Delete this project?' });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(confirm).not.toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await chooseFileAction(page, editor, 'Local projects');
		const projects = page.getByRole('dialog', { name: 'Local projects' });
		await expect(projects).toBeVisible();
		await expect(projects.locator('[data-project-list] li')).not.toHaveCount(0);
		await projects.getByRole('button', { name: 'Close' }).click();
		expect(errors).toEqual([]);
	});

	test('imports, edits, mixes track states, analyzes, and restores the autosaved project', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await showToolbarButton(page, editor, 'Split at playhead');

		await importFiles(editor, [toneA, toneB]);
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await expect(clipByName(editor, toneB.name)).toHaveCount(1);

		const firstClip = clipByName(editor, toneA.name);
		await firstClip.click({ position: { x: 24, y: 10 } });
		const clipDialog = await openClipProperties(page, editor, firstClip);
		await expect(clipDialog.locator('[data-clip-fields]')).toHaveAttribute('aria-disabled', 'false');
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('38400');
		await commitInput(clipField(clipDialog, 'startFrame'), '120');
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('120');
		await closeDialog(clipDialog);

		await seekOnRuler(editor, 48);
		await editor.getByRole('button', { name: 'Split at playhead' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await editor.getByRole('button', { name: 'Redo' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '3');

		const secondImportedTrack = editor.locator('[data-track-row]').nth(2);
		await secondImportedTrack.getByRole('button', { name: 'Mute' }).click();
		await secondImportedTrack.getByRole('button', { name: 'Solo' }).click();
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await secondImportedTrack.getByRole('button', { name: /^Arm for recording:/ }).click();
		await expect(secondImportedTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(secondImportedTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('button[aria-label^="Arm for recording:"][aria-pressed="true"]')).toHaveCount(2);

		const effectsPanel = await openEffectsForTrack(editor, 2);
		await commitInput(effectsPanel.locator('[data-master-gain] input'), '-3');
		await expect(effectsPanel.locator('[data-master-gain] input')).toHaveValue('-3.00');
		await closeEffectsPanel(effectsPanel);

		const analysisPanel = await openAnalysisPanel(page, editor);
		await expect(analysisPanel.getByRole('button', { name: 'Analyze track', exact: true })).toHaveCount(0);
		await analysisPanel.getByRole('button', { name: 'Analyze master' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(analysisPanel.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS');
		await expect(analysisPanel.locator('[data-analysis-value="clipping"]')).toHaveText('0');
		await expect(analysisPanel.locator('[data-analysis-spectrum]')).toBeVisible();
		await expect(analysisPanel.locator('[data-analysis-spectrogram]')).toBeVisible();
		await analysisPanel.getByRole('button', { name: 'Close: Analysis', exact: true }).click();
		await expect(analysisPanel).toHaveCount(0);

		for (const [command, panelId, panelName] of [
			['Plot spectrum', 'spectrum', 'Plot spectrum'],
			['Find clipping', 'clipping', 'Find clipping'],
			['Contrast', 'contrast', 'Contrast'],
			['EBU R 128', 'ebu-r128', 'EBU R 128'],
		]) {
			await chooseCommandAction(page, editor, 'Analyze', command);
			const analyzerPanel = editor.locator(`[data-workspace-panel="${panelId}"]`);
			await expect(analyzerPanel).toBeVisible();
			await expect(analyzerPanel).toHaveCSS('resize', 'none');
			await expect(analyzerPanel.locator('[data-floating-panel-resize-handle]')).toHaveCount(0);
			if (panelId === 'ebu-r128') {
				await expect(analyzerPanel.locator('.kw-audio-editor__ebu-dashboard')).toBeVisible();
			}
			await analyzerPanel.getByRole('button', { name: `Close: ${panelName}`, exact: true }).click();
			await expect(analyzerPanel).toHaveCount(0);
		}

		await chooseNestedCommandAction(page, editor, 'View', ['Panels']);
		const panelsMenu = page.getByRole('menu', { name: 'Panels', exact: true });
		for (const analyzerName of ['Analysis', 'Plot spectrum', 'Find clipping', 'Contrast', 'EBU R 128']) {
			await expect(panelsMenu.getByRole('menuitem', { name: analyzerName, exact: true })).toHaveCount(0);
		}
		await page.keyboard.press('Escape');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await expect(restored).toHaveAttribute('data-track-count', '3');
		await expect(restored).toHaveAttribute('data-clip-count', '3');
		const restoredSecondTrack = restored.locator('[data-track-row]').nth(2);
		await expect(restoredSecondTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(restoredSecondTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await chooseCommandAction(page, restored, 'View', 'Enable multi-track recording');
		await expect(restoredSecondTrack.getByRole('button', { name: /^Arm for recording:/ })).toHaveAttribute('aria-pressed', 'true');
		expect(errors).toEqual([]);
	});

	test('splits stereo audio, traverses undo history, recombines it, and restores the result', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');

		await test.step('import and split a stereo clip into panned mono tracks', async () => {
			await importFiles(editor, [toneA]);
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Track channels', 'Split stereo to L/R mono']);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
			await expect(editor).toHaveAttribute('data-track-count', '3');
			await expect(editor).toHaveAttribute('data-clip-count', '2');
			await expect(trackNameText(editor).filter({ hasText: / — Left$/ })).toHaveCount(1);
			await expect(trackNameText(editor).filter({ hasText: / — Right$/ })).toHaveCount(1);
		});

		await test.step('undo and redo the complete channel rewrite', async () => {
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(trackNameText(editor).filter({ hasText: / — (?:Left|Right)$/ })).toHaveCount(0);

			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-track-count', '3');
			await expect(editor).toHaveAttribute('data-clip-count', '2');
		});

		await test.step('recombine the mono pair and persist the stereo project', async () => {
			await editor.locator('.audio-editor-track-controls').nth(1).click();
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Track channels', 'Make stereo track']);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(trackNameText(editor).filter({ hasText: / — Right$/ })).toHaveCount(0);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(trackNameText(editor).filter({ hasText: / — Right$/ })).toHaveCount(0);
		});

		expect(errors).toEqual([]);
	});

	test('opens an uppercase AUP3 project through the shared Audacity worker', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const fixture = await createAup3Fixture();

		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'Browser project.AUP3',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(fixture),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '1');
		await expect(trackNameText(editor).nth(0)).toHaveText('Fixture track');
		await expect(clipByName(editor, 'Audio 1')).toHaveCount(1);
		const clipDialog = await openClipProperties(page, editor, clipByName(editor, 'Audio 1'));
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('4');
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('opens an Audacity-created AUP4, saves it, and reopens the browser snapshot', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'audacity-native-rich.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(aup4NativeRichFixture()),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');

		await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'Export AUP4']);
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.aup4$/i);
		const snapshotPath = await download.path();
		expect(snapshotPath).toBeTruthy();
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: download.suggestedFilename(),
			mimeType: 'application/x-audacity-project',
			buffer: await readFile(snapshotPath),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');
		expect(errors).toEqual([]);
	});

	test('keeps an active missing AUP4 effect visible, bypassed, and ordered across save and reopen', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const fixture = await createAup4MissingEffectFixture();

		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'missing-superverb.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(fixture),
		});

		const compatibilitySummary = editor.locator('[data-aup4-compatibility-summary]');
		await expect(compatibilitySummary).toBeVisible({ timeout: 30_000 });
		await expect(compatibilitySummary).toContainText('AUP4 open: 0 converted, 1 missing, 0 omitted.');
		await expect(editor).toHaveAttribute('data-track-count', '1');

		let effectsPanel = await openEffectsForTrack(editor, 0);
		let rack = effectsPanel.locator('[data-effect-rack]');
		await expect(rack.locator('.effect-slot__name-text')).toHaveText([
			'Invert',
			'Missing: SuperVerb',
			'Echo',
		]);
		const missingEffect = rack.getByRole('group', { name: 'Missing: SuperVerb', exact: true });
		const selectMissingEffect = missingEffect.getByRole('button', { name: 'Select effect', exact: true });
		await selectMissingEffect.focus();
		await selectMissingEffect.press('Enter');
		const missingDialog = page.getByRole('dialog', { name: 'Missing: SuperVerb', exact: true });
		await expect(missingDialog.locator('[data-missing-effect]')).toContainText('Local playback bypasses it');
		await closeDialog(missingDialog);
		await closeEffectsPanel(effectsPanel);

		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'AUP4 Compatibility Report']);
		let reportDialog = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
		await expect(reportDialog.locator('[data-aup4-compatibility-report]')).toContainText('Missing: SuperVerb');
		await closeAup4CompatibilityReport(reportDialog);

		await compatibilitySummary.getByRole('button', { name: 'Dismiss compatibility summary', exact: true }).click();
		await expect(compatibilitySummary).toBeHidden();
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'AUP4 Compatibility Report']);
		reportDialog = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
		await expect(reportDialog.locator('[data-aup4-compatibility-report]')).toContainText('Missing: SuperVerb');
		await closeAup4CompatibilityReport(reportDialog);

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'Export AUP4']);
		const download = await downloadPromise;
		const snapshotPath = await download.path();
		expect(snapshotPath).toBeTruthy();
		await expect(compatibilitySummary).toBeVisible({ timeout: 30_000 });
		await expect(compatibilitySummary).toContainText('AUP4 export: 0 converted, 1 missing, 0 omitted.');

		await editor.locator('[data-aup4-input]').setInputFiles({
			name: download.suggestedFilename(),
			mimeType: 'application/x-audacity-project',
			buffer: await readFile(snapshotPath),
		});
		await expect(compatibilitySummary).toContainText('AUP4 open: 0 converted, 1 missing, 0 omitted.', { timeout: 30_000 });

		effectsPanel = await openEffectsForTrack(editor, 0);
		rack = effectsPanel.locator('[data-effect-rack]');
		await expect(rack.locator('.effect-slot__name-text')).toHaveText([
			'Invert',
			'Missing: SuperVerb',
			'Echo',
		]);
		await closeEffectsPanel(effectsPanel);
		expect(errors).toEqual([]);
	});
});
