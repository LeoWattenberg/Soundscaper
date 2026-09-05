/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { EngineRealtimeContextFactory } from '../src/common/editor/engine/runtime-types.ts';
import {
	MockAudioBuffer,
	MockAudioContext,
	MockNode,
} from './helpers/mock-audio-context.js';
import { createMockAudioWorkletNodeClass } from './helpers/mock-audio-worklet-node.js';

const MockAudioWorkletNode = createMockAudioWorkletNodeClass(MockNode);

interface MeterMessage {
	readonly type: string;
	readonly running?: boolean;
}

interface MeterWorkletNode {
	readonly name: string;
	readonly messages: readonly MeterMessage[];
	readonly port: { onmessage: ((event: { data: unknown }) => void) | null };
}

function editorProject(title: string): EngineProject {
	return {
		id: 'project-1',
		title,
		sampleRate: 48_000,
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: 48_000,
			gain: 1,
		}],
		tracks: [{ id: 'track-1', clipIds: ['clip-1'], gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
		master: { gain: 1, effects: [] },
	};
}

interface MeteredEngineFixture {
	readonly engine: ReturnType<typeof createAudioEditorEngine>;
	readonly meter: MeterWorkletNode;
	readonly sources: ReadonlyMap<string, AudioBuffer>;
	readonly restore: () => void;
}

async function playingMeteredEngine(): Promise<MeteredEngineFixture> {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof AudioWorkletNode;
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({
		audioContextFactory: (() => context) as unknown as EngineRealtimeContextFactory,
		onMeter() {},
		meterInterval: 1_000,
	});
	const sources = new Map<string, AudioBuffer>([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]);
	engine.loadProject(editorProject('original'), sources);
	await engine.play();
	const meter = (context.workletNodes as readonly MeterWorkletNode[])
		.find(({ name }) => name === 'kw-ebu-r128-meter');
	assert.ok(meter, 'the played project arms an EBU R 128 master meter');
	return {
		engine,
		meter,
		sources,
		restore() {
			if (previousWorkletNode === undefined) delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
			else globalThis.AudioWorkletNode = previousWorkletNode;
		},
	};
}

function latestReading(engine: ReturnType<typeof createAudioEditorEngine>): unknown {
	return (engine as unknown as { latestMasterLoudnessMeter: unknown }).latestMasterLoudnessMeter;
}

test('a settled edit leaves a manually paused loudness measurement paused', async () => {
	const { engine, meter, sources, restore } = await playingMeteredEngine();
	try {
		engine.pauseLoudnessMeasurement();
		const sent = meter.messages.length;

		await engine.applyProject(editorProject('edited'), sources);

		assert.deepEqual(meter.messages.slice(sent).filter(({ type }) => type === 'reset'), []);
		assert.equal(engine.getLoudnessMeasurementState().manuallyPaused, true);
		assert.deepEqual(meter.messages.at(-1), { type: 'running', running: false });
	} finally {
		await engine.dispose();
		restore();
	}
});

test('a settled edit keeps the integrated loudness reading it has accumulated', async () => {
	const { engine, meter, sources, restore } = await playingMeteredEngine();
	try {
		meter.port.onmessage?.({ data: { type: 'meter', meter: { loudness: { integratedLufs: -14.2 } } } });
		const sent = meter.messages.length;

		await engine.applyProject(editorProject('edited'), sources);

		assert.deepEqual(meter.messages.slice(sent).filter(({ type }) => type === 'reset'), []);
		assert.deepEqual(latestReading(engine), { loudness: { integratedLufs: -14.2 } });
		assert.deepEqual(meter.messages.at(-1), { type: 'running', running: true });
	} finally {
		await engine.dispose();
		restore();
	}
});

test('loading a different project starts its loudness measurement afresh', async () => {
	const { engine, meter, sources, restore } = await playingMeteredEngine();
	try {
		engine.pauseLoudnessMeasurement();
		meter.port.onmessage?.({ data: { type: 'meter', meter: { loudness: { integratedLufs: -14.2 } } } });
		const sent = meter.messages.length;

		engine.loadProject(editorProject('another project'), sources);

		assert.deepEqual(meter.messages.slice(sent).filter(({ type }) => type === 'reset'), [{ type: 'reset' }]);
		assert.equal(engine.getLoudnessMeasurementState().manuallyPaused, false);
		assert.equal(latestReading(engine), null);
	} finally {
		await engine.dispose();
		restore();
	}
});
