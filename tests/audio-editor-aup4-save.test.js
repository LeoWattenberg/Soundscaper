import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const assetLoader = `
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

const { createAudioEditorController } = await import('../src/lib/tools/audio-editor/app.js');
const { createProjectStore } = await import('../src/lib/tools/audio-editor/storage.js');

const SOURCE_CHUNK_FRAMES = 65_536;

test('AUP4 save lazily reads one referenced source at a time and reserves only the largest source as working memory', async () => {
	const store = createTestStore('aup4-lazy-source-save');
	const readEvents = observeSourceReads(store);
	const clientCalls = [];
	let maximumConcurrentReads = 0;
	let concurrentReads = 0;
	readEvents.onStart = () => {
		concurrentReads += 1;
		maximumConcurrentReads = Math.max(maximumConcurrentReads, concurrentReads);
	};
	readEvents.onEnd = () => { concurrentReads -= 1; };
	const savedFiles = [];
	const aup4Client = {
		initializeCalls: 0,
		async initialize() {
			this.initializeCalls += 1;
			clientCalls.push('initialize');
			return { opfs: false };
		},
		async create(projectId) { clientCalls.push(['create', projectId]); },
		async writeSnapshot(projectId, project, sources, options) {
			clientCalls.push(['writeSnapshot', projectId]);
			assert.equal(Array.isArray(sources), false);
			assert.equal(typeof sources?.[Symbol.asyncIterator], 'function');
			assert.deepEqual(readEvents.values, [], 'no persisted PCM is loaded before the consumer asks for it');
			assert.equal(options.workingBytes, 24);

			const iterator = sources[Symbol.asyncIterator]();
			const first = await iterator.next();
			assert.equal(first.done, false);
			assert.equal(first.value.sourceId, 'source-a');
			assert.equal(first.value.sampleRate, 48_000);
			assert.deepEqual(
				first.value.channels.map((channel) => Array.from(channel)),
				[Array.from(Float32Array.of(0.1, 0.2, 0.3, 0.4))],
			);
			assert.deepEqual(readEvents.values.map(eventLabel), [
				'start:source-a',
				'chunk:source-a',
				'end:source-a',
			]);

			const second = await iterator.next();
			assert.equal(second.done, false);
			assert.equal(second.value.sourceId, 'source-b');
			assert.deepEqual(second.value.channels.map((channel) => Array.from(channel)), [
				Array.from(Float32Array.of(-0.1, -0.2, -0.3)),
				Array.from(Float32Array.of(0.5, 0.6, 0.7)),
			]);
			assert.deepEqual(readEvents.values.map(eventLabel), [
				'start:source-a',
				'chunk:source-a',
				'end:source-a',
				'start:source-b',
				'chunk:source-b',
				'end:source-b',
			]);
			assert.deepEqual(await iterator.next(), { value: undefined, done: true });
			assert.deepEqual(project.sources.map((source) => source.id), ['source-a', 'source-b']);
			return { sourceCount: 2 };
		},
		async commit(projectId) { clientCalls.push(['commit', projectId]); },
		async export(projectId, options) {
			clientCalls.push(['export', projectId]);
			assert.equal(options.workingBytes, 24);
			return {
				bytes: Uint8Array.of(0x41, 0x55, 0x50, 0x34),
				mimeType: 'application/x-audacity-project',
			};
		},
		async inspect(projectId) {
			clientCalls.push(['inspect', projectId]);
			return { valid: true };
		},
		dispose() { clientCalls.push('dispose'); },
	};
	const controller = createTestController({
		store,
		aup4Client,
		fileService: {
			isDesktop: false,
			async saveFile(request) {
				savedFiles.push(request);
				return { method: 'test-file', fileName: request.suggestedName, size: request.blob.size };
			},
		},
	});

	try {
		await controller.ready;
		await addStoredSources(controller, store, [
			{ id: 'source-a', channels: [Float32Array.of(0.1, 0.2, 0.3, 0.4)] },
			{ id: 'source-b', channels: [Float32Array.of(-0.1, -0.2, -0.3), Float32Array.of(0.5, 0.6, 0.7)] },
			{ id: 'source-unused', channels: [new Float32Array(10)], referenced: false },
		]);

		const result = await controller.actions.project.saveAup4({
			fileName: 'lazy-sources',
			useFileSystemAccess: false,
		});

		assert.deepEqual(result, {
			method: 'test-file',
			fileName: 'lazy-sources.aup4',
			size: 4,
			validation: { valid: true },
		});
		assert.equal(maximumConcurrentReads, 1);
		assert.equal(readEvents.values.some((event) => event.sourceId === 'source-unused'), false);
		assert.equal(aup4Client.initializeCalls, 1);
		assert.equal(savedFiles.length, 1);
		assert.equal(savedFiles[0].blob.size, 4);
		assert.deepEqual(clientCalls.map((call) => Array.isArray(call) ? call[0] : call), [
			'initialize',
			'create',
			'writeSnapshot',
			'commit',
			'export',
			'inspect',
		]);
		assert.equal(controller.getSnapshot().save.state, 'saved');
	} finally {
		await controller.dispose();
	}
});

test('AUP4 save preflights the combined referenced source bytes instead of the per-source working maximum', async () => {
	const store = createTestStore('aup4-total-source-preflight');
	store.estimateStorage = async () => ({ usage: 0, quota: 70 });
	let writeSnapshotCalls = 0;
	const aup4Client = {
		async initialize() { return { opfs: false }; },
		async create() {},
		async writeSnapshot() { writeSnapshotCalls += 1; },
		dispose() {},
	};
	const controller = createTestController({ store, aup4Client });

	try {
		await controller.ready;
		await addStoredSources(controller, store, [
			{ id: 'quota-a', channels: [new Float32Array(10)] },
			{ id: 'quota-b', channels: [new Float32Array(10)] },
		]);

		await assert.rejects(
			controller.actions.project.saveAup4({ useFileSystemAccess: false }),
			/Not enough local storage for export/,
		);
		assert.equal(writeSnapshotCalls, 0);
	} finally {
		await controller.dispose();
	}
});

function createTestController(options) {
	return createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		sourceBufferCacheMaxBytes: 0,
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
		fileService: {
			isDesktop: false,
			async saveFile(request) {
				return { method: 'test-file', fileName: request.suggestedName, size: request.blob.size };
			},
		},
		...options,
	});
}

function createTestEngine() {
	return {
		setSourceResolver() { return this; },
		loadProject() {},
		async applyProject() {},
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		getPositionFrames() { return 0; },
		stop() {},
		async dispose() {},
	};
}

function createTestStore(label) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		storageManager: null,
		databaseName: `${label}-${Date.now()}-${Math.random()}`,
	});
}

async function addStoredSources(controller, store, fixtures) {
	const sources = [];
	for (const fixture of fixtures) {
		const channelCount = fixture.channels.length;
		const frameCount = fixture.channels[0].length;
		const writer = await store.beginSourceWrite(fixture.id, {
			name: `${fixture.id}.wav`,
			mimeType: 'audio/wav',
			sampleRate: 48_000,
			channelCount,
		});
		await writer.write(fixture.channels);
		await writer.commit({ sampleRate: 48_000, channelCount, chunkFrames: SOURCE_CHUNK_FRAMES });
		sources.push({
			id: fixture.id,
			name: `${fixture.id}.wav`,
			mimeType: 'audio/wav',
			storageKey: fixture.id,
			frameCount,
			channelCount,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES,
			referenced: fixture.referenced !== false,
		});
	}
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			...sources.map(({ referenced: _referenced, ...source }) => ({ type: 'source/add', source })),
			...sources.filter((source) => source.referenced).map((source, index) => ({
				type: 'clip/add',
				trackId,
				clip: {
					id: `clip-${source.id}`,
					sourceId: source.id,
					title: source.name,
					timelineStartFrame: index * source.frameCount,
					sourceStartFrame: 0,
					sourceDurationFrames: source.frameCount,
					durationFrames: source.frameCount,
				},
			})),
		],
	});
}

function observeSourceReads(store) {
	const values = [];
	const observations = { values, onStart: null, onEnd: null };
	const readSourceChunks = store.readSourceChunks.bind(store);
	store.readSourceChunks = async function* observedReadSourceChunks(sourceId) {
		values.push({ type: 'start', sourceId });
		observations.onStart?.(sourceId);
		try {
			for await (const chunk of readSourceChunks(sourceId)) {
				values.push({ type: 'chunk', sourceId });
				yield chunk;
			}
		} finally {
			values.push({ type: 'end', sourceId });
			observations.onEnd?.(sourceId);
		}
	};
	return observations;
}

function eventLabel(event) {
	return `${event.type}:${event.sourceId}`;
}
