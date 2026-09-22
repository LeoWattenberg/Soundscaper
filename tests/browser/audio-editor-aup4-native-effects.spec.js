/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	aup4NativeRichFixture,
	expect,
	initSqlJs,
	test,
	writeAup4Document,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	closeAup4CompatibilityReport,
	closeDialog,
	closeEffectsPanel,
	closeWorkspacePanel,
	collectClientErrors,
	commitInput,
	openEffectsForTrack,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import {
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../../src/common/editor/audacity-binary-xml.js';
import { readAup4Document } from '../../src/common/editor/aup4-database.js';

// Parameter names/values independently follow the captured settings at pinned
// Audacity 4c177d436e48c1d20f231eada44035593cb26292. The project container is
// Audacity's committed testClipboard.aup4 with these XML rack records inserted;
// this exercises browser import, not a compiled Audacity save/reopen assertion.
const NATIVE_EFFECTS = [
	{
		name: 'Bass and Treble',
		symbol: 'Bass and Treble',
		parameters: [['Bass', '3'], ['Treble', '-2'], ['Gain', '1'], ['Link_Sliders', '1']],
		field: /^Bass(?:\s|$)/,
		value: '3',
		edit: '6',
	},
	{
		name: 'Distortion',
		symbol: 'Distortion',
		parameters: [
			['Type', 'Even Harmonics'], ['DC_Block', '1'], ['Threshold_dB', '-9'],
			['Noise_Floor', '-65'], ['Parameter_1', '25'], ['Parameter_2', '75'], ['Repeats', '2'],
		],
		field: /^Parameter 1(?:\s|$)/,
		value: '25',
		edit: '35',
	},
	{
		name: 'Noise Reduction',
		symbol: 'Noise reduction',
		parameters: [
			['Sensitivity', '7'], ['Frequency_Smoothing_Bands', '4'],
			['Noise_Gain', '12'], ['Noise_Reduction_Choice', '1'],
		],
		field: /^Noise reduction(?:\s|$)/,
		value: '12',
		edit: '18',
	},
];

test.describe('native AUP4 effect settings', () => {
	registerAudioEditorHooks();

	test('imports saved control metadata and normalized parameters as editable known effects', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({
			name: 'native-effect-settings.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: await nativeEffectProject(),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		const compatibility = editor.getByRole('region', { name: 'AUP4 Compatibility Report', exact: true });
		await expect(compatibility).toContainText('0 missing');
		await compatibility.getByRole('button', { name: 'View report', exact: true }).click();
		const report = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
		await expect(report).toBeVisible();
		await expect(report).not.toContainText('Missing:');
		await closeAup4CompatibilityReport(report);
		await closeWorkspacePanel(editor, 'project-bin');

		let panel = await openEffectsForTrack(editor, 0);
		await expect(panel.getByRole('group', { name: /^Missing:/ })).toHaveCount(0);
		for (const fixture of NATIVE_EFFECTS) {
			const slot = panel.getByRole('group', { name: fixture.name, exact: true });
			await expect(slot).toBeVisible();
			await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
			const settings = page.getByRole('dialog', { name: fixture.name, exact: true });
			const input = settings.getByRole('spinbutton', { name: fixture.field });
			await expect(input).toHaveValue(fixture.value);
			await expect(input).toBeEnabled();
			if (fixture.symbol === 'Distortion') {
				await expect(settings.getByRole('checkbox', { name: 'DC block', exact: true })).toBeChecked();
			}
			if (fixture.symbol === 'Noise reduction') {
				await expect(settings.getByRole('radio', { name: 'Noise only', exact: true })).toBeChecked();
			}
			await commitInput(input, fixture.edit);
			await expect(input).toHaveValue(fixture.edit);
			await closeDialog(settings);
		}
		await closeEffectsPanel(panel);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 0);
		await expect(panel.getByRole('group', { name: /^Missing:/ })).toHaveCount(0);
		for (const fixture of NATIVE_EFFECTS) {
			await panel.getByRole('group', { name: fixture.name, exact: true })
				.getByRole('button', { name: 'Select effect', exact: true }).click();
			const settings = page.getByRole('dialog', { name: fixture.name, exact: true });
			await expect(settings.getByRole('spinbutton', { name: fixture.field })).toHaveValue(fixture.edit);
			await closeDialog(settings);
		}
		await closeEffectsPanel(panel);
		expect(errors).toEqual([]);
	});
});

async function nativeEffectProject() {
	const SQL = await initSqlJs();
	const database = new SQL.Database(aup4NativeRichFixture());
	try {
		const document = readAup4Document(database);
		const root = decodeAudacityBinaryXml(document.dictionary, document.document).root;
		const track = audacityXmlChildren(root, 'wavetrack')[0];
		const rack = audacityXmlChildren(track, 'effects')[0];
		rack.content.push(...NATIVE_EFFECTS.map((fixture) => ({
			kind: 'node',
			node: createAudacityXmlNode('effect', [
				{ kind: 'attribute', name: 'active', type: 'bool', value: true },
				{
					kind: 'attribute', name: 'id', type: 'string',
					value: `Effect_Audacity_Audacity_${fixture.symbol}_Built-in Effect: ${fixture.symbol}`,
				},
			], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], fixture.parameters.map(([name, value]) => ({
				kind: 'node', node: createAudacityXmlNode('parameter', [
					{ kind: 'attribute', name: 'name', type: 'string', value: name },
					{ kind: 'attribute', name: 'value', type: 'string', value },
				]),
			}))) }]),
		})));
		writeAup4Document(database, encodeAudacityBinaryXml(root), {
			autosave: false, now: 0,
		});
		return Buffer.from(database.export());
	} finally {
		database.close();
	}
}
