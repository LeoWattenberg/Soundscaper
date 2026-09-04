/* SPDX-License-Identifier: AGPL-3.0-only */

// Storage fixtures the disk-backed source suites share: the bounded store each
// import and recording is written through, and the helpers that read chunks back.
// Split out of audio-editor-disk-backed-sources.test.js so its suites can sit in
// separate files.

import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

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

export const previousWorker = globalThis.Worker;

globalThis.Worker = class ImmediateAnalysisWorker {
	postMessage(message) {
		const data = message.type === 'start'
			? { type: 'ready' }
			: message.type === 'chunk'
				? { type: 'ack' }
				: { type: 'result', levels: [] };
		queueMicrotask(() => this.onmessage?.({ data }));
	}

	terminate() {}
};

/** Restore whatever Worker the calling test file replaced when it finishes. */
export function restoreWorkerAfterSuite() {
	test.after(() => {
		if (previousWorker === undefined) delete globalThis.Worker;
		else globalThis.Worker = previousWorker;
	});
}

export const { createAudioEditorController } = await import('../../src/common/editor/app.js');

export const SOURCE_CHUNK_FRAMES = 65_536;

export const LONG_MONO_SOURCE_FRAMES = (32 * 1024 * 1024 / Float32Array.BYTES_PER_ELEMENT) + 1;

export const LONG_STEREO_SOURCE_FRAMES = (32 * 1024 * 1024 / (2 * Float32Array.BYTES_PER_ELEMENT)) + 1;

export function createTestController(options) {
	return createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		ffmpeg: { dispose() {} },
		...options,
	});
}

export function audioFile(name) {
	return {
		name,
		type: 'audio/wav',
		size: 1,
		async arrayBuffer() { return new ArrayBuffer(1); },
	};
}

