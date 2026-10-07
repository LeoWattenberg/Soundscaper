/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { audioSelectionEffectDefaults, createEffect } from '../src/common/editor/effects.js';
import { AUDACITY_EFFECT_DEFINITIONS } from '../src/common/editor/audacity-effects/manifest.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installResponsivenessTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const editorProps: Omit<React.ComponentProps<typeof EffectParameterEditor>, 'effect'> = {
	copy: ENGLISH_COPY, disabled: false, tracks: [], targetTrackId: 'track',
	captureNoiseProfile: undefined, noiseProfileLabel: '',
	onRackEffectGestureBegin: undefined, onRackEffectPreview: undefined,
	onRackEffectCommit: undefined, onRackEffectCancel: undefined,
	onParametricEqGestureBegin: undefined, onParametricEqPreview: undefined,
	onParametricEqCommit: undefined, onParametricEqCancel: undefined,
	onParametricEqAudition: undefined, readParametricEqSpectrum: undefined,
	automationRuntime: undefined, automationProject: undefined, automationStrip: undefined,
	onChange: () => undefined,
};

test('Soundscaper native parameter admission is retained and refreshes parameters, effect type and advanced controls', async () => {
	const dom = installResponsivenessTestDom();
	let enumerations = 0;
	const original = createEffect('compressor');
	const params = new Proxy(original.params, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
	let effect = { ...original, params };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EffectParameterEditor {...editorProps} effect={effect} />));
		const first = enumerations;
		assert.ok(first > 0);
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(
			<EffectParameterEditor {...editorProps} effect={effect} disabled={revision % 2 === 0} />));
		assert.equal(enumerations, first, 'unrelated publication must not enumerate native parameters again');
		effect = { ...original, params: { ...original.params, extraControl: 2 } };
		await act(async () => root.render(<EffectParameterEditor {...editorProps} effect={effect} />));
		assert.ok(dom.find('[data-effect-param="extraControl"]'));
		effect = { ...original, type: 'noise-gate', params: audioSelectionEffectDefaults('noise-gate') };
		await act(async () => root.render(<EffectParameterEditor {...editorProps} effect={effect} />));
		assert.equal(dom.find('[data-audacity-parameter="lookahead"]'), null);
		await act(async () => root.render(<EffectParameterEditor {...editorProps} effect={effect} advancedSettings />));
		assert.ok(dom.find('[data-audacity-parameter="lookahead"]'));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('Soundscaper Audacity enum option localization is retained across live values and follows locale and effect changes', async () => {
	const dom = installResponsivenessTestDom();
	const type = 'audacity-loudness-normalization';
	const options: readonly { readonly labelKey: string; readonly value: string | number }[] = AUDACITY_EFFECT_DEFINITIONS[type].params.mode.options;
	const optionKeys = new Set(options.map(option => option.labelKey));
	let labelReads = 0;
	let copy: Readonly<Record<string, string>> = new Proxy(ENGLISH_COPY, { get(target, key, receiver) {
		if (typeof key === 'string' && optionKeys.has(key)) labelReads++;
		return Reflect.get(target, key, receiver);
	} });
	let effect = { id: 'selection-effect', type: String(type), params: audioSelectionEffectDefaults(type) };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EffectParameterEditor {...editorProps} copy={copy} effect={effect} />));
		const first = labelReads;
		assert.ok(first >= options.length);
		for (let revision = 1; revision <= 30; revision++) {
			effect = { ...effect, params: { ...effect.params, targetLufs: -12 - revision } };
			await act(async () => root.render(<EffectParameterEditor {...editorProps} copy={copy} effect={effect} disabled={revision % 2 === 0} />));
		}
		assert.equal(labelReads, first, 'live numeric changes must not relocalize immutable enum choices');
		assert.equal(Number(dom.one('[data-effect-param="targetLufs"]').querySelector('input')?.value), -42);
		copy = { ...ENGLISH_COPY, [options[0]!.labelKey]: 'Localized loudness' };
		await act(async () => root.render(<EffectParameterEditor {...editorProps} copy={copy} effect={effect} />));
		assert.match(dom.one('[data-effect-param="mode"]').textContent, /Localized loudness/u);
		effect = { id: 'selection-effect', type: 'audacity-distortion', params: audioSelectionEffectDefaults('audacity-distortion') };
		await act(async () => root.render(<EffectParameterEditor {...editorProps} copy={copy} effect={effect} />));
		assert.match(dom.one('[data-effect-param="mode"]').textContent, /Hard Clipping/u);
		assert.doesNotMatch(dom.one('[data-effect-param="mode"]').textContent, /Localized loudness/u);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
