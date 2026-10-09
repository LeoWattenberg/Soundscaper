/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { SidePlaybackMeter, PlaybackMeterToolbarGroup } from '../src/common/editor/ui/toolbar/AudioEditorMeterControls.jsx';
import { DEFAULT_PLAYBACK_METER_SETTINGS, type MeterSettings } from '../src/common/editor/ui/meter-settings.ts';
import type { EngineMeterReading } from '../src/common/editor/engine/public-api.ts';
import type { StripMeterSnapshot } from '../src/common/editor/production-audio/strip-meter-session.ts';

function renderMeter(settings: MeterSettings, productionMeters?: readonly StripMeterSnapshot[], toolbar = false): string {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const master: EngineMeterReading = { peak: 0.8, rms: 0.4, dbfs: 20 * Math.log10(0.8),
		loudness: { momentaryLufs: -23, shortTermLufs: -24, integratedLufs: -25 } };
	try {
		return renderToStaticMarkup(React.createElement(toolbar ? PlaybackMeterToolbarGroup : SidePlaybackMeter, {
			controller: { getTelemetrySnapshot: () => ({ meters: { master, productionMeters } }), subscribeTelemetry: () => () => undefined },
			copy: ENGLISH_COPY, snapshot: { audioDevices: { playbackGain: 1 } }, settings,
			onSettingsChange: () => undefined, run: () => undefined, clippingEnabled: true, isCompact: false,
		}));
	} finally {
		if (prior) Object.defineProperty(globalThis, 'React', prior);
		else Reflect.deleteProperty(globalThis, 'React');
	}
}

function production(strip: StripMeterSnapshot['strip'] = { kind: 'master' }): StripMeterSnapshot {
	return { strip, sequence: 1, channelCount: 2, correlation: null, phaseDegrees: null,
		channels: [{ label: 'L', peak: 0.8, rms: 0.4 }, { label: 'R', peak: 0, rms: 0 }] };
}

function channelPercentages(markup: string, property: string): number[] {
	const parent = /data-meter-orientation="[^"]+" style="([^"]+)"/u.exec(markup)?.[1] ?? '';
	return [...markup.matchAll(/<span class="kw-audio-editor__playback-meter-channel"[^>]*>/gu)].map(([span]) => {
		const own = /style="([^"]+)"/u.exec(span)?.[1] ?? '';
		return Number.parseFloat(new Map([parent, own].join(';').split(';').map(entry => {
			const separator = entry.indexOf(':');
			return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
		})).get(property) ?? 'NaN');
	});
}

for (const type of ['db-log', 'db-linear', 'amplitude'] as const) {
	for (const toolbar of [false, true]) test(`${type} ${toolbar ? 'toolbar' : 'panel'} retains independent master channels`, () => {
		const markup = renderMeter({ ...DEFAULT_PLAYBACK_METER_SETTINGS, type, style: 'rms', position: toolbar ? 'top' : 'panel' }, [production()], toolbar);
		const peaks = channelPercentages(markup, '--playback-meter-peak');
		const rms = channelPercentages(markup, '--playback-meter-rms');
		assert.equal(peaks.length, 2);
		assert.ok(peaks[0]! >= 80);
		assert.equal(peaks[1], 0, 'the silent right channel has no peak fill');
		assert.equal(rms[1], 0, 'the silent right channel has no RMS fill');
		assert.ok(rms[0]! > 0 && rms[0]! <= peaks[0]!);
	});
}

test('scalar master fallback ignores another strip and retains the two existing bars', () => {
	const absent = channelPercentages(renderMeter(DEFAULT_PLAYBACK_METER_SETTINGS), '--playback-meter-peak');
	const other = channelPercentages(renderMeter(DEFAULT_PLAYBACK_METER_SETTINGS, [production({ kind: 'track', id: 'other' })]), '--playback-meter-peak');
	assert.equal(absent.length, 2);
	assert.ok(absent[0]! > 80);
	assert.equal(absent[0], absent[1]);
	assert.deepEqual(other, absent);
});

test('EBU programme loudness remains one aggregate bar with independent channel telemetry', () => {
	const markup = renderMeter({ ...DEFAULT_PLAYBACK_METER_SETTINGS, type: 'ebu-r128' }, [production()]);
	assert.equal(channelPercentages(markup, '--playback-meter-peak').length, 1);
	assert.match(markup, /aria-valuenow="-23"/u);
	assert.match(markup, /aria-valuetext="−23\.0 LUFS"/u);
});
