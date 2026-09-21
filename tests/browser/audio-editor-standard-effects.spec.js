/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup3Fixture, createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, chooseFileAction, chooseNestedCommandAction,
	clipByName, closeDialog, closeEffectsPanel, collectClientErrors, commitInput,
	effectSourceMetadata, importFiles, openEffectsForTrack, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

const effects = [
	{ type: 'multi-tap-delay', name: 'Delay', category: 'Delay and reverb', parameter: 'time', value: '0.1', choice: ['Delay type', 'Bouncing ball'] },
	{ type: 'highpass-filter', name: 'High-pass filter', category: 'EQ and filters', parameter: 'frequency', value: '700', choice: ['Rolloff', '24 dB/octave'] },
	{ type: 'lowpass-filter', name: 'Low-pass filter', category: 'EQ and filters', parameter: 'frequency', value: '700', choice: ['Rolloff', '24 dB/octave'] },
	{ type: 'noise-gate', name: 'Noise gate', category: 'Noise removal and repair', parameter: 'threshold', value: '-30', choice: ['Stereo linking', 'Independent channels'] },
	{ type: 'notch-filter', name: 'Notch filter', category: 'EQ and filters', parameter: 'frequency', value: '330' },
	{ type: 'shelf-filter', name: 'Shelf filter', category: 'EQ and filters', parameter: 'gain', value: '-12', choice: ['Filter type', 'High shelf'] },
	{ type: 'tremolo', name: 'Tremolo', category: 'Distortion and modulation', parameter: 'depth', value: '70', choice: ['Waveform', 'Triangle'] },
	{ type: 'vocoder', name: 'Vocoder', category: 'Distortion and modulation', parameter: 'bands', value: '20', choice: ['Output', 'Vocoded audio'] },
];

function collectNyquistRequests(page) {
	const requests = [];
	page.on('request', (request) => {
		if (/\.ny(?:\?|$)|nyquist[^/]*\.wasm(?:\?|$)/iu.test(request.url())) requests.push(request.url());
	});
	return requests;
}

async function recordStandardEffectNodes(page) {
	await page.addInitScript(() => {
		const records = { created: 0, configured: {}, staffPadDelays: 0 };
		globalThis.__standardEffectNodes = records;
		const NativeNode = globalThis.AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(NativeNode, {
			construct(Constructor, args) {
				const node = Reflect.construct(Constructor, args);
				if (args[1] === 'kw-standard-effect') {
					records.created += 1;
					const type = args[2].processorOptions.type;
					if (type === 'multi-tap-delay' && args[2].processorOptions.staffPadWasmModule instanceof WebAssembly.Module) records.staffPadDelays += 1;
					const post = node.port.postMessage.bind(node.port);
					node.port.postMessage = (...messages) => {
						if (messages[0]?.type === 'configure') {
							records.configured[type] = (records.configured[type] || 0) + 1;
						}
						return post(...messages);
					};
				}
				return node;
			},
		});
	});
}

async function configureEffect(page, dialog, effect) {
	await expect(dialog.locator(`[data-audacity-effect-layout="${effect.type}"]`)).toBeVisible();
	const input = dialog.locator(`[data-effect-param="${effect.parameter}"]`).getByRole('spinbutton');
	await commitInput(input, effect.value);
	await expect(input).toHaveValue(effect.value);
	if (effect.choice) {
		await chooseDropdown(page, dialog.getByRole('group', { name: effect.choice[0], exact: true }), effect.choice[1]);
	}
}

