/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
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
		const records = { created: 0, configured: {} };
		globalThis.__standardEffectNodes = records;
		const NativeNode = globalThis.AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(NativeNode, {
			construct(Constructor, args) {
				const node = Reflect.construct(Constructor, args);
				if (args[1] === 'kw-standard-effect') {
					records.created += 1;
					const type = args[2].processorOptions.type;
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
	const input = dialog.locator(`[data-effect-param="${effect.parameter}"] input`);
	await commitInput(input, effect.value);
	await expect(input).toHaveValue(effect.value);
	if (effect.choice) {
		await chooseDropdown(page, dialog.getByRole('group', { name: effect.choice[0], exact: true }), effect.choice[1]);
	}
}

test.describe('regular effects converted from Nyquist', () => {
	registerAudioEditorHooks();

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
			await commitInput(dialog.locator(`[data-effect-param="${effect.parameter}"] input`), effect.value);
			const knob = dialog.locator(`[data-effect-param="${effect.parameter}"]`).getByRole('slider');
			await knob.press('ArrowUp');
			await expect.poll(() => page.evaluate(type => globalThis.__standardEffectNodes.configured[type] || 0,
				effect.type)).toBeGreaterThan(0);
			await commitInput(dialog.locator(`[data-effect-param="${effect.parameter}"] input`), effect.value);
			await closeDialog(dialog);
			await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			expect(await page.evaluate(() => globalThis.__standardEffectNodes.created)).toBe(created);
		}
		const tremolo = panel.locator('[data-effect-rack]').getByRole('group', { name: 'Tremolo', exact: true });
		await tremolo.getByRole('button', { name: 'Select effect', exact: true }).click();
		const liveSettings = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await commitInput(liveSettings.locator('[data-effect-param="depth"] input'), '80');
		await chooseDropdown(page, liveSettings.getByRole('group', { name: 'Waveform', exact: true }), 'Square');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		expect(await page.evaluate(() => globalThis.__standardEffectNodes.created)).toBe(created);
		await closeDialog(liveSettings);
		await closeEffectsPanel(panel);
		await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
		await editor.locator('[data-transport="stop"] button').click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		for (const effect of effects) {
			const slot = panel.locator('[data-effect-rack]').getByRole('group', { name: effect.name, exact: true });
			await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: effect.name, exact: true });
			await expect(dialog.locator(`[data-effect-param="${effect.parameter}"] input`)).toHaveValue(effect.type === 'tremolo' ? '80' : effect.value);
			if (effect.choice) {
				await expect(dialog.getByRole('group', { name: effect.choice[0], exact: true }).getByRole('button')).toContainText(effect.type === 'tremolo' ? 'Square' : effect.choice[1]);
			}
			await closeDialog(dialog);
		}
		expect(nyquistRequests).toEqual([]);
		expect(errors).toEqual([]);
	});
});
