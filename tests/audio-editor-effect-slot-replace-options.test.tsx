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
// The rack swaps within what it can stream; a macro step may be any effect.
const CALL_SITES = [
	{
		path: 'src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx',
		registry: 'audioEffectTypes()',
	},
	{
		path: 'src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx',
		registry: 'macroEffectTypes',
	},
];

// The design-system package ships a three-effect sample registry. Rendering the
// slot's caret menu from it offered Compressor, Limiter and Reverb as the only
// replacements for any effect in a rack of forty-odd.
test('the effect slot takes its swap list from the host when one is supplied', async () => {
	const source = await readFile(EFFECT_SLOT, 'utf8');
	const menu = source.slice(source.indexOf('label="Remove effect"'));

	assert.match(
		menu,
		/\(replaceEffectOptions \?\? Object\.values\(EFFECT_REGISTRY\)\.flat\(\)\)/u,
		'a supplied list replaces the packaged registry outright rather than extending it',
	);
	assert.ok(
		menu.indexOf('label="Remove effect"') < menu.indexOf('onReplaceEffect?.('),
		'removal stays above the swap list',
	);
	assert.match(menu, /<ContextMenuItem isDivider \/>/u, 'a divider separates removal from the swap list');
});

test('both effect-slot call sites offer the whole Soundscaper registry', async () => {
	for (const { path, registry } of CALL_SITES) {
		const source = await readFile(new URL(path, ROOT), 'utf8');
		assert.match(
			source,
			new RegExp(`replaceEffectOptions\\s*=\\s*useMemo\\(\\s*\\n?\\s*\\(\\)\\s*=>\\s*${
				registry.replace(/[()]/gu, '\\$&')
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