test.describe('regular effects converted from Nyquist', () => {
	registerAudioEditorHooks();

	for (const sampleRate of [8000, 96000]) {
		test(`filter cutoff controls follow the ${sampleRate} Hz project Nyquist limit`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			const samples = Array.from({ length: Math.round(sampleRate * .2) }, (_, frame) => .3 * Math.sin(2 * Math.PI * 330 * frame / sampleRate));
			const bytes = await createAup3Fixture({ sampleRate, tracks: [{ name: 'Filter limits', clips: [{ samples }] }] });
			const chooser = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Open');
			await (await chooser).setFiles({ name: 'Filter limits.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
			await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30000 });
			const maximum = String(sampleRate / 2 - .1);
			for (const name of ['High-pass filter', 'Low-pass filter', 'Notch filter']) {
				await chooseCommandAction(page, editor, 'Select', 'Select all');
				await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', name]);
				const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
				const label = name === 'Notch filter' ? 'Notch frequency' : 'Cutoff frequency';
				const control = dialog.getByRole('group', { name: label, exact: true });
				await expect(control.getByRole('slider')).toHaveCount(0);
				const before = await control.getByRole('spinbutton', { name: label, exact: true }).inputValue();
				await commitInput(control.getByRole('spinbutton', { name: label, exact: true }), String(sampleRate / 2));
				await closeDialog(dialog);
				await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', name]);
				await expect(control.getByRole('spinbutton', { name: label, exact: true })).toHaveValue(before);
				await commitInput(control.getByRole('spinbutton', { name: label, exact: true }), maximum);
				await expect(control.getByRole('spinbutton', { name: label, exact: true })).toHaveValue(maximum);
				await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
				await expect(dialog).toBeHidden({ timeout: 20000 });
				await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
				await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			}
			expect(errors).toEqual([]);
		});
	}

	for (const effect of effects) {
		test(`applies ${effect.name} through its regular Effect menu without Nyquist`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const nyquistRequests = collectNyquistRequests(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [toneA]);
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Effect', [effect.category, effect.name]);
			const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			await configureEffect(page, dialog, effect);
			await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			await expect(dialog).toBeHidden({ timeout: 20_000 });
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			await expect.poll(async () => (await effectSourceMetadata(page))
				.some(source => source.name.toLowerCase().includes(effect.name.toLowerCase()))).toBe(true);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(clipByName(editor, toneA.name)).toHaveCount(1);
			expect(nyquistRequests).toEqual([]);
			expect(errors).toEqual([]);
		});
	}

	test('Delay changes echo speed and retains complete echoes through the Effect menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const nyquistRequests = collectNyquistRequests(page);
		const editor = await bootEditor(page, '/embed/en/');
		const sampleRate = 48000;
		const duration = .5;
		const tone = createWavFixture({ name: 'complete-speed-echo.wav', frequency: 440, duration, sampleRate });
		await importFiles(editor, [tone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Delay']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await commitInput(dialog.getByRole('spinbutton', { name: 'Delay time', exact: true }), '.05');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Number of echoes', exact: true }), '1');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Pitch shift per echo', exact: true }), '-2');
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Pitch change effect', exact: true }), 'Pitch/Tempo (change speed)');
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Echo duration', exact: true }), 'Include complete echoes');
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		const expectedFrames = Math.round(duration * sampleRate * 2 ** (2 / 12)) + Math.round(.05 * sampleRate);
		await expect.poll(async () => (await effectSourceMetadata(page)).find(source => source.name.includes('Delay'))?.frameCount).toBe(expectedFrames);
		expect(expectedFrames).toBeGreaterThan(duration * sampleRate);
		expect(nyquistRequests).toEqual([]);
		expect(errors).toEqual([]);
	});

	test('changing realtime gate lookahead keeps playback running and restores the setting', async ({ page }) => {
		await recordStandardEffectNodes(page);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'live-gate-lookahead.wav', frequency: 440, duration: 30 })]);
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Noise gate');
		await closeDialog(page.getByRole('dialog', { name: 'Noise gate', exact: true }));
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		const created = await page.evaluate(() => globalThis.__standardEffectNodes.created);
		const slot = panel.getByRole('group', { name: 'Noise gate', exact: true });
		await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Noise gate', exact: true });
		await dialog.getByRole('button', { name: 'More options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Advanced settings', exact: true }).click();
		await commitInput(dialog.getByRole('spinbutton', { name: 'Lookahead', exact: true }), '0.03');
		await expect(dialog.getByRole('spinbutton', { name: 'Lookahead', exact: true })).toHaveValue('0.03');
		await expect.poll(() => page.evaluate(() => globalThis.__standardEffectNodes.created)).toBeGreaterThan(created);
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await closeDialog(dialog);
		await editor.locator('[data-transport="stop"] button').click();
		await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		await panel.getByRole('group', { name: 'Noise gate', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		await page.getByRole('dialog', { name: 'Noise gate', exact: true }).getByRole('button', { name: 'More options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Advanced settings', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Noise gate', exact: true }).getByRole('spinbutton', { name: 'Lookahead', exact: true })).toHaveValue('0.03');
		expect(errors).toEqual([]);
	});

	test('pitched realtime Delay loads StaffPad and keeps playing through live pitch changes', async ({ page }) => {
		await recordStandardEffectNodes(page);
		const errors = collectClientErrors(page);
		const nyquistRequests = collectNyquistRequests(page);
		const staffPadRequests = [];
		page.on('request', request => {
			if (/staffpad[^/]*\.wasm(?:\?|$)/iu.test(request.url())) staffPadRequests.push(request.url());
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'live-pitched-delay.wav', frequency: 440, duration: 30 })]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Delay');
		let dialog = page.getByRole('dialog', { name: 'Delay', exact: true });
		await commitInput(dialog.getByRole('spinbutton', { name: 'Number of echoes', exact: true }), '1');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Delay time', exact: true }), '.05');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Pitch shift per echo', exact: true }), '-2');
		await closeDialog(dialog);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 20000 });
		await expect.poll(() => page.evaluate(() => globalThis.__standardEffectNodes.staffPadDelays)).toBeGreaterThan(0);
		expect(staffPadRequests.length).toBeGreaterThan(0);
		const created = await page.evaluate(() => globalThis.__standardEffectNodes.created);
		await panel.getByRole('group', { name: 'Delay', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Delay', exact: true });
		await commitInput(dialog.getByRole('spinbutton', { name: 'Pitch shift per echo', exact: true }), '1');
		await expect(dialog.getByRole('spinbutton', { name: 'Pitch shift per echo', exact: true })).toHaveValue('1');
		await expect.poll(() => page.evaluate(() => globalThis.__standardEffectNodes.created)).toBeGreaterThan(created);
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await closeDialog(dialog);
		await editor.locator('[data-transport="stop"] button').click();
		await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		expect(nyquistRequests).toEqual([]);
		expect(errors).toEqual([]);
	});

	test('edits and restores every converted effect in a realtime track rack', async ({ page }) => {
		test.setTimeout(120_000);
		await recordStandardEffectNodes(page);
		const errors = collectClientErrors(page);
		const nyquistRequests = collectNyquistRequests(page);
		let editor = await bootEditor(page, '/embed/en/');
		const liveTone = createWavFixture({ name: 'standard-live.wav', frequency: 440, duration: 90 });
		await importFiles(editor, [liveTone]);
		let panel = await openEffectsForTrack(editor, 1);
		for (const effect of effects) {
			await addRackEffect(page, panel, 'track', effect.name);
			const dialog = page.getByRole('dialog', { name: effect.name, exact: true });
			await configureEffect(page, dialog, effect);
			await closeDialog(dialog);
		}
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		const created = await page.evaluate(() => globalThis.__standardEffectNodes.created);
		expect(created).toBeGreaterThanOrEqual(effects.length);
		for (const effect of effects) {
			const slot = panel.locator('[data-effect-rack]').getByRole('group', { name: effect.name, exact: true });
			await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: effect.name, exact: true });
			const number = dialog.locator(`[data-effect-param="${effect.parameter}"]`).getByRole('spinbutton');
			await commitInput(number, effect.value);
			const slider = dialog.locator(`[data-effect-param="${effect.parameter}"]`).getByRole('slider');
			if (await slider.count()) await slider.press('ArrowUp');
			else await commitInput(number, String(Number(effect.value) + 1));
			await expect.poll(() => page.evaluate(type => globalThis.__standardEffectNodes.configured[type] || 0,
				effect.type)).toBeGreaterThan(0);
			await commitInput(number, effect.value);
			await closeDialog(dialog);
			await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			expect(await page.evaluate(() => globalThis.__standardEffectNodes.created)).toBe(created);
		}
		const tremolo = panel.locator('[data-effect-rack]').getByRole('group', { name: 'Tremolo', exact: true });
		await tremolo.getByRole('button', { name: 'Select effect', exact: true }).click();
		const liveSettings = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await commitInput(liveSettings.locator('[data-effect-param="depth"]').getByRole('spinbutton'), '80');
		await chooseDropdown(page, liveSettings.getByRole('group', { name: 'Waveform', exact: true }), 'Square');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		expect(await page.evaluate(() => globalThis.__standardEffectNodes.created)).toBe(created);
		await closeDialog(liveSettings);
		await closeEffectsPanel(panel);
		await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		await editor.locator('[data-transport="stop"] button').click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		for (const effect of effects) {
			const slot = panel.locator('[data-effect-rack]').getByRole('group', { name: effect.name, exact: true });
			await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: effect.name, exact: true });
			await expect(dialog.locator(`[data-effect-param="${effect.parameter}"]`).getByRole('spinbutton')).toHaveValue(effect.type === 'tremolo' ? '80' : effect.value);
			if (effect.choice) {
				await expect(dialog.getByRole('group', { name: effect.choice[0], exact: true }).getByRole('button')).toContainText(effect.type === 'tremolo' ? 'Square' : effect.choice[1]);
			}
			await closeDialog(dialog);
		}
		expect(nyquistRequests).toEqual([]);
		expect(errors).toEqual([]);
	});
});
