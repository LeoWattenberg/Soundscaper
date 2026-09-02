/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EFFECT_REGISTRY } from '@audacity-ui/core';
import { audioEffectTypes } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveSupportedEffectType, safeEffectLabel } from '../src/common/editor/ui/inspector/effect-helpers.ts';

const ROOT = new URL('../', import.meta.url);
const EFFECT_SLOT = new URL('vendor/audacity-design-system/components/src/EffectsPanel/EffectSlot.tsx', ROOT);
const CALL_SITES = [
	'src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx',
	'src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx',
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
	for (const path of CALL_SITES) {
		const source = await readFile(new URL(path, ROOT), 'utf8');
		assert.match(
			source,
			/replaceEffectOptions\s*=\s*useMemo\(\s*\n?\s*\(\)\s*=>\s*audioEffectTypes\(\)/u,
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
	const options = audioEffectTypes().map((type: string) => ({
		id: type,
		name: safeEffectLabel(type, ENGLISH_COPY),
	}));
	const packaged = Object.values(EFFECT_REGISTRY).flat();

	assert.ok(options.length > packaged.length * 3, 'the host registry dwarfs the packaged sample set');
	for (const { id, name } of options) {
		assert.equal(
			resolveSupportedEffectType(name, 'en', ENGLISH_COPY),
			id,
			`the label the menu shows for ${id} must map back to it when picked`,
		);
	}
});
