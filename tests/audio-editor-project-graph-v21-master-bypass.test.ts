/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { scheduleProjectAutomationLanesV21 } from '../src/common/editor/engine/project-automation-scheduler-v21.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

class FakeParam {
	value = 1;
	setValueAtTime(value: number): AudioParam { this.value = value; return this as unknown as AudioParam; }
	linearRampToValueAtTime(value: number): AudioParam { this.value = value; return this as unknown as AudioParam; }
	cancelScheduledValues(): AudioParam { return this as unknown as AudioParam; }
}

class FakeNode {
	connect(target: FakeNode): FakeNode { return target; }
	disconnect(): void {}
}

class FakeContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new FakeNode();
	createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
	createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
	createDelay() { return Object.assign(new FakeNode(), { delayTime: new FakeParam() }); }
	createChannelSplitter() { return new FakeNode(); }
	createChannelMerger() { return new FakeNode(); }
}

test('V21 master bypass suspends master automation during a stem render', () => {
	const address = { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' } as const;
	const project = {
		schemaFamily: 'soundscaper', schemaVersion: 1,
		sampleRate: 48_000, masterChannels: 1,
		tracks: [{
			type: 'audio', id: 'voice', gain: 1, pan: 0, mute: false, solo: false,
			effectsActive: true, effects: [],
		}],
		master: { gain: 0.5, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: createDefaultMixerGraphV21([{ id: 'voice', channelCount: 1 }], 1),
		automationLanes: [{
			id: 'master-fade', address, timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 0.25 }], segments: [],
		}],
	} as EngineProject;
	const options = {
		fromFrame: 0, toFrame: 48_000, contextStartTime: 0,
		sampleRate: 48_000, contextSampleRate: 48_000,
	};
	const bypassContext = new FakeContext();
	const bypass = buildProjectGraph(
		bypassContext as unknown as BaseAudioContext,
		bypassContext.destination as unknown as AudioNode,
		project, { metering: false, includeMaster: false },
	);
	assert.equal(bypass.parameterRegistry.get(address), null);
	assert.ok(bypass.parameterRegistry.getSuspendedParameter(address));
	assert.deepEqual(scheduleProjectAutomationLanesV21(project, bypass.parameterRegistry, options), []);

	const mixContext = new FakeContext();
	const mix = buildProjectGraph(
		mixContext as unknown as BaseAudioContext,
		mixContext.destination as unknown as AudioNode,
		project, { metering: false, includeMaster: true },
	);
	assert.equal(scheduleProjectAutomationLanesV21(project, mix.parameterRegistry, options).length, 1);
});
