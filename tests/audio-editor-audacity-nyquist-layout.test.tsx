/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { audioSelectionEffectDefaults, createEffect } from '../src/common/editor/effects.js';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const editorProps: Omit<React.ComponentProps<typeof EffectParameterEditor>, 'effect'> = {
	copy: {},
	disabled: false,
	tracks: [],
	targetTrackId: 'track-1',
	captureNoiseProfile: undefined,
	noiseProfileLabel: '',
	onRackEffectGestureBegin: undefined,
	onRackEffectPreview: undefined,
	onRackEffectCommit: undefined,
	onRackEffectCancel: undefined,
	onParametricEqGestureBegin: undefined,
	onParametricEqPreview: undefined,
	onParametricEqCommit: undefined,
	onParametricEqCancel: undefined,
	onParametricEqAudition: undefined,
	readParametricEqSpectrum: undefined,
	automationRuntime: undefined,
	automationProject: undefined,
	automationStrip: undefined,
	onChange: () => undefined,
};

function markup(type: string, advancedSettings = false): string {
	return renderToStaticMarkup(<EffectParameterEditor {...editorProps}
		effect={{ type, params: audioSelectionEffectDefaults(type) }} advancedSettings={advancedSettings} />);
}

test('converted Audacity Nyquist effects follow source control order and float-text presentation', () => {
	const ordered: Readonly<Record<string, readonly string[]>> = {
		'highpass-filter': ['frequency', 'rolloff'],
		'lowpass-filter': ['frequency', 'rolloff'],
		'notch-filter': ['frequency', 'q'],
		'shelf-filter': ['filterType', 'frequency', 'gain'],
		'noise-gate': ['stereoLink', 'threshold', 'gateFrequency', 'rangeDb', 'attack', 'hold', 'release'],
		'multi-tap-delay': ['delayType', 'echoGain', 'time', 'pitchShift', 'echoes'],
		'tremolo': ['waveform', 'phase', 'depth', 'frequency'],
		'vocoder': ['distance', 'outputMode', 'bands', 'carrierLevel', 'noiseLevel', 'radarLevel', 'radarFrequency'],
	};
	for (const [type, names] of Object.entries(ordered)) {
		const html = markup(type);
		assert.match(html, /data-audacity-nyquist-port="true"/u, type);
		assert.doesNotMatch(html, /audio-editor-effect-number--knob|audio-editor-audacity-layout__card/u, type);
		assert.deepEqual([...html.matchAll(/data-audacity-parameter="([^"]+)"/gu)].map(match => match[1]), names, type);
		if (['highpass-filter', 'lowpass-filter', 'notch-filter'].includes(type)) assert.doesNotMatch(html, /type="range"/u, type);
	}
});

test('Nyquist gate displays milliseconds and kHz while backend-only options require the advanced menu', () => {
	const gate = markup('noise-gate');
	assert.match(gate, /data-effect-param="attack"[\s\S]*?data-unit="ms"[\s\S]*?value="10"/u);
	assert.match(gate, /data-effect-param="hold"[\s\S]*?data-unit="ms"[\s\S]*?value="50"/u);
	assert.match(gate, /data-effect-param="release"[\s\S]*?data-unit="ms"[\s\S]*?value="100"/u);
	assert.match(gate, /data-effect-param="gateFrequency"[\s\S]*?data-unit="kHz"/u);
	for (const [type, option] of [['noise-gate', 'lookahead'], ['multi-tap-delay', 'mix'], ['vocoder', 'outputGain']] as const) {
		assert.doesNotMatch(markup(type), new RegExp(`data-audacity-parameter="${option}"`, 'u'));
		assert.match(markup(type, true), new RegExp(`data-audacity-parameter="${option}"`, 'u'));
	}
});

test('selection Delay keeps supported pitch and duration choices in the source row order', () => {
	const html = renderToStaticMarkup(<EffectParameterEditor {...editorProps} effect={{ type: 'multi-tap-delay',
		params: { ...audioSelectionEffectDefaults('multi-tap-delay'), pitchMode: 'speed', duration: 'extend' } }} />);
	assert.deepEqual([...html.matchAll(/data-audacity-parameter="([^"]+)"/gu)].map(match => match[1]),
		['delayType', 'echoGain', 'time', 'pitchMode', 'pitchShift', 'echoes', 'duration']);
	assert.match(html, /Pitch\/Tempo \(change speed\)/u);
	assert.match(html, /Include complete echoes/u);
});

test('ordinary native compressor keeps its existing cards and knobs', () => {
	const html = renderToStaticMarkup(<EffectParameterEditor {...editorProps} effect={createEffect('compressor')} />);
	assert.doesNotMatch(html, /data-audacity-nyquist-port|audio-editor-audacity-port/u);
	assert.match(html, /audio-editor-effect-number--knob/u);
});
