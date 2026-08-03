/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const previousWorker = globalThis.Worker;
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

test.after(() => {
	if (previousWorker === undefined) delete globalThis.Worker;
	else globalThis.Worker = previousWorker;
});

const { createAudioEditorController } = await import('../src/common/editor/app.js');

const SOURCE_CHUNK_FRAMES = 65_536;
const LONG_SOURCE_FRAMES = (32 * 1024 * 1024 / Float32Array.BYTES_PER_ELEMENT) + 1;

test('controller disposal releases an opened long-source session after the engine and before storage', async () => {
	const events = [];
	const store = new SessionStore(events);
	const engine = new SessionEngine(events);
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		store,
		engine,
		ffmpeg: { dispose() {} },
		clipTimePitchCache: {
			createEngineSourceResolver: () => () => null,
			retainClipIds() {},
			getProtectedSourceIds: () => new Set(),
			dispose() {},
		},
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});

	await controller.ready;
	await controller.actions.project.importFiles([{
		name: 'session-owned.wav',
		type: 'audio/wav',
		size: 1,
		async arrayBuffer() { return new ArrayBuffer(1); },
	}]);
	const sourceId = controller.getSnapshot().project.sources[0].id;
	await engine.chunkSources.get(sourceId).readStorageChunk(0);
	await controller.dispose();

	assert.deepEqual(events, ['session:open', 'engine:dispose', 'session:release', 'store:close']);
});

test('controller disposal awaits tracked render engines before releasing source providers', async () => {
	const events = [];
	const store = new SessionStore(events);
	const engine = new SessionEngine(events);
	const renderDisposalStarted = deferred(), renderDisposalGate = deferred();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', store, engine, ffmpeg: { dispose() {} },
		engineFactory: () => new SessionRenderEngine(events, renderDisposalStarted, renderDisposalGate),
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});
	await controller.ready;
	await controller.actions.project.importFiles([longWavFile('render-owned.wav')]);
	const sourceId = controller.getSnapshot().project.sources[0].id;
	await engine.chunkSources.get(sourceId).readStorageChunk(0);
	const exporting = controller.actions.export.start({ format: 'wav', bitDepth: 16 }).catch(() => undefined);
	await renderDisposalStarted.promise;
	const disposal = controller.dispose();
	await nextTurn();
	assert.equal(events.includes('session:release'), false);
	assert.equal(events.includes('store:close'), false);
	renderDisposalGate.resolve();
	await Promise.all([exporting, disposal]);
	assert.ok(events.indexOf('render:dispose:done') < events.indexOf('session:release'));
	assert.ok(events.indexOf('session:release') < events.indexOf('store:close'));
});

test('render-engine cleanup failure fences source-provider retirement and storage close', async () => {
	const events = [];
	const store = new SessionStore(events);
	const engine = new SessionEngine(events);
	const renderDisposalStarted = deferred();
	const failure = new Error('render cleanup failed');
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', store, engine, ffmpeg: { dispose() {} },
		engineFactory: () => new SessionRenderEngine(events, renderDisposalStarted, null, failure),
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});
	await controller.ready;
	await controller.actions.project.importFiles([longWavFile('failed-render-owned.wav')]);
	const sourceId = controller.getSnapshot().project.sources[0].id;
	await engine.chunkSources.get(sourceId).readStorageChunk(0);
	const exporting = controller.actions.export.start({ format: 'wav', bitDepth: 16 }).catch(() => undefined);
	await renderDisposalStarted.promise;
	await exporting;
	await assert.rejects(controller.dispose(), (error) => error === failure
		|| (error instanceof AggregateError && error.errors.every((candidate) => candidate === failure)));
	assert.equal(events.includes('session:release'), false);
	assert.equal(events.includes('store:close'), false);
});

test('Project Bin preview cleanup failure fences source-provider retirement and storage close', async () => {
	const events = [];
	const store = new SessionStore(events);
	const engine = new SessionEngine(events);
	const failure = new Error('preview cleanup failed');
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', store, engine, ffmpeg: { dispose() {} },
		engineFactory: (options) => options.onState
			? new FailingPreviewEngine(failure)
			: new SessionRenderEngine(events, deferred(), null),
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});
	await controller.ready;
	await controller.actions.project.importFiles([longWavFile('preview-owned.wav')]);
	const snapshot = controller.getSnapshot(), sourceId = snapshot.project.sources[0].id;
	await engine.chunkSources.get(sourceId).readStorageChunk(0);
	const clipId = snapshot.project.clips[0].id;
	controller.actions.projectBin.moveFromTimeline(clipId);
	await controller.actions.projectBin.playPause(clipId);
	await assert.rejects(controller.dispose(), (error) => error === failure);
	assert.equal(events.includes('session:release'), false);
	assert.equal(events.includes('store:close'), false);
});

function longWavFile(name) {
	return { name, type: 'audio/wav', size: 1, async arrayBuffer() { return new ArrayBuffer(1); } };
}

function deferred() {
	let resolve = () => undefined;
	const promise = new Promise((complete) => { resolve = complete; });
	return { promise, resolve };
}

function nextTurn() {
	return new Promise((resolve) => { setImmediate(resolve); });
}

class SessionStore {
	constructor(events) {
		this.events = events;
		this.projects = new Map();
		this.settings = new Map();
		this.sources = new Map();
	}

