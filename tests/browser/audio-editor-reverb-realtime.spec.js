/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	aup4NativeRichFixture, expect, initSqlJs, longTone, test, writeAup4Document,
} from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseDropdown, chooseFileAction,
	chooseNestedCommandAction, closeDialog, closeEffectsPanel, collectClientErrors,
	commitInput, disableNativeSavePicker, downloadBytes, importFiles,
	openEffectsForTrack, openExportDialog, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';
import {
	audacityXmlAttribute, audacityXmlChildren, createAudacityXmlNode,
	decodeAudacityBinaryXml, encodeAudacityBinaryXml,
} from '../../src/common/editor/audacity-binary-xml.js';
import { readAup4Document } from '../../src/common/editor/aup4-database.js';

const EFFECT_NAME = 'Reverb (Audacity)';
const NATIVE_ID = 'Effect_Audacity_Audacity_Reverb_Built-in Effect: Reverb';
// Literal captured names/values follow Audacity 4c177d436e48c1d20f231eada44035593cb26292
// src/effects/builtin_collection/reverb/reverbeffect.h. The surrounding project
// is Audacity's committed fixture; this is not a compiled native save assertion.
const NATIVE_PARAMETERS = [
	['RoomSize', '60'], ['Delay', '5'], ['Reverberance', '35'], ['HfDamping', '40'],
	['ToneLow', '50'], ['ToneHigh', '70'], ['WetGain', '-6'], ['DryGain', '-3'],
	['StereoWidth', '75'], ['WetOnly', '1'],
];
const CONTROL_LABELS = [
	'Room size', 'Pre-delay', 'Reverberance', 'Damping', 'Tone low', 'Tone high',
	'Wet gain', 'Dry gain', 'Stereo width',
];

function parameter(dialog, label) {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return dialog.getByRole('group', { name: new RegExp(`^${escaped}(?: \\(.*\\))?$`, 'u') });
}

async function openReverb(page, panel) {
	await panel.locator('[data-effect-rack]').getByRole('group', { name: EFFECT_NAME, exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: EFFECT_NAME, exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('Audacity Reverb realtime rack', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1600, height: 1000 } });

	test('adds Reverb through the existing rack menu, persists its controls, and renders wet audio', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', EFFECT_NAME);
		let dialog = page.getByRole('dialog', { name: EFFECT_NAME, exact: true });
		for (const label of CONTROL_LABELS) {
			await expect(parameter(dialog, label).getByRole('spinbutton')).toBeVisible();
			await expect(parameter(dialog, label).getByRole('spinbutton')).toBeEnabled();
		}
		const preset = dialog.getByRole('button', { name: 'Preset', exact: true });
		await preset.click();
		await page.getByRole('option', { name: 'Cathedral', exact: true }).click();
		await expect(preset).toContainText('Cathedral');
		await expect(parameter(dialog, 'Room size').getByRole('spinbutton')).toHaveValue('90');
		await expect(parameter(dialog, 'Tone high').getByRole('spinbutton')).toHaveValue('0');
		await commitInput(parameter(dialog, 'Room size').getByRole('spinbutton'), '80');
		await expect(preset).toContainText('*');
		await dialog.getByRole('checkbox', { name: 'Wet only', exact: true }).check();
		await expect(dialog.getByRole('checkbox', { name: 'Wet only', exact: true })).toBeChecked();
		await closeDialog(dialog);
		await closeEffectsPanel(panel);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		dialog = await openReverb(page, panel);
		await expect(parameter(dialog, 'Room size').getByRole('spinbutton')).toHaveValue('80');
		await expect(dialog.getByRole('checkbox', { name: 'Wet only', exact: true })).toBeChecked();
		await closeDialog(dialog);
		await closeEffectsPanel(panel);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const pause = editor.getByRole('button', { name: 'Pause', exact: true });
		await expect(pause).toBeVisible();
		await pause.click();
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = exportDialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const downloadPromise = page.waitForEvent('download');
		await link.click();
		const bytes = await downloadBytes(await downloadPromise);
		// Wet-only mutes the dry branch, so nonzero exported samples exercise the
		// Reverb processor in the offline worklet rather than only passing dry audio.
		expect(wavPeak(bytes)).toBeGreaterThan(0.0001);
		expect(errors).toEqual([]);
	});

	test('imports native realtime Reverb as editable, exports its native settings, and reopens without missing effects', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await openAup4(page, editor, await nativeReverbProject(), 'native-reverb.aup4');
		const panel = await openEffectsForTrack(editor, 0);
		await expect(panel.getByRole('group', { name: /^Missing:/u })).toHaveCount(0);
		let dialog = await openReverb(page, panel);
		for (const [index, label] of CONTROL_LABELS.entries()) {
			await expect(parameter(dialog, label).getByRole('spinbutton')).toHaveValue(NATIVE_PARAMETERS[index][1]);
		}
		await expect(dialog.getByRole('checkbox', { name: 'Wet only', exact: true })).toBeChecked();
		await commitInput(parameter(dialog, 'Room size').getByRole('spinbutton'), '80');
		await dialog.getByRole('checkbox', { name: 'Wet only', exact: true }).uncheck();
		await closeDialog(dialog);
		await closeEffectsPanel(panel);
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP4']);
		const download = await downloadPromise;
		const bytes = await downloadBytes(download);
		const exported = await nativeReverbParameters(bytes);
		expect(exported).toEqual(new Map(NATIVE_PARAMETERS.map(([name, value]) => [
			name, name === 'RoomSize' ? '80' : name === 'WetOnly' ? '0' : value,
		])));
		await openAup4(page, editor, bytes, download.suggestedFilename());
		const reopenedPanel = await openEffectsForTrack(editor, 0);
		await expect(reopenedPanel.getByRole('group', { name: /^Missing:/u })).toHaveCount(0);
		dialog = await openReverb(page, reopenedPanel);
		await expect(parameter(dialog, 'Room size').getByRole('spinbutton')).toHaveValue('80');
		await expect(dialog.getByRole('checkbox', { name: 'Wet only', exact: true })).not.toBeChecked();
		await closeDialog(dialog);
		await closeEffectsPanel(reopenedPanel);
		expect(errors).toEqual([]);
	});
});

