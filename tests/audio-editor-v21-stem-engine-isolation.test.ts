/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { stemProject } from '../src/common/editor/controller/temporary-export.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineOfflineContextOptions } from '../src/common/editor/engine/runtime-types.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 8;
const NOW = '2026-08-20T12:00:00.000Z';

test('V21 stem rendering excludes a non-target pre-fader route without rewriting its authority', async () => {
	const project = fixture();
	const authoredEdge = project.mixer.edges.find(({ id }) => id === 'music-master');
	const authoredLane = project.automationLanes.find(({ id }) => id === 'music-master-level');
	assert.ok(authoredEdge);
	assert.ok(authoredLane);

	const snapshot = stemProject(project as never, 'voice') as unknown as typeof project;
	assert.deepEqual(snapshot.mixer.edges.find(({ id }) => id === authoredEdge.id), authoredEdge);
	assert.deepEqual(snapshot.automationLanes.find(({ id }) => id === authoredLane.id), authoredLane);

	const voice = new TestAudioBuffer(1, FRAME_COUNT, SAMPLE_RATE);
	const music = new TestAudioBuffer(1, FRAME_COUNT, SAMPLE_RATE);
	music.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => (
			new GainPropagatingOfflineContext(options) as unknown as OfflineAudioContext
		),
	});
	try {
		engine.loadProject(snapshot as never, new Map([
			['voice-source', voice as unknown as AudioBuffer],
			['music-source', music as unknown as AudioBuffer],
		]));
		const unisolated = await engine.renderMix({
			startFrame: 0,
			endFrame: FRAME_COUNT,
			includeMaster: false,
			respectMuteSolo: false,
		});
		if (!('getChannelData' in unisolated)) assert.fail('Expected an offline AudioBuffer render.');
		assert.deepEqual(
			Array.from(unisolated.getChannelData(0)),
			new Array<number>(FRAME_COUNT).fill(1),
			'the PCM harness must expose the authored non-target pre-fader route',
		);

		const isolated = await engine.renderMix({
			startFrame: 0,
			endFrame: FRAME_COUNT,
			trackId: 'voice',
			includeMaster: false,
			respectMuteSolo: false,
		});
		if (!('getChannelData' in isolated)) assert.fail('Expected an offline AudioBuffer render.');
		assert.deepEqual(
			Array.from(isolated.getChannelData(0)),
			new Array<number>(FRAME_COUNT).fill(0),
		);
	} finally {
		await engine.dispose();
	}
});

function fixture() {
	return createSoundscaperProjectV21({
		id: 'v21-stem-engine-isolation',
		title: 'V21 stem engine isolation',
		now: NOW,
		masterChannels: 1,
		sources: [source('voice-source'), source('music-source')],
		clips: [clip('voice-clip', 'voice-source'), clip('music-clip', 'music-source')],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
		mixer: {
			schemaVersion: 1,
			groups: [],
			sends: [],
			cues: [],
			vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 1 }],
			edges: [
				edge('voice-master', { kind: 'track', id: 'voice' }, { kind: 'master' }),
				edge('music-master', { kind: 'track', id: 'music' }, { kind: 'master' }, 'pre-fader'),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
		automationLanes: [{
			id: 'music-master-level',
			address: { kind: 'edge', edgeId: 'music-master', parameterId: 'level' },
			timebase: 'absolute-samples',
			points: [{ id: 'music-master-level-start', position: 0, value: 1 }],
			segments: [],
		}],
	});
}

function source(id: string) {
	return createAudioSource({
		id,
		name: id,
		storageKey: id,
		mimeType: 'audio/wav',
		frameCount: FRAME_COUNT,
		sampleRate: SAMPLE_RATE,
		channelCount: 1,
	});
}

function clip(id: string, sourceId: string) {
	return createAudioClip({
		id,
		sourceId,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		durationFrames: FRAME_COUNT,
		sourceDurationFrames: FRAME_COUNT,
	});
}

function edge(
	id: string,
	sourceValue: Readonly<Record<string, unknown>>,
	destination: Readonly<Record<string, unknown>>,
	position: 'pre-fader' | 'post-fader' = 'post-fader',
) {
	return {
		id,
		kind: 'assignment',
		source: sourceValue,
		destination,
		position,
		level: 1,
		enabled: true,
		channelMap: [0],
	} as const;
}

type ParamEvent = Readonly<{
	kind: 'set' | 'linear';
	time: number;
	value: number;
}>;

class TestAudioParam {
	value: number;
	#events: ParamEvent[] = [];

	constructor(value = 0) { this.value = value; }

	setValueAtTime(value: number, time: number): AudioParam {
		this.#events.push({ kind: 'set', value, time });
		return this as unknown as AudioParam;
	}

	linearRampToValueAtTime(value: number, time: number): AudioParam {
		this.#events.push({ kind: 'linear', value, time });
		return this as unknown as AudioParam;
	}

