/* SPDX-License-Identifier: AGPL-3.0-only */

// Controller and evaluator fixtures the Nyquist suites share. Split out of
// audio-editor-nyquist-controller.test.js so its suites can sit in separate
// files.

import { register } from 'node:module';

export const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}

`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

export const { ENGLISH_COPY } = await import('../../src/common/i18n/catalogs.js');

export const { createAudioEditorController } = await import('../../src/common/editor/app.js');

export const { createCurrentAudioEditorProject } = await import('../../src/common/editor/project-current.ts');

export const { createProjectStore } = await import('../../src/common/editor/storage.js');

export async function createFixture(prefix, options) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${prefix}-${Date.now()}-${Math.random()}`,
	});
	for (const track of options.tracks) {
		const sourceId = `${track.id}-source`;
		const writer = await store.beginSourceWrite(sourceId, {
			name: `${track.name}.wav`,
			mimeType: 'audio/wav',
			sampleRate: options.sampleRate,
			channelCount: 1,
		});
		await writer.write([track.input]);
		await writer.commit({ sampleRate: options.sampleRate, channelCount: 1 });
	}
	const project = createCurrentAudioEditorProject({
		id: `${prefix}-project`,
		title: 'Nyquist fixture',
		now: '2026-07-15T00:00:00.000Z',
		sampleRate: options.sampleRate,
		tempo: { bpm: 90 },
		sources: options.tracks.map((track) => ({
			id: `${track.id}-source`,
			name: `${track.name}.wav`,
			mimeType: 'audio/wav',
			storageKey: `${track.id}-source`,
			frameCount: track.input.length,
			channelCount: 1,
			sampleRate: options.sampleRate,
			originalSampleRate: options.sampleRate,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		})),
		tracks: [
			...(options.labelTrack ? [{
				type: 'label',
				id: options.labelTrack.id,
				name: options.labelTrack.name,
				labels: [],
			}] : []),
			...options.tracks.map((track) => ({
				type: 'audio',
				id: track.id,
				name: track.name,
				clipIds: [`${track.id}-clip`],
			})),
		],
		clips: options.tracks.map((track) => ({
			id: `${track.id}-clip`,
			sourceId: `${track.id}-source`,
			title: track.name,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: track.input.length,
			durationFrames: track.input.length,
		})),
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	return { store, project };
}

export function createController(store, inputs, nyquistEvaluator, options = {}) {
	return createAudioEditorController(null, {
		headless: true,
		copy: ENGLISH_COPY,
		locale: 'en',
		store,
		engine: options.engine || createMemoryEngine(),
		ffmpeg: { dispose() {} },
		nyquistEvaluator,
		renderSnapshot: async (_snapshot, range) => {
			options.onRender?.(range);
			const input = inputs.get(range.trackId);
			return audioBuffer([input.slice(range.startFrame, range.endFrame)], 8_000);
		},
	});
}

export function audioBuffer(channels, sampleRate) {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData(channel) { return channels[channel]; },
	};
}

export function createMemoryEngine() {
	return {
		positionFrame: 0,
		state: 'stopped',
		loadProject() {},
		async applyProject() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); return this.positionFrame; },
		setLoop() {},
		setSourceResolver() {},
		async getAudioContext() {
			return {
				createBuffer: (channelCount, frameCount, sampleRate) => (
					new MockAudioBuffer(channelCount, frameCount, sampleRate)
				),
			};
		},
		async dispose() {},
	};
}

export function createPreviewEngine(playback) {
	const engine = createMemoryEngine();
	engine.pause = () => { playback.pauseCalls += 1; };
	engine.getAudioContext = async () => ({
		destination: {},
		async resume() {},
		createBuffer: (channelCount, frameCount, sampleRate) => (
			new MockAudioBuffer(channelCount, frameCount, sampleRate)
		),
		createBufferSource: () => ({
			buffer: null,
			onended: null,
			connect() {},
			disconnect() {},
			start() {
				playback.buffer = this.buffer;
				playback.starts += 1;
			},
			stop() { playback.stops += 1; },
		}),
	});
	return engine;
}

export class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel) { return this.channels[channel]; }
	copyToChannel(values, channel, offset = 0) { this.channels[channel].set(values, offset); }
}

export async function storedChannel(store, sourceId, channel) {
	const metadata = await store.getSourceMetadata(sourceId);
	const output = new Float32Array(metadata.frameCount);
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		output.set(chunk.channels[channel], offset);
		offset += chunk.frames;
	}
	return output;
}