export function encodedAudioFile(name, type, bytes) {
	return {
		name,
		type,
		size: bytes.byteLength,
		async arrayBuffer() {
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
	};
}

export function virtualPcm16Wav(frameCount, channelCount = 1) {
	const blockAlign = channelCount * 2;
	const dataBytes = frameCount * blockAlign;
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	writeAscii(header, 0, 'RIFF');
	view.setUint32(4, header.byteLength + dataBytes - 8, true);
	writeAscii(header, 8, 'WAVE');
	writeAscii(header, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, 48_000, true);
	view.setUint32(28, 48_000 * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 16, true);
	writeAscii(header, 36, 'data');
	view.setUint32(40, dataBytes, true);
	const file = {
		name: 'large-streamed.wav',
		type: 'audio/wav',
		size: header.byteLength + dataBytes,
		reads: [],
		arrayBufferCalls: 0,
		async arrayBuffer() {
			file.arrayBufferCalls += 1;
			throw new Error('The incremental importer must not read the complete WAV file.');
		},
		slice(start = 0, end = file.size) {
			const from = Math.max(0, Math.min(file.size, Math.floor(start)));
			const to = Math.max(from, Math.min(file.size, Math.floor(end)));
			return {
				async arrayBuffer() {
					const bytes = new Uint8Array(to - from);
					const headerStart = Math.min(header.byteLength, from);
					const headerEnd = Math.min(header.byteLength, to);
					if (headerEnd > headerStart) bytes.set(header.subarray(headerStart, headerEnd), headerStart - from);
					file.reads.push({ start: from, end: to, byteLength: bytes.byteLength });
					return bytes.buffer;
				},
			};
		},
	};
	return file;
}

export function writeAscii(bytes, offset, value) {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

export function realAudioBuffer(frameCount, value = 0) {
	const channel = new Float32Array(frameCount).fill(value);
	return {
		numberOfChannels: 1,
		length: frameCount,
		sampleRate: 48_000,
		getChannelData() { return channel; },
	};
}

export function logicalAudioBuffer({ frameCount, channelCount = 1, sampleRate = 48_000 }) {
	const channels = Array.from({ length: channelCount }, () => logicalChannel(frameCount));
	return {
		numberOfChannels: channelCount,
		length: frameCount,
		sampleRate,
		getChannelData(channel) { return channels[channel]; },
	};
}

export function logicalChannel(length) {
	return {
		length,
		buffer: new ArrayBuffer(0),
		slice(start = 0, end = length) {
			const from = Math.max(0, Math.min(length, Number(start) || 0));
			const to = Math.max(from, Math.min(length, end == null ? length : Number(end) || 0));
			return logicalChannel(to - from);
		},
	};
}

export class LogicalPcmStore {
	constructor({ nextWriterFrameCount = null } = {}) {
		this.projects = new Map();
		this.settings = new Map();
		this.analysis = new Map();
		this.sources = new Map();
		this.nextWriterFrameCount = nextWriterFrameCount;
		this.loadSourceAudioBufferCalls = 0;
		this.readSourceChunkCalls = [];
		this.sourceWriteCalls = [];
	}

	async ready() { return this; }
	async cleanupTemporaryAssets() {}
	async requestPersistentStorage() { return false; }
	async loadSetting(key, fallback) { return this.settings.has(key) ? this.settings.get(key) : fallback; }
	async saveSetting(key, value) { this.settings.set(key, structuredClone(value)); }
	async saveProject(project) { this.projects.set(project.id, structuredClone(project)); return project; }
	async loadProject(projectId) { return structuredClone(this.projects.get(projectId) || null); }
	async listProjects() { return [...this.projects.values()].map((project) => structuredClone(project)); }
	async deleteProject(projectId) { return this.projects.delete(projectId); }
	async loadAnalysis(key) { return this.analysis.get(key) || null; }
	async saveAnalysis(key, value) { this.analysis.set(key, value); }
	async deleteAnalysis(key) { return this.analysis.delete(key); }
	async estimateStorage() { return { usage: 0, quota: 1024 * 1024 * 1024 * 1024 }; }
	async pruneUnreferencedSources() { return { deletedSourceIds: [], retainedSourceIds: [...this.sources.keys()] }; }

	async beginSourceWrite(sourceId, options = {}) {
		const store = this;
		const record = {
			id: sourceId,
			options: { ...options },
			writtenFrames: 0,
			frameCountOverride: this.nextWriterFrameCount,
			aborted: false,
		};
		this.nextWriterFrameCount = null;
		return {
			get framesWritten() { return record.frameCountOverride ?? record.writtenFrames; },
			async write(channels) {
				assert.ok(Array.isArray(channels) && channels.length > 0);
				store.sourceWriteCalls.push({
					sourceId,
					channelCount: channels.length,
					frameCount: channels[0].length,
				});
				record.writtenFrames += channels[0].length;
			},
			async commit(extra = {}) {
				const frameCount = record.frameCountOverride ?? record.writtenFrames;
				const chunkFrames = SOURCE_CHUNK_FRAMES;
				const metadata = Object.freeze({
					id: sourceId,
					storage: 'logical-test-chunks',
					name: extra.name || options.name || sourceId,
					mimeType: extra.mimeType || options.mimeType || 'audio/wav',
					sampleRate: extra.sampleRate || options.sampleRate || 48_000,
					channelCount: extra.channelCount || options.channelCount || 1,
					frameCount,
					frameLength: frameCount,
					chunkFrames,
					chunkCount: Math.ceil(frameCount / chunkFrames),
				});
				store.sources.set(sourceId, metadata);
				return metadata;
			},
			async abort() { record.aborted = true; },
		};
	}

	async getSourceMetadata(sourceId) { return this.sources.get(sourceId) || null; }
	async listSources() { return [...this.sources.values()]; }
	async deleteSource(sourceId) { return this.sources.delete(sourceId); }

	async *readSourceChunks(sourceId) {
		const metadata = this.sources.get(sourceId);
		if (!metadata) throw new Error(`Source ${sourceId} could not be found.`);
		for (let index = 0; index < metadata.chunkCount; index += 1) {
			yield syntheticChunk(metadata, index);
		}
	}

	async readSourceChunk(sourceId, index) {
		this.readSourceChunkCalls.push({ sourceId, index });
		const metadata = this.sources.get(sourceId);
		if (!metadata) throw new Error(`Source ${sourceId} could not be found.`);
		return syntheticChunk(metadata, index);
	}

	async loadSourceAudioBuffer(sourceId) {
		this.loadSourceAudioBufferCalls += 1;
		const metadata = this.sources.get(sourceId);
		if (!metadata) throw new Error(`Source ${sourceId} could not be found.`);
		return logicalAudioBuffer({
			frameCount: metadata.frameCount,
			channelCount: metadata.channelCount,
			sampleRate: metadata.sampleRate,
		});
	}

	async close() {}
}

export function syntheticChunk(metadata, index) {
	if (!Number.isSafeInteger(index) || index < 0 || index >= metadata.chunkCount) {
		throw new RangeError(`Chunk ${index} is outside source ${metadata.id}.`);
	}
	const frames = index === metadata.chunkCount - 1
		? metadata.frameCount - index * metadata.chunkFrames
		: metadata.chunkFrames;
	return {
		index,
		frames,
		channels: Array.from({ length: metadata.channelCount }, () => new Float32Array(frames)),
	};
}

export class ControllerEngine {
	constructor({ decoded = [] } = {}) {
		this.decoded = [...decoded];
		this.decodeCalls = 0;
		this.state = 'stopped';
		this.positionFrame = 0;
		this.project = null;
		this.sourceBuffers = new Map();
		this.chunkSources = new Map();
		this.lastPlayedSourceId = null;
		this.lastPlaybackSourceKind = null;
	}

	setSourceResolver(resolver) { this.sourceResolver = resolver; return this; }
	setChunkSources(sources = new Map()) { this.chunkSources = new Map(sources); return this; }

	loadProject(project, sourceBuffers = new Map(), options = {}) {
		this.#apply(project, sourceBuffers, options);
	}

	async applyProject(project, sourceBuffers = this.sourceBuffers, options = {}) {
		this.#apply(project, sourceBuffers, options);
	}

	#apply(project, sourceBuffers, options) {
		this.project = structuredClone(project);
		this.sourceBuffers = new Map(sourceBuffers);
		if (options.chunkSources !== undefined) this.setChunkSources(options.chunkSources);
	}

	async decodeAudioData() {
		this.decodeCalls += 1;
		const decoded = this.decoded.shift();
		if (!decoded) throw new Error('No decoded fixture remains.');
		return decoded;
	}

	async getAudioContext() {
		return {
			sampleRate: 48_000,
			currentTime: 0,
			baseLatency: 0,
			outputLatency: 0,
			async resume() {},
			createBuffer: (channelCount, frameCount, sampleRate) => logicalAudioBuffer({ channelCount, frameCount, sampleRate }),
		};
	}

	getPositionFrames() { return this.positionFrame; }
	getState() { return { state: this.state, loop: { enabled: false } }; }
	stop() { this.state = 'stopped'; }
	pause() { this.state = 'paused'; }
	seek(frame) { this.positionFrame = frame; return frame; }
	setLoop() {}
	async playAt(_contextTime, frame) { this.positionFrame = frame; this.state = 'playing'; }

	async play() {
		const clip = this.project?.clips[0];
		this.lastPlayedSourceId = clip?.sourceId || null;
		if (clip && this.sourceBuffers.has(clip.sourceId)) {
			this.lastPlaybackSourceKind = 'audio-buffer';
		} else if (clip && this.chunkSources.has(clip.sourceId)) {
			this.lastPlaybackSourceKind = 'chunk-provider';
			await this.chunkSources.get(clip.sourceId).readStorageChunk(0);
		} else {
			throw new Error(`Source ${clip?.sourceId || 'unknown'} is unavailable.`);
		}
		this.state = 'playing';
	}

	async dispose() {}
}

export function createRecordingHarness() {
	const track = {
		kind: 'audio',
		readyState: 'live',
		getSettings: () => ({ channelCount: 1, sampleRate: 48_000 }),
		addEventListener() {},
		removeEventListener() {},
		stop() { this.readyState = 'ended'; },
	};
	const stream = {
		getTracks: () => [track],
		getAudioTracks: () => [track],
	};
	let open = false;
	const capturePool = {
		getHardware: () => open ? stream : null,
		async acquireHardware() { open = true; return stream; },
		getSnapshot: () => open ? [{ key: 'device:default', kind: 'device', channelCount: 1, state: 'open' }] : [],
		releaseAll() { open = false; return 1; },
		dispose() { open = false; },
	};
	const harness = {
		capturePool,
		options: null,
		factory: async (options) => {
			harness.options = options;
			let state = 'ready';
			return {
				get state() { return state; },
				start() { state = 'recording'; },
				async stop() { state = 'stopped'; },
				async dispose() { state = 'disposed'; },
				setMonitoring() {},
				setInputGain() {},
			};
		},
	};
	return harness;
}

export async function settleController() {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
}
