/* SPDX-License-Identifier: AGPL-3.0-only */

// The mock Web Audio environment the audio editor runtime suites share: the
// offline contexts that render gain and parameter ramps deterministically, the
// worklet node class the engine's processors are loaded through, and the small
// PCM helpers the assertions read results with. Split out of
// audio-editor-runtime.test.js so its suites can sit in separate files.

import { createMockAudioWorkletNodeClass } from './mock-audio-worklet-node.js';
import {
	MockAudioBuffer,
	MockAudioContext,
	MockNode,
} from './mock-audio-context.js';

export function concatenateFloat32(parts) {
	const output = new Float32Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

export function createProject() {
	return {
		id: 'project-1',
		sampleRate: 48000,
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: 48000,
			gain: 0.8,
			fadeInFrames: 100,
			fadeOutFrames: 100,
			reversed: false,
		}],
		tracks: [{
			id: 'track-1',
			clipIds: ['clip-1'],
			gain: 1,
			pan: -0.25,
			mute: false,
			solo: false,
			effects: [
				{ type: 'highpass', params: { frequency: 80 } },
				{ type: 'compressor', params: { threshold: -20 } },
				{ type: 'delay', params: { time: 0.1, feedback: 0.2, mix: 0.1 } },
			],
		}],
		master: {
			gain: 0.9,
			effects: [{ type: 'reverb', params: { duration: 0.5, mix: 0.1 } }],
		},
	};
}

export function createTrackEnvelopeProject({ effects = [] } = {}) {
	return {
		id: 'track-envelope-project',
		sampleRate: 8,
		sources: [{
			id: 'envelope-source', frameCount: 8, channelCount: 1, sampleRate: 8,
		}],
		clips: [{
			id: 'envelope-clip', sourceId: 'envelope-source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8,
			gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, envelope: [],
		}],
		tracks: [{
			type: 'audio', id: 'envelope-track', name: 'Envelope', clipIds: ['envelope-clip'],
			gain: 0.5, pan: 0, mute: false, solo: false,
			envelope: [{ frame: 0, value: 1 }, { frame: 4, value: 0 }, { frame: 8, value: 1 }],
			effects,
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	};
}

export function createRackProject({ tracks, masterEffects = [] }) {
	const clips = tracks.map((track, index) => ({
		id: `clip-${index + 1}`,
		sourceId: 'source-1',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		durationFrames: 4_800,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
	}));
	return {
		id: 'rack-project',
		sampleRate: 48_000,
		clips,
		tracks: tracks.map((track, index) => ({
			id: track.id,
			clipIds: [clips[index].id],
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			effectsActive: track.effectsActive !== false,
			effects: track.effects,
		})),
		master: { gain: 1, effects: masterEffects },
	};
}

export function incomingConnections(nodes, target, input) {
	return nodes.flatMap((node) => node.connectionDetails || []).filter((connection) => (
		connection.node === target && connection.input === input
	));
}

export const MockAudioWorkletNode = createMockAudioWorkletNodeClass(MockNode);

export class MockOfflineAudioContext extends MockAudioContext {
	constructor(options) {
		super({ sampleRate: options.sampleRate });
		this.length = options.length;
		this.numberOfChannels = options.numberOfChannels;
	}
	async startRendering() { return new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate); }
}

export class MockGainRenderingOfflineAudioContext extends MockOfflineAudioContext {
	async startRendering() {
		const rendered = new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
		for (const source of this.bufferSources) {
			if (!source.started || !source.buffer) continue;
			const [when, offset, duration] = source.started;
			for (let frame = 0; frame < rendered.length; frame += 1) {
				const time = frame / this.sampleRate;
				if (time < when || time >= when + duration) continue;
				const playbackRate = mockParamValueAtTime(source.playbackRate, time);
				const sourceFrame = Math.floor((offset + (time - when) * playbackRate) * source.buffer.sampleRate);
				for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
					const sourceChannel = Math.min(channel, source.buffer.numberOfChannels - 1);
					const value = source.buffer.getChannelData(sourceChannel)[sourceFrame] || 0;
					propagateMockSample(source, value, time, rendered.getChannelData(channel), frame);
				}
			}
		}
		return rendered;
	}
}

export function propagateMockSample(node, value, time, output, frame) {
	for (const connection of node.connections) {
		if (connection.kind === 'destination') {
			output[frame] += value;
			continue;
		}
		const nextValue = connection.kind === 'gain'
			? value * mockParamValueAtTime(connection.gain, time)
			: value;
		propagateMockSample(connection, nextValue, time, output, frame);
	}
}

export function mockParamValueAtTime(param, time) {
	let previous = null;
	for (const event of param?.events || []) {
		const [type, value, eventTime] = event;
		if (eventTime > time) {
			if (type === 'ramp' && previous && eventTime > previous.time) {
				const progress = (time - previous.time) / (eventTime - previous.time);
				return previous.value + (value - previous.value) * progress;
			}
			return previous?.value ?? param.value;
		}
		previous = { value, time: eventTime };
	}
	return previous?.value ?? param?.value ?? 0;
}

export class MockRampOfflineAudioContext extends MockOfflineAudioContext {
	async startRendering() {
		const buffer = new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
		for (const channel of buffer.channels) {
			for (let frame = 0; frame < channel.length; frame += 1) channel[frame] = frame;
		}
		return buffer;
	}
}

export function textAt(bytes, offset, length) {
	return String.fromCharCode(...bytes.slice(offset, offset + length));
}