	cancelScheduledValues(time: number): AudioParam {
		this.#events = this.#events.filter((event) => event.time < time);
		return this as unknown as AudioParam;
	}

	valueAt(time: number): number {
		let previous: ParamEvent | null = null;
		for (const event of this.#events) {
			if (event.time > time) {
				if (event.kind === 'linear' && previous && event.time > previous.time) {
					const progress = (time - previous.time) / (event.time - previous.time);
					return previous.value + ((event.value - previous.value) * progress);
				}
				return previous?.value ?? this.value;
			}
			previous = event;
		}
		return previous?.value ?? this.value;
	}
}

class TestAudioNode {
	readonly connections: TestAudioNode[] = [];

	constructor(readonly kind: string, readonly gain: TestAudioParam | null = null) {}

	connect(target: TestAudioNode): TestAudioNode {
		this.connections.push(target);
		return target;
	}

	disconnect(): void { this.connections.length = 0; }
}

class TestBufferSourceNode extends TestAudioNode {
	buffer: AudioBuffer | null = null;
	readonly playbackRate = new TestAudioParam(1);
	onended: (() => void) | null = null;
	started: Readonly<{ duration: number; offset: number; when: number }> | null = null;

	constructor() { super('buffer-source'); }

	start(when: number, offset: number, duration: number): void {
		this.started = { when, offset, duration };
	}

	stop(): void {}
}

class TestAudioBuffer {
	readonly duration: number;
	readonly channels: Float32Array[];

	constructor(
		readonly numberOfChannels: number,
		readonly length: number,
		readonly sampleRate: number,
	) {
		this.duration = length / sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel: number): Float32Array { return this.channels[channel]!; }

	copyToChannel(sourceValue: Float32Array, channel: number, offset = 0): void {
		this.getChannelData(channel).set(sourceValue, offset);
	}
}

class GainPropagatingOfflineContext {
	readonly currentTime = 0;
	readonly destination = new TestAudioNode('destination');
	readonly audioWorklet = { addModule: async (): Promise<void> => undefined };
	readonly numberOfChannels: number;
	readonly length: number;
	readonly sampleRate: number;
	readonly #sources: TestBufferSourceNode[] = [];

	constructor(options: EngineOfflineContextOptions) {
		this.numberOfChannels = options.numberOfChannels;
		this.length = options.length;
		this.sampleRate = options.sampleRate;
	}

	createGain(): TestAudioNode {
		return new TestAudioNode('gain', new TestAudioParam(1));
	}

	createStereoPanner(): TestAudioNode & { readonly pan: TestAudioParam } {
		return Object.assign(new TestAudioNode('stereo-panner'), { pan: new TestAudioParam(0) });
	}

	createDelay(): TestAudioNode & { readonly delayTime: TestAudioParam } {
		return Object.assign(new TestAudioNode('delay'), { delayTime: new TestAudioParam(0) });
	}

	createChannelSplitter(): TestAudioNode { return new TestAudioNode('splitter'); }
	createChannelMerger(): TestAudioNode { return new TestAudioNode('merger'); }

	createBufferSource(): TestBufferSourceNode {
		const sourceNode = new TestBufferSourceNode();
		this.#sources.push(sourceNode);
		return sourceNode;
	}

	createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
		return new TestAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
	}

	async startRendering(): Promise<AudioBuffer> {
		const rendered = new TestAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
		for (const sourceNode of this.#sources) this.#renderSource(sourceNode, rendered);
		return rendered as unknown as AudioBuffer;
	}

	#renderSource(sourceNode: TestBufferSourceNode, rendered: TestAudioBuffer): void {
		if (!sourceNode.started || !sourceNode.buffer) return;
		const sourceBuffer = sourceNode.buffer as unknown as TestAudioBuffer;
		const { duration, offset, when } = sourceNode.started;
		for (let frame = 0; frame < rendered.length; frame += 1) {
			const time = frame / this.sampleRate;
			if (time < when || time >= when + duration) continue;
			const rate = sourceNode.playbackRate.valueAt(time);
			const sourceFrame = Math.floor((offset + ((time - when) * rate)) * sourceBuffer.sampleRate);
			for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
				const sourceChannel = Math.min(channel, sourceBuffer.numberOfChannels - 1);
				propagateSample(
					sourceNode,
					sourceBuffer.getChannelData(sourceChannel)[sourceFrame] ?? 0,
					time,
					rendered.getChannelData(channel),
					frame,
				);
			}
		}
	}
}

function propagateSample(
	node: TestAudioNode,
	value: number,
	time: number,
	output: Float32Array,
	frame: number,
): void {
	for (const connection of node.connections) {
		if (connection.kind === 'destination') {
			output[frame] = (output[frame] ?? 0) + value;
			continue;
		}
		propagateSample(connection, value * (connection.gain?.valueAt(time) ?? 1), time, output, frame);
	}
}
