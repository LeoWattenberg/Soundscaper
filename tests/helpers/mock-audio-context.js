/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The Web Audio doubles the editor runtime suites drive the engine with.
 *
 * They live outside the suite that first defined them because that suite carries a legacy
 * size ratchet, and these shared doubles were the part of it that belonged to every caller
 * rather than to one test. `MockOfflineAudioContext` and its rendering subclass stay with
 * the suite that owns their offline expectations.
 */

export class MockParam {
	constructor(value = 0) { this.value = value; this.events = []; }
	setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
	linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
}

export class MockNode {
	constructor(kind = 'node') {
		this.kind = kind;
		this.connections = [];
		this.connectionDetails = [];
		this.disconnected = false;
	}
	connect(node, output = 0, input = 0) {
		this.connections.push(node);
		this.connectionDetails.push({ node, output, input });
		return node;
	}
	disconnect() {
		this.disconnected = true;
		this.connections = [];
		this.connectionDetails = [];
	}
}

export class MockChunkStreamClient {
	constructor() {
		this.opens = [];
		this.handles = [];
		this.disposed = false;
	}
	open(options) {
		this.opens.push(options);
		let resolveDone;
		const handle = {
			ready: Promise.resolve({ channelCount: options.source.channelCount }),
			primed: Promise.resolve({ packets: 4, frames: 4_096 }),
			done: new Promise((resolve) => { resolveDone = resolve; }),
			plays: [],
			cancelled: false,
			async play(value) { this.plays.push(value); },
			cancel() {
				this.cancelled = true;
				resolveDone({ cancelled: true });
			},
		};
		this.handles.push(handle);
		return handle;
	}
	dispose() { this.disposed = true; }
}

export class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.duration = length / sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}
	getChannelData(index) { return this.channels[index]; }
}

export class MockAudioContext {
	constructor(options = {}) {
		this.sampleRate = options.sampleRate || 48000;
		this.currentTime = 0;
		this.destination = new MockNode('destination');
		this.bufferSources = [];
		this.nodeKinds = [];
		this.workletNodes = [];
		this.audioWorkletModules = [];
		this.createdDelays = [];
		this.audioWorklet = {
			addModule: async (url) => { this.audioWorkletModules.push(String(url)); },
		};
		this.state = 'running';
	}
	make(kind, properties = {}) {
		const node = Object.assign(new MockNode(kind), properties);
		this.nodeKinds.push(kind);
		return node;
	}
	createGain() { return this.make('gain', { gain: new MockParam(1) }); }
	createStereoPanner() { return this.make('stereo-panner', { pan: new MockParam(0) }); }
	createBiquadFilter() { return this.make('biquad', { frequency: new MockParam(), Q: new MockParam(), gain: new MockParam() }); }
	createDynamicsCompressor() {
		return this.make('compressor', {
			threshold: new MockParam(), knee: new MockParam(), ratio: new MockParam(), attack: new MockParam(), release: new MockParam(),
		});
	}
	createDelay(maximumDelayTime) {
		const delay = this.make('delay', { delayTime: new MockParam(), maximumDelayTime });
		this.createdDelays.push(delay);
		return delay;
	}
	createConvolver() { return this.make('convolver', { buffer: null }); }
	createWaveShaper() { return this.make('waveshaper', { curve: null }); }
	createAnalyser() {
		const analyser = this.make('analyser', {
			fftSize: 256,
			minDecibels: -100,
			maxDecibels: -30,
			smoothingTimeConstant: 0.8,
			getFloatTimeDomainData(values) { values.fill(0.25); },
			getFloatFrequencyDomainData(values) { values.fill(-48); },
		});
		Object.defineProperty(analyser, 'frequencyBinCount', {
			configurable: true,
			get() { return analyser.fftSize / 2; },
		});
		return analyser;
	}
	createBufferSource() {
		const node = this.make('buffer-source', {
			buffer: null,
			playbackRate: new MockParam(1),
			start: (when, offset, duration) => { node.started = [when, offset, duration]; },
			stop: () => { node.stopped = true; },
		});
		this.bufferSources.push(node);
		return node;
	}
	createBuffer(channels, length, sampleRate) { return new MockAudioBuffer(channels, length, sampleRate); }
	async resume() { this.state = 'running'; }
	async close() { this.state = 'closed'; this.closed = true; }
}
