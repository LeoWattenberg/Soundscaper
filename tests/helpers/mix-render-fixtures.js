/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Store, project and engine fixtures for the mix-and-render integration matrix.
 *
 * The suite registers an asset loader before it reaches any editor module, so
 * this helper resolves its own imports at evaluation time and is itself
 * imported dynamically once that loader is in place.
 */

const { createProjectStore } = await import('../../src/common/editor/storage.js');

export function createTestStore(suffix) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `audio-editor-mix-render-${suffix}-${Date.now()}-${Math.random()}`,
	});
}

export function observeMixedSourceWrites(store) {
	const sourceIds = [];
	const beginSourceWrite = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = async (sourceId, metadata) => {
		if (String(sourceId).startsWith('mixed-source')) sourceIds.push(sourceId);
		return beginSourceWrite(sourceId, metadata);
	};
	return sourceIds;
}

export async function writeSource(store, id, channels) {
	const writer = await store.beginSourceWrite(id, {
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: channels.length,
	});
	await writer.write(channels);
	await writer.commit({ sampleRate: 48_000, channelCount: channels.length });
}

export function source(id, frameCount, channelCount = 1) {
	return {
		id,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		storageKey: id,
		frameCount,
		channelCount,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	};
}

export function clip(id, sourceId, timelineStartFrame, durationFrames) {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: durationFrames,
		durationFrames,
	};
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
				createBuffer(channelCount, length, sampleRate) {
					return audioBuffer(Array.from(
						{ length: channelCount },
						() => new Float32Array(length),
					), sampleRate);
				},
			};
		},
		async dispose() {},
	};
}

export async function storedSample(store, sourceId, channel, frame) {
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		if (frame < offset + chunk.frames) return chunk.channels[channel][frame - offset];
		offset += chunk.frames;
	}
	throw new RangeError(`Source ${sourceId} does not contain frame ${frame}.`);
}
