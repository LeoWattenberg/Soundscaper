/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	SoundscaperNativeEffectManagePanel,
	nativePluginEntryCanInstantiateAsEffect,
} from '../src/common/editor/ui/dialogs/SoundscaperNativeEffectPanels.tsx';
import { resolveSoundscaperNativeServicesCopy } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	type SoundscaperNativeServicesDialogState,
} from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';

const COPY = resolveSoundscaperNativeServicesCopy();
const EFFECT_ENTRY = Object.freeze({
	entryId: 'effect-entry', kind: 'effect', format: 'ladspa', name: 'LADSPA Gain', vendor: 'Fixture',
	eligible: true, ineligibleReason: null,
	installations: [Object.freeze({
		installationId: 'i0123456789abcde', version: '1.0', allowed: true,
		selected: true, quarantined: false,
	})],
});
const ANALYZER_ENTRY = Object.freeze({
	entryId: 'analyzer-entry', kind: 'analyzer', format: 'vamp', name: 'Vamp Flux', vendor: 'Fixture',
	eligible: true, ineligibleReason: null,
	installations: [Object.freeze({
		installationId: 'vi0123456789abcdef0123456789abcd', version: '2.0', allowed: false,
		selected: true, quarantined: false,
	})],
});

function registryState(): SoundscaperNativeServicesDialogState {
	return {
		...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		registry: { entries: [EFFECT_ENTRY, ANALYZER_ENTRY] },
	};
}

test('the effect chooser excludes Vamp analyzers while management keeps them visible', () => {
	const manage = renderToStaticMarkup(<SoundscaperNativeEffectManagePanel
		copy={COPY}
		state={registryState()}
		disabled={false}
		perform={() => {}}
	/>);
	const use = renderToStaticMarkup(<SoundscaperNativeEffectManagePanel
		mode="use"
		copy={COPY}
		state={registryState()}
		disabled={false}
		perform={() => {}}
	/>);

	assert.match(manage, /Vamp Flux/u, 'analyzers remain available to the management workflow');
	assert.match(manage, /data-native-plugin-entry="analyzer-entry"/u);
	assert.doesNotMatch(use, /Vamp Flux/u, 'analyzers cannot enter the effect-instantiation workflow');
	assert.match(use, /LADSPA Gain/u);
	assert.equal(nativePluginEntryCanInstantiateAsEffect(EFFECT_ENTRY), true);
	assert.equal(nativePluginEntryCanInstantiateAsEffect(ANALYZER_ENTRY), false);
	assert.equal(nativePluginEntryCanInstantiateAsEffect({ ...ANALYZER_ENTRY, kind: 'effect' }), false,
		'the Vamp format is fail-closed even when an older registry omits or mislabels kind');
});

test('a hosted native effect mounts its generated parameter controls inside the menu dialog', () => {
	const state: SoundscaperNativeServicesDialogState = {
		...registryState(),
		pluginInstance: {
			instanceId: 'plugin_instance_ladspa', entryId: 'effect-entry',
			stablePluginId: 'fixture-ladspa-gain', format: 'ladspa', binarySha256: 'a'.repeat(64),
			inputChannels: 2, outputChannels: 2, state: 'hosted', enabled: true,
			bypassed: false, latencySamples: 0,
		},
	};
	const markup = renderToStaticMarkup(<SoundscaperNativeEffectManagePanel
		mode="use"
		copy={COPY}
		state={state}
		disabled={false}
		perform={() => {}}
	/>);

	assert.match(markup, /data-native-plugin-instance="plugin_instance_ladspa"/u);
	assert.match(markup, /Loading plug-in parameters/u,
		'the hosted instance owns the parameter surface instead of adding permanent editor chrome');
});