async function openAup4(page, editor, bytes, name) {
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({
		name, mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes),
	});
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor.getByRole('region', { name: 'AUP4 Compatibility Report', exact: true })).toContainText('0 missing');
}

async function nativeReverbProject() {
	const SQL = await initSqlJs();
	const database = new SQL.Database(aup4NativeRichFixture());
	try {
		const document = readAup4Document(database);
		const root = decodeAudacityBinaryXml(document.dictionary, document.document).root;
		const track = audacityXmlChildren(root, 'wavetrack')[0];
		const rack = audacityXmlChildren(track, 'effects')[0];
		rack.content.push({ kind: 'node', node: createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'active', type: 'bool', value: true },
			{ kind: 'attribute', name: 'id', type: 'string', value: NATIVE_ID },
		], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], NATIVE_PARAMETERS.map(([name, value]) => ({
			kind: 'node', node: createAudacityXmlNode('parameter', [
				{ kind: 'attribute', name: 'name', type: 'string', value: name },
				{ kind: 'attribute', name: 'value', type: 'string', value },
			]),
		}))) }]) });
		writeAup4Document(database, encodeAudacityBinaryXml(root), { autosave: false, now: 0 });
		return Buffer.from(database.export());
	} finally {
		database.close();
	}
}

async function nativeReverbParameters(bytes) {
	const SQL = await initSqlJs();
	const database = new SQL.Database(bytes);
	try {
		const document = readAup4Document(database);
		const root = decodeAudacityBinaryXml(document.dictionary, document.document).root;
		const track = audacityXmlChildren(root, 'wavetrack')[0];
		const rack = audacityXmlChildren(track, 'effects')[0];
		const effect = audacityXmlChildren(rack, 'effect').find(node => audacityXmlAttribute(node, 'id', '') === NATIVE_ID);
		expect(effect).toBeDefined();
		const parameters = audacityXmlChildren(effect, 'parameters')[0];
		return new Map(audacityXmlChildren(parameters, 'parameter').map(node => [
			audacityXmlAttribute(node, 'name', ''), audacityXmlAttribute(node, 'value', ''),
		]));
	} finally {
		database.close();
	}
}

function wavPeak(bytes) {
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
}