	async ready() { return this; }
	async cleanupTemporaryAssets() {}
	async requestPersistentStorage() { return false; }
	async loadSetting(key, fallback) { return this.settings.has(key) ? this.settings.get(key) : fallback; }
	async saveSetting(key, value) { this.settings.set(key, structuredClone(value)); }
	async saveProject(project) { this.projects.set(project.id, structuredClone(project)); return project; }
	async loadProject(projectId) { return structuredClone(this.projects.get(projectId) || null); }
	async listProjects() { return [...this.projects.values()].map((project) => structuredClone(project)); }
	async loadAnalysis() { return null; }
	async saveAnalysis() {}
	async deleteAnalysis() {}
	async estimateStorage() { return { usage: 0, quota: 1024 * 1024 * 1024 }; }
	async pruneUnreferencedSources() { return { deletedSourceIds: [] }; }

	async beginSourceWrite(sourceId, options = {}) {
		const store = this;
		let framesWritten = 0;
		return {
			get framesWritten() { return framesWritten; },
			async write(channels) { framesWritten += channels[0].length; },
			async commit(extra = {}) {
				const metadata = Object.freeze({
					id: sourceId,
					name: extra.name || options.name || sourceId,
					mimeType: extra.mimeType || options.mimeType || 'audio/wav',
					sampleRate: extra.sampleRate || options.sampleRate || 48_000,
					channelCount: extra.channelCount || options.channelCount || 1,
					frameCount: framesWritten,
					frameLength: framesWritten,
					chunkFrames: SOURCE_CHUNK_FRAMES,
					chunkCount: Math.ceil(framesWritten / SOURCE_CHUNK_FRAMES),
				});
				store.sources.set(sourceId, metadata);
				return metadata;
			},
			async abort() {},
		};
	}

	async getSourceMetadata(sourceId) { return this.sources.get(sourceId) || null; }
	async readSourceChunk(sourceId, index) {
		const metadata = this.sources.get(sourceId);
		if (!metadata) throw new Error(`Missing source ${sourceId}.`);
		const frames = index === metadata.chunkCount - 1
			? metadata.frameCount - index * metadata.chunkFrames
			: metadata.chunkFrames;
		return { index, frames, channels: [new Float32Array(frames)] };
	}

	async openSourceReadSession(sourceId) {
		this.events.push('session:open');
		return {
			chunk: (index) => this.readSourceChunk(sourceId, index),
			release: async () => { this.events.push('session:release'); },
		};
	}

	async close() { this.events.push('store:close'); }
}

class SessionEngine {
	constructor(events) {
		this.events = events;
		this.chunkSources = new Map();
	}

	setSourceResolver() { return this; }
	setChunkSources(sources = new Map()) { this.chunkSources = new Map(sources); return this; }
	loadProject(_project, _buffers = new Map(), options = {}) {
		if (options.chunkSources !== undefined) this.setChunkSources(options.chunkSources);
	}
	async applyProject(project, buffers, options) { this.loadProject(project, buffers, options); }
	async decodeAudioData() { return logicalAudioBuffer(LONG_SOURCE_FRAMES); }
	async getAudioContext() {
		return {
			sampleRate: 48_000,
			currentTime: 0,
			baseLatency: 0,
			outputLatency: 0,
			async resume() {},
			createBuffer: (channelCount, frameCount, sampleRate) => ({
				numberOfChannels: channelCount,
				length: frameCount,
				sampleRate,
				getChannelData: () => new Float32Array(frameCount),
			}),
		};
	}
	getState() { return { state: 'stopped', loop: { enabled: false } }; }
	getPositionFrames() { return 0; }
	stop() {}
	async dispose() { this.events.push('engine:dispose'); }
}

class SessionRenderEngine {
	constructor(events, disposalStarted, disposalGate, disposalFailure = null) {
		this.events = events;
		this.disposalStarted = disposalStarted;
		this.disposalGate = disposalGate;
		this.disposalFailure = disposalFailure;
	}

	setSourceResolver() { return this; }
	setChunkSources() { return this; }
	loadProject() {}
	async renderMix() { return pcmAudioBuffer(48_000); }
	async dispose() {
		this.events.push('render:dispose:start');
		this.disposalStarted.resolve();
		if (this.disposalGate) await this.disposalGate.promise;
		if (this.disposalFailure) throw this.disposalFailure;
		this.events.push('render:dispose:done');
	}
}

class FailingPreviewEngine {
	constructor(failure) { this.failure = failure; }
	setSourceResolver() { return this; }
	loadProject() {}
	async play() {}
	stop() {}
	async dispose() { throw this.failure; }
}

function pcmAudioBuffer(frameCount) {
	const channel = new Float32Array(frameCount);
	return { numberOfChannels: 1, length: frameCount, sampleRate: 48_000, getChannelData: () => channel };
}

function logicalAudioBuffer(frameCount) {
	const channel = {
		length: frameCount,
		buffer: new ArrayBuffer(0),
		slice(start = 0, end = frameCount) {
			return { ...this, length: Math.max(0, Math.min(frameCount, end) - Math.max(0, start)) };
		},
	};
	return {
		numberOfChannels: 1,
		length: frameCount,
		sampleRate: 48_000,
		getChannelData: () => channel,
	};
}
