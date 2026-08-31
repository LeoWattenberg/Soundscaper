/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectEffectTailFrames } from '../src/common/editor/effects.js';

const SAMPLE_RATE = 100;

test('Soundscaper effect tails follow explicit production mixer paths', () => {
	const project = productionProject({
		trackEffects: [delay('track-delay', 0.1)],
		busEffects: [delay('bus-delay', 0.2)],
		masterEffects: [delay('master-delay', 0.3)],
	});

	assert.equal(projectEffectTailFrames(project), 60);
	assert.equal(projectEffectTailFrames(project, {
		includeMaster: false,
	}), 30);
});

function productionProject({
	trackEffects = [],
	busEffects = [],
	masterEffects = [],
}: Readonly<{
	readonly trackEffects?: readonly ReturnType<typeof delay>[];
	readonly busEffects?: readonly ReturnType<typeof delay>[];
	readonly masterEffects?: readonly ReturnType<typeof delay>[];
}>) {
	return {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		sampleRate: SAMPLE_RATE,
		masterChannels: 2,
		tracks: [{
			id: 'voice', type: 'audio', effectsActive: true, effects: trackEffects,
		}],
		master: { effectsActive: true, effects: masterEffects },
		automationLanes: [],
		mixer: {
			schemaVersion: 1,
			groups: [strip('bus', busEffects)],
			sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('voice-bus', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'bus' }),
				edge('bus-master', { kind: 'mixer-node', id: 'bus' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
	};
}

function delay(id: string, time: number) {
	return { id, type: 'delay', enabled: true, params: { time, feedback: 0, mix: 1 } };
}

function strip(id: string, effects: readonly ReturnType<typeof delay>[]) {
	return {
		id, name: id, color: '#000000', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects, channelCount: 2,
	};
}

function edge(id: string, source: Readonly<Record<string, string>>, destination: Readonly<Record<string, string>>) {
	return {
		id, kind: 'assignment', source, destination, position: 'post-fader',
		level: 1, enabled: true, channelMap: [0, 1],
	};
}
