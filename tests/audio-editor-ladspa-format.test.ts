/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	createNativePluginEffect,
	normalizeNativePluginEffect,
} from '../src/common/editor/native-plugin-effect.ts'
import {
	createSoundscaperNativePluginState,
	SOUNDSCAPER_NATIVE_PLUGIN_FORMATS,
} from '../src/soundscaper/editor-native-plugin-state.ts'

const sha256 = 'ab'.repeat(32)

test('LADSPA is an additive native effect and project-state format', () => {
	assert.deepEqual(SOUNDSCAPER_NATIVE_PLUGIN_FORMATS, ['vst3', 'clap', 'au', 'lv2', 'ladspa'])
	const effect = createNativePluginEffect({
		id: 'effect-ladspa',
		params: { instanceId: 'instance-ladspa', latencyFrames: 0 },
		context: { format: 'ladspa', stablePluginId: '1043:fast-lookahead-limiter', binarySha256: sha256 },
	})
	assert.equal(normalizeNativePluginEffect(effect).context.format, 'ladspa')

	const state = createSoundscaperNativePluginState({
		instanceId: 'instance-ladspa',
		format: 'ladspa',
		stablePluginId: '1043:fast-lookahead-limiter',
		binarySha256: sha256,
		stateBody: {
			kind: 'native-plugin-state',
			bodyId: `native-plugin-state:${sha256}`,
			byteLength: 16,
			sha256,
		},
		enabled: true,
		bypassed: false,
		continuity: 'live',
		latencySamples: 0,
	})
	assert.equal(state.format, 'ladspa')
})

test('Vamp is not admitted as a rack effect or persisted native effect state', () => {
	assert.throws(() => createNativePluginEffect({
		id: 'effect-vamp',
		params: { instanceId: 'instance-vamp', latencyFrames: 0 },
		context: { format: 'vamp', stablePluginId: 'example:onsets', binarySha256: sha256 },
	}), /unsupported/iu)
	assert.throws(() => createSoundscaperNativePluginState({
		instanceId: 'instance-vamp', format: 'vamp', stablePluginId: 'example:onsets',
		binarySha256: sha256,
		stateBody: { kind: 'native-plugin-state', bodyId: `native-plugin-state:${sha256}`, byteLength: 0, sha256 },
		enabled: true, bypassed: false, continuity: 'live', latencySamples: 0,
	}), /unsupported/iu)
})
