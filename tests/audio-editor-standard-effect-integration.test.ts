/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUDIO_EFFECT_DEFINITIONS, audioEffectLabel, audioEffectTypes,
	audioSelectionEffectDefaults, audioSelectionEffectTypes, createEffect,
} from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_AUDIO_EFFECT_TYPES } from '../src/common/editor/project-feature-capabilities.ts';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';
import { createNyquistPluginMenuItems } from '../src/common/editor/ui/nyquist-plugin-menu-items.js';
import { getNyquistPlugin } from '../src/common/editor/nyquist/plugin-registry.js';
import { createNyquistArchiveStore, NYQUIST_ARCHIVE_ID } from '../src/common/editor/nyquist/archive-store.js';
import {
	effectHasEditableSettings, nativeEffectOptionLabel, nativeEffectParameterLabel,
} from '../src/common/editor/ui/inspector/effect-helpers.ts';
import { effectOptionCopyKey, effectParameterCopyKey } from '../src/common/i18n/canonical-extras.js';

const effects = [
	['multi-tap-delay', 'Delay', 'delayReverb', 'nyquist:delay'],
	['highpass-filter', 'High-pass filter', 'eqFilters', 'nyquist:highpass'],
	['lowpass-filter', 'Low-pass filter', 'eqFilters', 'nyquist:lowpass'],
	['noise-gate', 'Noise gate', 'noiseRepair', 'nyquist:noisegate'],
	['notch-filter', 'Notch filter', 'eqFilters', 'nyquist:notch'],
	['shelf-filter', 'Shelf filter', 'eqFilters', 'nyquist:shelffilter'],
	['tremolo', 'Tremolo', 'distortionModulation', 'nyquist:tremolo'],
	['vocoder', 'Vocoder', 'distortionModulation', 'nyquist:vocoder'],
] as const;

test('converted Nyquist effects share regular selection and realtime rack definitions', () => {
	for (const [type, label, category] of effects) {
		assert.equal(audioEffectLabel(type), label);
		assert.ok(audioEffectTypes().includes(type), `${type} must be available in the rack`);
		assert.ok(audioSelectionEffectTypes().includes(type), `${type} must be available for selections`);
		assert.ok((PROJECT_FEATURE_AUDIO_EFFECT_TYPES as readonly string[]).includes(type));
		assert.ok(EFFECT_MENU_GROUPS.some(([group, types]) => group === category && types.includes(type)));
		assert.deepEqual(audioSelectionEffectDefaults(type), createEffect(type).params);
		assert.equal(effectHasEditableSettings(type), true);
	}
	const labels = audioEffectTypes().map(type => audioEffectLabel(type));
	assert.equal(new Set(labels).size, labels.length, 'rack choices must have distinct display names');
});

test('converted bundled processors leave Legacy while their pinned sources remain available', () => {
	const reader = createNyquistPluginMenuItems({
		editBlocked: false, blocked: false, selectedAudioTrack: {},
		frequencySelectionActive: true, selectionActive: true,
	}, { openNyquist: () => undefined });
	const legacyIds = reader('legacy').map(({ id }: { id: string }) => id);
	for (const [, , , id] of effects) {
		assert.ok(getNyquistPlugin(id), `${id} provenance must remain registered`);
		assert.ok(!legacyIds.includes(id), `${id} should be reached through its regular effect`);
	}
	assert.ok(legacyIds.includes('nyquist:adjustable-fade'));
});

test('an installed archive effect appears in Legacy and can be removed', () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
	};
	const store = createNyquistArchiveStore(storage);
	const id = 'nyquist:archive:Test-Effect.ny';
	store.install({
		id, fileName: 'Test-Effect.ny', archiveId: NYQUIST_ARCHIVE_ID,
		source: '$nyquist plug-in\n$type process\n$name "Test Effect"\n(mult *track* 0.5)',
	});
	const opened: string[] = [];
	const reader = createNyquistPluginMenuItems({
		editBlocked: false, blocked: false, selectedAudioTrack: {},
		frequencySelectionActive: true, selectionActive: true, archiveStorage: storage,
	}, { openNyquist: (pluginId: string) => { opened.push(pluginId); } });
	const item = reader('legacy').find((candidate: { id: string }) => candidate.id === id);
	assert.equal(item?.label, 'Test Effect');
	assert.equal(item?.disabled, false);
	item?.onClick();
	assert.deepEqual(opened, [id]);
	store.remove(id);
	const afterRemoval = createNyquistPluginMenuItems({
		editBlocked: false, blocked: false, selectedAudioTrack: {},
		frequencySelectionActive: true, selectionActive: true, archiveStorage: storage,
	}, { openNyquist: (pluginId: string) => { opened.push(pluginId); } });
	assert.ok(!afterRemoval('legacy').some((candidate: { id: string }) => candidate.id === id));
});

test('regular controls and choices have English and German labels', () => {
	const definitions = AUDIO_EFFECT_DEFINITIONS as unknown as Readonly<Record<string, {
		readonly ranges: Readonly<Record<string, unknown>>;
		readonly choices?: Readonly<Record<string, { readonly options: readonly (string | number)[] }>>;
	}>>;
	for (const [type] of effects) {
		const definition = definitions[type];
		assert.ok(definition);
		for (const locale of ['en', 'de']) {
			for (const name of Object.keys(definition.ranges)) {
				const label = nativeEffectParameterLabel(type, name, locale);
				assert.notEqual(label, effectParameterCopyKey(type, name));
				assert.ok(label.length > 0);
			}
			for (const [name, choice] of Object.entries(definition.choices ?? {})) {
				for (const value of choice.options) {
					const label = nativeEffectOptionLabel(type, name, String(value), locale);
					assert.notEqual(label, effectOptionCopyKey(type, name, value));
				}
			}
		}
	}
});
