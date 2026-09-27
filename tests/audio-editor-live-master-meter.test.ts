/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { readEngineMeter, readMasterMeter } from '../src/common/editor/engine/engine-meter-reading.ts';
import { ChannelCorrelationJellyfish } from '../src/common/editor/ui/inspector/ChannelCorrelationJellyfish.tsx';

test('live master visuals are absent without a lease and bounded when enabled', () => {
	const ordinary = fakeAnalyser(Float32Array.of(0.5, -0.5));
	const disabled = readMasterMeter(ordinary);
	assert.equal(disabled.peak, 0.5);
	assert.equal(Object.hasOwn(disabled, 'spectrumDb'), false);
	assert.equal(Object.hasOwn(disabled, 'stereoScope'), false);
	assert.equal(Object.hasOwn(disabled, 'stereoCorrelation'), false);

	const frequencies = new Float32Array(2_048).fill(-120);
	frequencies[5] = -6;
	const left = Float32Array.from({ length: 256 }, (_value, index) => index % 2 ? -1 : 1);
	const right = left.slice();
	const enabled = readMasterMeter(ordinary, {
		spectrum: fakeAnalyser(new Float32Array(4_096), frequencies),
		splitter: null,
		stereo: [fakeAnalyser(left), fakeAnalyser(right)],
	});
	assert.equal(enabled.spectrumDb?.length, 128);
	assert.ok(enabled.spectrumDb?.slice(0, 40).some((bin) => bin === -6), 'bass bin remains visible');
	assert.ok(enabled.spectrumDb?.slice(80).every((bin) => bin === -120));
	assert.equal(enabled.stereoCorrelation, 1);
	assert.equal(enabled.stereoScope?.length, 64);
	assert.ok(enabled.stereoScope?.every(({ x, y }) => x === 0 && Math.abs(y) === 1));
	left.fill(0);
	assert.equal(Math.abs(enabled.stereoScope?.[0]?.y ?? 0), 1, 'published points own their values');
	assert.equal(Object.isFrozen(enabled.spectrumDb), true);
	assert.equal(Object.isFrozen(enabled.stereoScope), true);
});

test('track meters stay scalar and silent stereo input yields an empty jellyfish trace', () => {
	const silent = fakeAnalyser(new Float32Array(4));
	const trackMeter = readEngineMeter(silent);
	assert.equal(trackMeter.peak, 0);
	assert.equal(trackMeter.dbfs, -Infinity);
	assert.equal(Object.hasOwn(trackMeter, 'spectrumDb'), false);
	const master = readMasterMeter(silent, {
		spectrum: null,
		splitter: null,
		stereo: [silent, silent],
	});
	assert.deepEqual(master.stereoScope, []);
	assert.equal(master.stereoCorrelation, null);
});

test('jellyfish meter exposes a live reading and an accessible empty state', () => {
	const source = fakeAnalyser(Float32Array.of(1, -1));
	const meter = readMasterMeter(source, {
		spectrum: null,
		splitter: null,
		stereo: [source, source],
	});
	const controller = {
		subscribeTelemetry: (_listener: () => void) => () => undefined,
		getTelemetrySnapshot: () => ({ meters: { master: meter } }),
	};
	const copy = { correlation: 'Channel correlation' };
	const markup = renderToStaticMarkup(React.createElement(ChannelCorrelationJellyfish, { controller, copy }));
	assert.match(markup, /data-analysis-jellyfish="true"/u);
	assert.match(markup, /data-analysis-jellyfish-canvas="true"/u);
	assert.match(markup, /aria-valuenow="1"/u);
	const empty = renderToStaticMarkup(React.createElement(ChannelCorrelationJellyfish, {
		controller: { ...controller, getTelemetrySnapshot: () => ({ meters: { master: null } }) }, copy,
	}));
	assert.doesNotMatch(empty, /aria-valuenow=/u);
	assert.match(empty, />—<\/div>/u);
});

function fakeAnalyser(waveform: Float32Array, spectrum?: Float32Array): AnalyserNode {
	return {
		fftSize: waveform.length,
		frequencyBinCount: spectrum?.length ?? waveform.length / 2,
		getFloatTimeDomainData(target: Float32Array): void { target.set(waveform); },
		...(spectrum ? {
			getFloatFrequencyData(target: Float32Array): void { target.set(spectrum); },
		} : {}),
	} as unknown as AnalyserNode;
}
