/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const INSPECTOR = new URL('src/common/editor/ui/inspector/', ROOT);
const BAR = new URL('src/common/editor/ui/inspector/EffectPresetBar.jsx', ROOT);

// Audacity 4's EffectPresetsBar.qml is one row: the preset dropdown, then Save
// (a menu of Save / Save as…), Reset, Delete, and a three-dot menu of Import…
// and Export…. The rack shipped the row with none of those actions wired, and
// the export dialog stacked its own copies below the dropdown instead.
test('the preset bar wires every action Audacity puts beside the dropdown', async () => {
	const source = await readFile(BAR, 'utf8');

	for (const handler of ['onSavePreset', 'onUndo', 'canUndo', 'onDeletePreset', 'canDelete', 'onMoreOptions']) {
		assert.match(source, new RegExp(`${handler}=`, 'u'), `the bar must wire ${handler}`);
	}
	assert.match(source, /copy\.saveEffectPreset\b/u, 'the save menu offers Save');
	assert.match(source, /copy\.saveEffectPresetAs\b/u, 'the save menu offers Save as…');
	assert.match(source, /copy\.importEffectPreset\b/u, 'the options menu offers Import');
	assert.match(source, /copy\.exportEffectPreset\b/u, 'the options menu offers Export');
	assert.match(
		source,
		/canUndo=\{Boolean\(selectedId\) && unsaved/u,
		'Reset arms only for a preset edited away from its stored values, as upstream does',
	);
	assert.match(
		source,
		/canDelete=\{canOverwrite\}/u,
		'Delete is offered only for a stored preset',
	);
});

test('every preset surface renders the shared bar rather than its own controls', async () => {
	const surfaces = [
		'AudioEditorEffectsOverlay.jsx',
		'SelectionEffectsDialog.jsx',
		'ExportPresetSection.jsx',
	];
	for (const name of surfaces) {
		const source = await readFile(new URL(name, INSPECTOR), 'utf8');
		assert.match(source, /<EffectPresetBar\b/u, `${name} must render the shared preset bar`);
		assert.doesNotMatch(
			source,
			/audio-editor-effect-preset-drawer/u,
			`${name} must not reintroduce a drawer of preset actions below the dropdown`,
		);
	}

	// The bar owns the only preset file input, so no surface can grow a second
	// import control of its own.
	const owners: string[] = [];
	for (const name of await readdir(INSPECTOR)) {
		if (!/\.(?:jsx|tsx)$/u.test(name)) continue;
		const source = await readFile(new URL(name, INSPECTOR), 'utf8');
		if (/data-effect-preset-file|data-delivery-preset-file/u.test(source)) owners.push(name);
	}
	assert.deepEqual(owners, ['EffectPresetBar.jsx']);
});

test('the bar clears a half-typed name when its subject changes', async () => {
	const source = await readFile(BAR, 'utf8');
	const effect = source.slice(source.indexOf('useEffect(('), source.indexOf('}, [resetKey]);'));

	assert.match(effect, /setSaveAsName\(null\)/u, 'a pending name must not follow the next subject');
	assert.match(effect, /setSaveMenu\(null\)/u);
	assert.match(effect, /setOptionsMenu\(null\)/u);
});
