/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebVcrAudioMonitor } from '../src/common/editor/controller/web-vcr-audio-monitor.ts';

test('Web VCR mute controls only a cloned trusted monitor track', () => {
	let recordedStops = 0;
	let cloneStops = 0;
	const clone = { kind: 'audio', clone: () => clone, stop: () => { cloneStops += 1; } };
	const recorded = { kind: 'audio', clone: () => clone, stop: () => { recordedStops += 1; } };
	const connections: unknown[] = [];
	const source = node(connections);
	const gain = { ...node(connections), gain: { value: -1 } };
	const monitor = createWebVcrAudioMonitor({
		track: recorded,
		context: {
			destination: 'speakers',
			createMediaStreamSource: () => source,
			createGain: () => gain,
		},
		createStream: (tracks) => ({
			getTracks: () => tracks, getAudioTracks: () => tracks, getVideoTracks: () => [],
		}),
	});
	assert.equal(gain.gain.value, 1);
	monitor.setMuted(true);
	assert.equal(gain.gain.value, 0);
	monitor.setMuted(false);
	assert.equal(gain.gain.value, 1);
	assert.deepEqual(connections, [gain, 'speakers']);

	monitor.dispose();
	monitor.dispose();
	assert.equal(cloneStops, 1);
	assert.equal(recordedStops, 0);
	assert.throws(() => monitor.setMuted(true), /disposed/iu);
});

test('Web VCR monitor construction releases every staged clone and node on failure', () => {
	for (const stage of ['stream', 'gain', 'source-connect', 'gain-connect'] as const) {
		let cloneStops = 0;
		let sourceDisconnects = 0;
		let gainDisconnects = 0;
		const clone = { kind: 'audio', clone: () => clone, stop: () => { cloneStops += 1; } };
		const source = {
			connect() { if (stage === 'source-connect') throw new Error(`${stage} failed`); },
			disconnect() { sourceDisconnects += 1; },
		};
		const gain = {
			gain: { value: -1 },
			connect() { if (stage === 'gain-connect') throw new Error(`${stage} failed`); },
			disconnect() {
				gainDisconnects += 1;
				if (stage === 'gain-connect') throw new Error('cleanup failed');
			},
		};

		assert.throws(() => createWebVcrAudioMonitor({
			track: { kind: 'audio', clone: () => clone, stop() {} },
			context: {
				destination: 'speakers',
				createMediaStreamSource: () => source,
				createGain() {
					if (stage === 'gain') throw new Error(`${stage} failed`);
					return gain;
				},
			},
			createStream: (tracks) => {
				if (stage === 'stream') throw new Error(`${stage} failed`);
				return {
					getTracks: () => tracks, getAudioTracks: () => tracks, getVideoTracks: () => [],
				};
			},
		}), new RegExp(`${stage} failed`, 'iu'));
		assert.equal(cloneStops, 1, `${stage} clone cleanup`);
		assert.equal(sourceDisconnects, stage === 'stream' ? 0 : 1, `${stage} source cleanup`);
		assert.equal(gainDisconnects, ['source-connect', 'gain-connect'].includes(stage) ? 1 : 0,
			`${stage} gain cleanup`);
	}
});

function node(connections: unknown[]) {
	return {
		connect(value: unknown) { connections.push(value); },
		disconnect() {},
	};
}
