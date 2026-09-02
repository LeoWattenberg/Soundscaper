import {
	expect,
	monoTone,
	readFile,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	clipByName,
	closeDialog,
	closeEffectsPanel,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	effectSourceMetadata,
	importFiles,
	openEffectsForTrack,
	openEffectStackMenu,
	openExportDialog,
	openParametricEqSelectionEffect,
	openRackPicker,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

	test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('offers only supported rack effects and persists track and master effects', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		let effectsPanel = await openEffectsForTrack(editor, 0);

		await openRackPicker(effectsPanel, 'track');
		const picker = page.getByRole('menu', { name: 'Choose an effect' });
		await expect(picker.getByRole('menuitem')).toHaveCount(22);
		await expect(picker.getByRole('menuitem', { name: 'Invert' })).toHaveCount(1);
		await expect(picker.getByRole('menuitem', { name: 'Paulstretch' })).toHaveCount(0);
		await picker.getByRole('menuitem', { name: 'Invert' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);

		await openRackPicker(effectsPanel, 'master');
		await page.getByRole('menu', { name: 'Choose an effect' }).getByRole('menuitem', { name: 'Bass and Treble' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' })).toHaveCount(1);
		const bassDialog = page.getByRole('dialog', { name: 'Bass and Treble', exact: true });
		const bassKnob = bassDialog.locator('[data-effect-param="bassDb"]').getByRole('slider', { name: /Bass \(dB\):/ });
		await expect(bassKnob).toBeVisible();
		const bassKnobBox = await bassKnob.boundingBox();
		expect(bassKnobBox).not.toBeNull();
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2 + 16, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.up();
		await expect.poll(async () => Number(await bassKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2 - 16, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.up();
		await expect.poll(async () => Number(await bassKnob.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(0);
		await commitInput(bassDialog.locator('[data-effect-param="bassDb"] input'), '7.5');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 0);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);
		const bassTreble = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' });
		await expect(bassTreble).toHaveCount(1);
		await bassTreble.getByRole('button', { name: 'Select effect' }).click();
		await expect(page.getByRole('dialog', { name: 'Bass and Treble', exact: true }).locator('[data-effect-param="bassDb"] input')).toHaveValue('7.5');
		expect(errors).toEqual([]);
	});

	test('renders an Audacity rack effect from the first offline quantum', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function'
			|| typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');
		await importFiles(editor, [toneA]);
		const effectsPanel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await closeEffectsPanel(effectsPanel);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const peak = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			let offset = 12;
			while (offset + 8 <= bytes.byteLength) {
				const id = new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
				const size = view.getUint32(offset + 4, true);
				if (id === 'data') {
					let maximum = 0;
					for (let sample = offset + 8; sample + 2 < offset + 8 + size; sample += 3) {
						let value = bytes[sample] | (bytes[sample + 1] << 8) | (bytes[sample + 2] << 16);
						if (value & 0x800000) value |= 0xff000000;
						maximum = Math.max(maximum, Math.abs(value / 0x800000));
					}
					return maximum;
				}
				offset += 8 + size + (size & 1);
			}
			return 0;
		});
		expect(peak).toBeGreaterThan(0.1);
		expect(errors).toEqual([]);
	});

	test('keeps rack knob updates live and ends Delay gestures when the window blurs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const effectsPanel = await openEffectsForTrack(editor, 0);

		await addRackEffect(page, effectsPanel, 'track', 'Reverb');
		const reverb = page.getByRole('dialog', { name: 'Reverb', exact: true });
		const decayInput = reverb.locator('[data-effect-param="decay"] input');
		await commitInput(decayInput, '3');
		await expect(decayInput).toHaveValue('3');
		const reverbMixInput = reverb.locator('[data-effect-param="mix"] input');
		const reverbMixKnob = reverb.locator('[data-effect-param="mix"]')
			.getByRole('slider', { name: /Mix:/ });
		const initialMix = await reverbMixInput.inputValue();
		const mixBox = await reverbMixKnob.boundingBox();
		expect(mixBox).not.toBeNull();
		await page.mouse.move(mixBox.x + mixBox.width / 2, mixBox.y + mixBox.height / 2);
		await page.mouse.down();
		try {
			await page.mouse.move(mixBox.x + mixBox.width / 2 + 20, mixBox.y + mixBox.height / 2);
			await expect.poll(() => reverbMixInput.inputValue()).not.toBe(initialMix);
		} finally {
			await page.mouse.up();
		}
		await closeDialog(reverb);

		await addRackEffect(page, effectsPanel, 'track', 'Delay');
		const delay = page.getByRole('dialog', { name: 'Delay', exact: true });
		const mixField = delay.locator('[data-effect-param="mix"]');
		const mixInput = mixField.locator('input');
		const mixKnob = mixField.getByRole('slider', { name: /Mix:/ });
		await commitInput(mixInput, '0');
		const dryBox = await mixKnob.boundingBox();
		expect(dryBox).not.toBeNull();
		await page.mouse.move(dryBox.x + dryBox.width / 2, dryBox.y + dryBox.height / 2);
		await page.mouse.down();
		try {
			await expect(mixKnob).toHaveClass(/knob--dragging/);
			await page.waitForTimeout(50);
			await page.mouse.move(
				dryBox.x + dryBox.width / 2,
				dryBox.y + dryBox.height / 2 - 24,
			);
			await expect.poll(async () => Number(await mixKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
			await expect.poll(() => mixInput.inputValue()).not.toBe('0');
		} finally {
			await page.mouse.up();
		}

		await commitInput(mixInput, '0.2');
		const liveBox = await mixKnob.boundingBox();
		expect(liveBox).not.toBeNull();
		await page.mouse.move(liveBox.x + liveBox.width / 2, liveBox.y + liveBox.height / 2);
		await page.mouse.down();
		await expect(mixKnob).toHaveClass(/knob--dragging/);
		await page.waitForTimeout(50);
		await page.mouse.move(
			liveBox.x + liveBox.width / 2,
			liveBox.y + liveBox.height / 2 - 20,
		);
		await expect(mixInput).toHaveValue('0.2');
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await expect(mixKnob).not.toHaveClass(/knob--dragging/);
		await expect.poll(() => mixInput.inputValue()).not.toBe('0.2');
		const committedMix = await mixInput.inputValue();
		await page.mouse.move(liveBox.x + liveBox.width / 2, liveBox.y + liveBox.height / 2 - 40);
		await expect.poll(() => mixInput.inputValue()).toBe(committedMix);
		await page.mouse.up();

		await closeDialog(delay);
		expect(errors).toEqual([]);
	});

	test('opens effects in a full-width dock and keeps effect settings open when the dock closes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		if (await projectBinPanel.isVisible()) {
			await projectBinPanel.locator('.kw-audio-editor__workspace-panel-close').click();
			await expect(projectBinPanel).toBeHidden();
		}
		const effectsPanel = await openEffectsForTrack(editor, 0);
		const rack = effectsPanel.locator('[data-effect-rack]');
		const packagePanel = rack.locator('.effects-panel');
		const sideDock = editor.locator('[data-panel-dock="right"]:has([data-workspace-panel="effects"])');
		const resizeHandle = sideDock.locator('[data-workspace-dock-resize-handle="right"]');

		await expect(editor.locator('[data-effects-overlay]')).toHaveCount(0);
		await expect(effectsPanel.locator('.kw-audio-editor__workspace-panel-header').getByText('Effects', { exact: true })).toBeVisible();
		await expect(packagePanel.locator('.effects-panel__header, .effects-panel-header')).toBeHidden();
		await expect(resizeHandle).toHaveCSS('cursor', 'ew-resize');
		await expect(resizeHandle).toHaveText('↔');
		await expect(resizeHandle).toHaveCSS('writing-mode', 'horizontal-tb');
		const initialDockBox = await sideDock.boundingBox();
		expect(initialDockBox).not.toBeNull();
		await page.mouse.move(initialDockBox.x + 2, initialDockBox.y + initialDockBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(initialDockBox.x - 46, initialDockBox.y + initialDockBox.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await sideDock.boundingBox())?.width || 0).toBeGreaterThan(initialDockBox.width + 30);
		await effectsPanel.locator('[data-workspace-panel-dock-picker="effects"]').selectOption('left');
		const leftDock = editor.locator('[data-panel-dock="left"]:has([data-workspace-panel="effects"])');
		const leftResizeHandle = leftDock.locator('[data-workspace-dock-resize-handle="left"]');
		await expect(leftResizeHandle).toHaveCSS('cursor', 'ew-resize');
		await expect(leftResizeHandle).toHaveText('↔');
		await expect(leftResizeHandle).toHaveCSS('writing-mode', 'horizontal-tb');
		const initialLeftDockBox = await leftDock.boundingBox();
		expect(initialLeftDockBox).not.toBeNull();
		await leftResizeHandle.press('ArrowLeft');
		await expect.poll(async () => (await leftDock.boundingBox())?.width || 0).toBeLessThan(initialLeftDockBox.width);
		const shrunkenLeftDockBox = await leftDock.boundingBox();
		expect(shrunkenLeftDockBox).not.toBeNull();
		await page.mouse.move(
			shrunkenLeftDockBox.x + shrunkenLeftDockBox.width - 2,
			shrunkenLeftDockBox.y + shrunkenLeftDockBox.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			shrunkenLeftDockBox.x + shrunkenLeftDockBox.width + 30,
			shrunkenLeftDockBox.y + shrunkenLeftDockBox.height / 2,
			{ steps: 4 },
		);
		await page.mouse.up();
		await expect.poll(async () => (await leftDock.boundingBox())?.width || 0).toBeGreaterThan(shrunkenLeftDockBox.width + 20);
		await expect.poll(async () => {
			const [rackBox, panelBox] = await Promise.all([rack.boundingBox(), packagePanel.boundingBox()]);
			return rackBox && panelBox ? Math.abs(rackBox.width - panelBox.width) : Number.POSITIVE_INFINITY;
		}).toBeLessThanOrEqual(1);

		const masterSection = packagePanel.locator('.effects-panel__content > .effects-panel__master-section');
		await expect(masterSection).toBeVisible();
		await expect.poll(async () => {
			const [panelBox, masterBox] = await Promise.all([packagePanel.boundingBox(), masterSection.boundingBox()]);
			return panelBox && masterBox ? masterBox.y - panelBox.y : 0;
		}).toBeGreaterThan(120);

		await addRackEffect(page, effectsPanel, 'track', 'Reverb');
		const settings = page.getByRole('dialog', { name: 'Reverb', exact: true });
		await expect(settings).toBeVisible();
		await closeEffectsPanel(effectsPanel);
		await expect(settings).toBeVisible();
		await closeDialog(settings);
		expect(errors).toEqual([]);
	});

	test('edits and restores a parametric EQ rack through its graph controls', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let effectsPanel = await openEffectsForTrack(editor, 1);

		await openRackPicker(effectsPanel, 'track');
		const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
		const eqOption = picker.getByRole('menuitem', { name: /parametric EQ/i }).first();
		await expect(eqOption).toBeVisible();
		await eqOption.click();

		let eq = page.locator('[data-parametric-eq]');
		await expect(eq).toBeVisible();
		let handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(4);
		await eq.getByRole('button', { name: 'Add band', exact: true }).click();
		await expect(handles).toHaveCount(5);
		await expect(handles.nth(4)).toHaveAttribute('data-selected', 'true');

		let eqDialog = eq.locator('xpath=ancestor::*[@role="dialog"]').first();
		await closeDialog(eqDialog);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		let rackEq = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: /parametric EQ/i });
		await rackEq.getByRole('button', { name: 'Select effect', exact: true }).click();
		eq = page.locator('[data-parametric-eq]');
		handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(4);
		eqDialog = eq.locator('xpath=ancestor::*[@role="dialog"]').first();
		await closeDialog(eqDialog);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		rackEq = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: /parametric EQ/i });
		await rackEq.getByRole('button', { name: 'Select effect', exact: true }).click();
		eq = page.locator('[data-parametric-eq]');
		handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(5);

		await handles.nth(4).click();
		const selectedBand = eq.getByRole('region', { name: 'Selected band', exact: true });
		await commitInput(selectedBand.getByLabel('Frequency (Hz)', { exact: true }), '3200');
		await commitInput(selectedBand.getByLabel('Gain (dB)', { exact: true }), '4.5');
		await commitInput(selectedBand.getByLabel('Q', { exact: true }), '1.75');
		await selectedBand.locator('select').first().selectOption('lowshelf');
		await commitInput(eq.locator('.audio-editor-parametric-eq__output input[type="number"]'), '-2.5');
		await expect(selectedBand.locator('select').first()).toHaveValue('lowshelf');
		await expect(selectedBand.getByLabel('Frequency (Hz)', { exact: true })).toHaveValue('3200');
		await expect(selectedBand.getByLabel('Gain (dB)', { exact: true })).toHaveValue('4.5');
		await expect(eq.locator('.audio-editor-parametric-eq__output input[type="number"]')).toHaveValue('-2.5');

		const settingsDialog = eq.locator('xpath=ancestor::*[@role="dialog"]').first();
		await closeDialog(settingsDialog);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();

		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 1);
		rackEq = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: /parametric EQ/i });
		await expect(rackEq).toHaveCount(1);
		await rackEq.getByRole('button', { name: 'Select effect', exact: true }).click();
		eq = page.locator('[data-parametric-eq]');
		await expect(eq.locator('.audio-editor-parametric-eq__handle')).toHaveCount(5);
		await eq.locator('.audio-editor-parametric-eq__handle').nth(4).click();
		const restoredBand = eq.getByRole('region', { name: 'Selected band', exact: true });
		await expect(restoredBand.locator('select').first()).toHaveValue('lowshelf');
		await expect(restoredBand.getByLabel('Frequency (Hz)', { exact: true })).toHaveValue('3200');
		await expect(restoredBand.getByLabel('Gain (dB)', { exact: true })).toHaveValue('4.5');
		await expect(eq.locator('.audio-editor-parametric-eq__output input[type="number"]')).toHaveValue('-2.5');
		await closeDialog(eq.locator('xpath=ancestor::*[@role="dialog"]').first());
		await restored.getByRole('button', { name: 'Play', exact: true }).click();
		const pause = restored.getByRole('button', { name: 'Pause', exact: true });
		await expect(pause).toBeVisible();
		await pause.click();

		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function' || typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');
		const exportDialog = await openExportDialog(page, restored);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 15_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/);
		expect(errors).toEqual([]);
	});

	test('copies an ordered effect stack between tracks and exports it as an Audacity macro', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		let effectsPanel = await openEffectsForTrack(editor, 1);

		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await addRackEffect(page, effectsPanel, 'track', 'Echo');
		const echoSettings = page.getByRole('dialog', { name: 'Echo', exact: true });
		await expect(echoSettings).toBeVisible();
		await commitInput(echoSettings.locator('[data-effect-param="delaySeconds"] input'), '0.75');
		await closeDialog(echoSettings);

		const sourceRack = effectsPanel.locator('[data-effect-rack]');
		const sourceStackTrigger = sourceRack.getByRole('button', { name: 'Effect stack options', exact: true }).first();
		await expect(sourceRack.getByRole('button', { name: 'Effect stack options', exact: true })).toHaveCount(2);
		let stackMenu = await openEffectStackMenu(effectsPanel, 'track');
		await expect(stackMenu.getByRole('menuitem', { name: 'Copy effects', exact: true })).toBeVisible();
		await expect(stackMenu.getByRole('menuitem', { name: 'Paste effects', exact: true })).toHaveAttribute('aria-disabled', 'true');
		await expect(stackMenu.getByRole('menuitem', { name: 'Export as macro', exact: true })).toBeVisible();
		await stackMenu.getByRole('menuitem', { name: 'Copy effects', exact: true }).click();
		await expect(sourceStackTrigger).toBeFocused();

		await closeEffectsPanel(effectsPanel);
		effectsPanel = await openEffectsForTrack(editor, 2);
		const targetStackTrigger = effectsPanel.locator('[data-effect-rack]')
			.getByRole('button', { name: 'Effect stack options', exact: true }).first();
		stackMenu = await openEffectStackMenu(effectsPanel, 'track');
		const paste = stackMenu.getByRole('menuitem', { name: 'Paste effects', exact: true });
		await expect(paste).toHaveAttribute('aria-disabled', 'false');
		await paste.click();
		await expect(targetStackTrigger).toBeFocused();

		const targetRack = effectsPanel.locator('[data-effect-rack]');
		await expect(targetRack.locator('.effect-slot__name-text')).toHaveText(['Invert', 'Echo']);
		await targetRack.getByRole('group', { name: 'Echo', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const pastedEchoSettings = page.getByRole('dialog', { name: 'Echo', exact: true });
		await expect(pastedEchoSettings.locator('[data-effect-param="delaySeconds"] input')).toHaveValue('0.75');
		await closeDialog(pastedEchoSettings);

		stackMenu = await openEffectStackMenu(effectsPanel, 'track');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			stackMenu.getByRole('menuitem', { name: 'Export as macro', exact: true }).click(),
		]);
		expect(download.suggestedFilename()).toMatch(/browser-tone-b.*\.txt$/i);
		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		await expect.poll(async () => readFile(downloadPath, 'utf8')).toBe(
			'Invert:\nEcho:Delay="0.75" Decay="0.5"\n',
		);
		expect(errors).toEqual([]);
	});

	test('manages Audacity effect macros with add, file, and run actions in the footer', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Tools', 'Manage macros');

		let manager = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		await expect(manager).toBeVisible();
		await expect(page.locator('[data-editor-surface="macro-manager"]')).toBeVisible();
		const footer = manager.locator('.audio-editor-macro-manager__footer');
		await expect(footer.getByRole('button', { name: 'Effects', exact: true })).toBeVisible();
		await expect(footer.getByRole('button', { name: 'Import macro', exact: true }).locator('.icon[aria-hidden="true"]')).toHaveCount(1);
		await expect(footer.getByRole('button', { name: 'Export macro', exact: true }).locator('.icon[aria-hidden="true"]')).toHaveCount(1);
		await expect(footer.getByRole('button', { name: 'Run macro', exact: true })).toBeVisible();
		await expect(manager.locator('.audio-editor-controlled-dialog__body').getByRole('button', { name: 'Effects', exact: true })).toHaveCount(0);

		await footer.getByRole('button', { name: 'Effects', exact: true }).click();
		const picker = page.getByRole('dialog', { name: 'Choose an effect', exact: true });
		await chooseDropdown(page, picker.locator('[data-effect-type]'), 'Invert');
		await picker.getByRole('button', { name: 'Add effect', exact: true }).click();
		manager = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		await expect(manager.locator('[data-macro-effect-stack]').getByRole('group', { name: 'Invert', exact: true })).toBeVisible();
		await expect(manager.getByRole('button', { name: 'Disable effect', exact: true })).toHaveCount(0);

		await manager.locator('input[type="file"]').setInputFiles({
			name: 'browser-chain.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('Echo:Delay="0.4" Decay="0.65"\nInvert:\n'),
		});
		await expect(manager.getByRole('status')).toHaveText('Macro imported.');
		await expect(manager.getByLabel('Macro name', { exact: true })).toHaveValue('browser-chain');
		await expect(manager.locator('.effect-slot__name-text')).toHaveText(['Echo', 'Invert']);
		await manager.getByLabel('Macro name', { exact: true }).focus();
		await page.keyboard.press('Tab');
		await expect(manager.getByRole('group', { name: 'Echo', exact: true })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(manager.getByRole('group', { name: 'Invert', exact: true })).toBeFocused();

		await manager.locator('input[type="file"]').setInputFiles({
			name: 'oversized-chain.txt',
			mimeType: 'text/plain',
			buffer: Buffer.alloc((1024 * 1024) + 1, 0x49),
		});
		await expect(manager.getByRole('alert')).toContainText('The macro could not be imported:');
		await expect(manager.locator('.effect-slot__name-text')).toHaveText(['Echo', 'Invert']);

		await manager.getByRole('group', { name: 'Echo', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const echoSettings = page.getByRole('dialog', { name: 'Echo', exact: true });
		const delayInput = echoSettings.locator('[data-effect-param="delaySeconds"] input');
		await commitInput(delayInput, '0.75');
		await closeDialog(echoSettings);

		// Reopen once and wait on the controlled value. Repeated reopen/close cycles
		// can race the pending React publication and hide whether the commit settled.
		const macros = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		await macros.getByRole('group', { name: 'Echo', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const echoCommitted = page.getByRole('dialog', { name: 'Echo', exact: true });
		await expect(echoCommitted.locator('[data-effect-param="delaySeconds"] input')).toHaveValue('0.75');
		await closeDialog(echoCommitted);

		manager = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		// Export serialises the stored macro name, and the rename only reaches the
		// store on blur, so a bare fill() leaves Export writing the imported name.
		await commitInput(manager.getByLabel('Macro name', { exact: true }), 'Browser chain');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			manager.getByRole('button', { name: 'Export macro', exact: true }).click(),
		]);
		expect(download.suggestedFilename()).toBe('Browser-chain.txt');
		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		await expect.poll(async () => readFile(downloadPath, 'utf8')).toBe(
			'Echo:Delay="0.75" Decay="0.65"\nInvert:\n',
		);

		const runButton = manager.getByRole('button', { name: 'Run macro', exact: true });
		await runButton.click();
		await expect(runButton).toBeDisabled();
		await expect(manager.getByRole('status')).toHaveText('Macro applied.', { timeout: 20_000 });
		await expect(clipByName(editor, 'browser-tone-a')).toBeVisible();
		await expect.poll(async () => (
			(await effectSourceMetadata(page)).some((source) => source.name.includes('Browser chain'))
		)).toBe(true);
		await closeDialog(manager);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('captures and restores a rack Noise Reduction profile', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let effectsPanel = await openEffectsForTrack(editor, 1);
		await openRackPicker(effectsPanel, 'track');
		await page.getByRole('menu', { name: 'Choose an effect' }).getByRole('menuitem', { name: 'Noise Reduction' }).click();

		const reduction = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' });
		await expect(reduction.getByRole('button', { name: 'Enable effect' })).toBeVisible();
		const settingsDialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
		await settingsDialog.locator('[data-effect-noise-profile]').getByRole('button').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(reduction.getByRole('button', { name: 'Disable effect' })).toBeVisible();
		await expect(settingsDialog.locator('[data-effect-noise-profile]')).toContainText('Replace noise profile');
		await closeDialog(settingsDialog);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 1);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' })).toContainText('Noise Reduction');
		expect(errors).toEqual([]);
	});

	test('directly applies a setting-free Audacity selection effect with undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);

		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
		await expect(page.getByRole('dialog', { name: 'Apply effect', exact: true })).toHaveCount(0);
		await expect(page.locator('[data-editor-surface="selection-effect"]')).toHaveCount(0);
		await expect(clipByName(editor, 'browser-tone-a')).toBeVisible();
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(2);
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo' }).click();
		await expect(clipByName(editor, 'browser-tone-a')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('offers and destructively applies the parametric EQ from the selection Effect menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		const effectDialog = await openParametricEqSelectionEffect(page, editor);
		const eq = effectDialog.locator('[data-parametric-eq]');
		await expect(eq).toBeVisible();
		await expect(eq.locator('.audio-editor-parametric-eq__handle')).toHaveCount(4);
		await commitInput(eq.locator('.audio-editor-parametric-eq__output input[type="number"]'), '-6');
		await expect(eq.locator('.audio-editor-parametric-eq__output input[type="number"]')).toHaveValue('-6');
		await effectDialog.getByRole('button', { name: 'Preview', exact: true }).click();
		const stopPreview = effectDialog.getByRole('button', { name: 'Stop preview', exact: true });
		await expect(stopPreview).toBeVisible();
		await stopPreview.click();
		await expect(effectDialog.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
		await effectDialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();

		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect(clipByName(editor, 'Audio clip')).toBeVisible();
		await expect.poll(async () => (
			(await effectSourceMetadata(page)).some((source) => /parametric EQ/i.test(source.name || ''))
		)).toBe(true);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});
});
