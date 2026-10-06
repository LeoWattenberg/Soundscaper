/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MixerTelemetryMeters } from '../src/common/editor/ui/workspace/MixerTelemetryMeters.tsx';
import type { StripMeterSnapshot } from '../src/common/editor/production-audio/strip-meter-session.ts';

function renderedMeter(peaks: readonly number[], strip: StripMeterSnapshot['strip'] = { kind: 'track', id: 'track' }) {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		const dbfs = 20 * Math.log10(Math.max(...peaks));
		const production: StripMeterSnapshot = { strip, sequence: 1, channelCount: peaks.length,
			channels: peaks.map((peak, index) => ({ label: String(index), peak, rms: peak / Math.SQRT2 })),
			correlation: null, phaseDegrees: null };
		const meters = { tracks: { track: { dbfs } }, master: { dbfs }, groups: { bus: { dbfs } }, productionMeters: [production] };
		return renderToStaticMarkup(React.createElement(MixerTelemetryMeters, {
			controller: { getTelemetrySnapshot: () => ({ meters }), subscribeTelemetry: () => () => undefined },
			scope: strip.kind === 'master' ? 'master' : strip.kind === 'track' ? 'track' : 'group',
			targetId: strip.kind === 'master' ? '' : strip.id,
		}));
	} finally {
		if (prior) Object.defineProperty(globalThis, 'React', prior);
		else Reflect.deleteProperty(globalThis, 'React');
	}
}

test('stereo meter leaves retain the silent channel for tracks, master and buses', () => {
	for (const strip of [{ kind: 'track', id: 'track' }, { kind: 'master' }, { kind: 'mixer-node', id: 'bus' }] as const) {
		const tops = [...renderedMeter([0.8, 0], strip).matchAll(/style="top:([\d.]+)%"/gu)].map((match) => Number(match[1]));
		assert.ok(tops[0]! < 20);
		assert.equal(tops[1], 100);
	}
});

test('clip indicators require full scale and retain the channel that clipped', () => {
	assert.equal((renderedMeter([0.9, 0.9]).match(/meter-clip--active/gu) ?? []).length, 0);
	assert.equal((renderedMeter([1.01, 0.9]).match(/meter-clip--active/gu) ?? []).length, 1);
});
