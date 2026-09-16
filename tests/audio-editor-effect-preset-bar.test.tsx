/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

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

// The bar tells a stored preset from a shipped one by the flag its options
// carry, and both effect surfaces used to hard-code every entry as stored.
test('the effect surfaces pass through whether a preset is the project\'s own', async () => {
	for (const name of ['AudioEditorEffectsOverlay.jsx', 'SelectionEffectsDialog.jsx']) {
		const source = await readFile(new URL(name, INSPECTOR), 'utf8');
		assert.doesNotMatch(source, /custom:\s*true/u, `${name} must not declare every preset stored`);
		assert.match(source, /effectPresetChoices\([^)]*copy\)/u, `${name} must localize preset names`);
	}
});

test('the bar clears a half-typed name when its subject changes', async () => {
	const source = await readFile(BAR, 'utf8');
	const effect = source.slice(source.indexOf('useEffect(('), source.indexOf('}, [resetKey]);'));

	assert.match(effect, /setSaveAsName\(null\)/u, 'a pending name must not follow the next subject');
	assert.match(effect, /setSaveMenu\(null\)/u);
	assert.match(effect, /setOptionsMenu\(null\)/u);
});

function renderBar(options: { defaultParams?: Record<string, unknown>; currentParams?: Record<string, unknown>; selectedId?: string; unsaved?: boolean } = {}): string {
	return renderToStaticMarkup(<ThemeProvider><EffectPresetBar
		copy={{ noEffectPreset: 'No preset', effectPresetCustom: 'custom' }}
		presets={[{ id: 'custom', label: 'My preset', custom: true }]}
		onSelect={() => undefined} onSave={() => undefined} onSaveAs={() => undefined}
		onReset={() => undefined} onDelete={() => undefined} onImport={() => undefined}
		onExport={() => undefined} onDefault={() => undefined}
		{...options}
	/></ThemeProvider>);
}

function resetDisabled(markup: string): boolean {
	const button = markup.match(/<button[^>]*aria-label="Undo"[^>]*>/u)?.[0];
	assert.ok(button);
	return /disabled=""/u.test(button);
}

test('Audacity default baseline displays Default preset and arms Reset only for edits', () => {
	const clean = renderBar({ defaultParams: { ratio: 10, thresholdDb: -10 }, currentParams: { thresholdDb: -10, ratio: 10 } });
	assert.match(clean, />Default preset</u);
	assert.doesNotMatch(clean, />Default preset\*</u);
	assert.equal(resetDisabled(clean), true);
	const edited = renderBar({ defaultParams: { ratio: 10, thresholdDb: -10 }, currentParams: { thresholdDb: -12, ratio: 10 } });
	assert.match(edited, />Default preset\*</u);
	assert.equal(resetDisabled(edited), false);
});

test('native preset bars keep the No preset baseline and named preset Reset behavior', () => {
	const empty = renderBar({ unsaved: true });
	assert.match(empty, />No preset</u);
	assert.equal(resetDisabled(empty), true);
	const edited = renderBar({ selectedId: 'custom', unsaved: true });
	assert.match(edited, />My preset \(custom\)\*</u);
	assert.equal(resetDisabled(edited), false);
	assert.equal(resetDisabled(renderBar({ selectedId: 'custom', unsaved: false })), true);
});

test('selecting a named preset retains its own edit state even when Audacity defaults are supplied', () => {
	const named = renderBar({
		selectedId: 'custom', unsaved: false,
		defaultParams: { ratio: 10 }, currentParams: { ratio: 4 },
	});
	assert.match(named, />My preset \(custom\)</u);
	assert.equal(resetDisabled(named), true);
});
