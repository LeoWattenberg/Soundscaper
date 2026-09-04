/* SPDX-License-Identifier: AGPL-3.0-only */

// Multi-track project fixtures the selection effect suites share. Split out of
// audio-editor-multitrack-selection-effects.test.js so its suites can sit in
// separate files.

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

export async function createTwoTrackFixture(prefix, inputs, sampleRate, spectrogram = false) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${prefix}-${Date.now()}-${Math.random()}`,
	});
	for (const [trackId, input] of inputs) {
		const writer = await store.beginSourceWrite(`${trackId}-source`, {
			name: `${trackId}.wav`, mimeType: 'audio/wav', sampleRate, channelCount: 1,
		});
		await writer.write([input]);
		await writer.commit({ sampleRate, channelCount: 1 });
	}
	const project = createCurrentAudioEditorProject({
		id: `${prefix}-project`,
		title: 'Multitrack effect project',
		now: '2026-07-15T00:00:00.000Z',
		sampleRate,
		sources: [...inputs].map(([trackId, input]) => ({
			id: `${trackId}-source`,
			name: `${trackId}.wav`,
			mimeType: 'audio/wav',
			storageKey: `${trackId}-source`,
			frameCount: input.length,
			channelCount: 1,
			sampleRate,
			originalSampleRate: sampleRate,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		})),
		tracks: [...inputs].map(([trackId]) => ({
			type: 'audio',
			id: trackId,
			name: trackId,
			clipIds: [`${trackId}-clip`],
			...(spectrogram ? { displayMode: 'spectrogram', spectrogram: { windowSize: 1_024 } } : {}),
		})),
		clips: [...inputs].map(([trackId, input]) => ({
			id: `${trackId}-clip`,
			sourceId: `${trackId}-source`,
			title: trackId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: input.length,
			durationFrames: input.length,
		})),
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	return { store, project };
}

export function createController(store, renderSnapshot) {
	return createAudioEditorController(null, {
		headless: true,
		copy: ENGLISH_COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot,
	});
}

export function twoTone(frameCount, sampleRate, lowAmplitude, highAmplitude) {
	return Float32Array.from({ length: frameCount }, (_, frame) => (
		lowAmplitude * Math.sin(2 * Math.PI * 512 * frame / sampleRate)
		+ highAmplitude * Math.sin(2 * Math.PI * 2_048 * frame / sampleRate)
	));
}

export function expandFixtureSamples(values) {
	return Float32Array.from({ length: values.length * 800 }, (_, frame) => values[Math.floor(frame / 800)]);
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

export async function storedSample(store, sourceId, frame) {
	return (await storedChannel(store, sourceId, 0))[frame];
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

export function toneAmplitude(samples, frequency, sampleRate, start, end) {
	let sine = 0;
	let cosine = 0;
	for (let frame = start; frame < end; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		sine += samples[frame] * Math.sin(angle);
		cosine += samples[frame] * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / (end - start);
}
