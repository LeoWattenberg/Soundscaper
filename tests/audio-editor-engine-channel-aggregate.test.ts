/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileEngineChannelMeters } from '../src/common/editor/engine/engine-channel-meter-aggregate.ts';
import { createSessionStripMeterStore } from '../src/common/editor/production-audio/strip-meter-session.ts';

test('scalar master peak and RMS measure channel power without mono downmix cancellation', () => {
	const store = createSessionStripMeterStore();
	for (const right of [new Float32Array([0, 0]), new Float32Array([-0.8, 0.8])]) {
		const channels = [new Float32Array([0.8, -0.8]), right];
		const production = store.update({ kind: 'master' }, { channels, channelLabels: ['L', 'R'] });
		const master = { peak: 0.4, rms: 0.4, dbfs: -8, spectrumDb: [-12] };
		const frame = { master, tracks: {}, groups: {}, sends: {}, productionMeters: [production] };
		assert.equal(reconcileEngineChannelMeters(frame), frame);
		assert.ok(Math.abs(master.peak - 0.8) < 1e-7);
		assert.ok(Math.abs(master.rms - Math.sqrt(right[0] === 0 ? 0.32 : 0.64)) < 1e-7);
		assert.ok(Math.abs(master.dbfs - 20 * Math.log10(0.8)) < 1e-6);
		assert.deepEqual(master.spectrumDb, [-12]);
	}
});

test('track and bus scalar readings use their corresponding channel banks and retain legacy fallback', () => {
	const store = createSessionStripMeterStore();
	const productionMeters = [
		store.update({ kind: 'track', id: 'track' }, { channels: [new Float32Array([0.5])], channelLabels: ['M'] }),
		store.update({ kind: 'mixer-node', id: 'group' }, { channels: [new Float32Array([0.75])], channelLabels: ['M'] }),
		store.update({ kind: 'mixer-node', id: 'send' }, { channels: [new Float32Array([0.25])], channelLabels: ['M'] }),
	];
	const untouched = { peak: 0.125, rms: 0.125, dbfs: -18 };
	const frame = { master: untouched, tracks: { track: { ...untouched }, legacy: { ...untouched } },
		groups: { group: { ...untouched } }, sends: { send: { ...untouched } }, productionMeters };
	reconcileEngineChannelMeters(frame);
	assert.equal(frame.tracks.track.peak, 0.5);
	assert.equal(frame.groups.group.peak, 0.75);
	assert.equal(frame.sends.send.peak, 0.25);
	assert.deepEqual(frame.tracks.legacy, untouched);
	assert.deepEqual(frame.master, untouched);
});
