/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EFFECT_REGISTRY } from '@audacity-ui/core';
import { effectMacroStepTypes } from '../src/common/editor/effect-macro-steps.ts';
import { audioEffectTypes } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveSupportedEffectType, safeEffectLabel } from '../src/common/editor/ui/inspector/effect-helpers.ts';

const ROOT = new URL('../', import.meta.url);
const EFFECT_SLOT = new URL('vendor/audacity-design-system/components/src/EffectsPanel/EffectSlot.tsx', ROOT);
const EFFECTS_PANEL = new URL('vendor/audacity-design-system/components/src/EffectsPanel/EffectsPanel.tsx', ROOT);
// A macro step may be any effect, and continues to use the design-system
// fallback menu; the realtime rack delegates to the searchable host picker.
const CALL_SITES = [
	{
		path: 'src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx',
		registry: 'macroEffectTypes',
	},
];

test('the effect slot can delegate its settings button to a searchable host picker', async () => {
	const [slot, panel, overlay] = await Promise.all([
		readFile(EFFECT_SLOT, 'utf8'),
		readFile(EFFECTS_PANEL, 'utf8'),
		readFile(new URL('src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx', ROOT), 'utf8'),
	]);

	assert.match(slot, /if \(onOpenEffectPicker\)[\s\S]*onOpenEffectPicker\(e\.currentTarget\);[\s\S]*return;/u);
	assert.match(
		panel,
		/onOpenEffectPicker=\{onOpenEffectPicker\s*\? \(anchor\) => onOpenEffectPicker\(index, anchor\)\s*: undefined\}/u,
		'the wrapper must not shadow the design-system fallback when the host omits the hook',
	);
	assert.match(overlay, /onOpenEffectPicker: \(index, anchor\) => openPicker/u);
	assert.match(overlay, /onCopyEffect=\{picker\.replaceId/u);
	assert.match(overlay, /onRemoveEffect=\{picker\.replaceId/u);
	assert.match(overlay, /effectTypes=\{pickerEffect\?\.type === 'native-plugin' \? \[\] : null\}/u);
	assert.match(overlay, /onCopyEffect=\{picker\.replaceId && pickerEffect\?\.type !== 'native-plugin'/u);
});

test('the macro effect-slot fallback offers its whole Soundscaper registry', async () => {
	for (const { path, registry } of CALL_SITES) {
		const source = await readFile(new URL(path, ROOT), 'utf8');
		assert.match(
			source,
			new RegExp(`replaceEffectOptions\\s*=\\s*useMemo\\(\\s*\\n?\\s*\\(\\)\\s*=>\\s*${
				escapeRegExp(registry)
			}`, 'u'),
			`${path} must build the swap list from the effect registry`,
		);
		assert.match(
			source,
			/replaceEffectOptions(?:=\{replaceEffectOptions\}|,)/u,
			`${path} must pass the swap list down to the slot`,
		);
	}
});

test('every offered replacement resolves back to a real effect type', () => {
	const packaged = Object.values(EFFECT_REGISTRY).flat();
	const registries: ReadonlyArray<readonly [string, readonly string[]]> = [
		['rack', audioEffectTypes() as readonly string[]],
		['macro', effectMacroStepTypes()],
	];

	for (const [name, types] of registries) {
		assert.ok(types.length > packaged.length * 3, `the ${name} registry dwarfs the packaged sample set`);
		// A duplicate label would resolve to whichever effect is listed first,
		// silently swapping the step for a different effect.
		const labels = types.map((type) => safeEffectLabel(type, ENGLISH_COPY));
		assert.equal(new Set(labels).size, labels.length, `${name} labels must be unique`);
		for (const type of types) {
			assert.equal(
				resolveSupportedEffectType(safeEffectLabel(type, ENGLISH_COPY), 'en', ENGLISH_COPY, types),
				type,
				`the label the menu shows for ${type} must map back to it when picked`,
			);
		}
	}
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
