import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');

const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	projectDirty: 'Unsaved',
	storage: 'Storage',
	genericError: 'Error: {message}',
	unknownError: 'Unknown error',
});

test('disposal during bootstrap is terminal and late readiness cannot acquire resources', async () => {
	const readyGate = deferred();
	const store = createStore({ ready: () => readyGate.promise });
	const engine = createEngine();
	let lockAcquisitions = 0;
	let deviceListeners = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine,
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createCache(),
		mediaDevices: {
			addEventListener() { deviceListeners += 1; },
			removeEventListener() { deviceListeners -= 1; },
		},
		acquireProjectLock: async () => {
			lockAcquisitions += 1;
			return { projectId: 'late', readOnly: false, method: 'test', release() {} };
		},
	});

	await controller.dispose();
	readyGate.resolve(store);
	const readySnapshot = await controller.ready;

	assert.equal(readySnapshot.phase, 'disposed');
	assert.equal(controller.getSnapshot().phase, 'disposed');
	assert.equal(engine.loadedProjects.length, 0);
	assert.equal(lockAcquisitions, 0);
	assert.equal(deviceListeners, 0);
	assert.equal(store.closeCalls, 1);
	assert.throws(() => controller.actions.project.create(), { code: 'DISPOSED' });
});

test('disposal flushes the latest writable project before closing storage', async () => {
	const store = createStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine: createEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createCache(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;

	controller.actions.track.update(trackId, { name: 'Latest unsaved edit' });
	await controller.dispose();

	const saved = store.projects.get(controller.getSnapshot().project.id);
	assert.equal(saved.tracks[0].name, 'Latest unsaved edit');
	assert.equal(store.closeCalls, 1);
});

test('analysis finishing after a project switch cannot publish or persist stale results', async () => {
	const renderGate = deferred();
	const renderStarted = deferred();
	const store = createStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine: createEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createCache(),
		renderSnapshot: async () => {
			renderStarted.resolve();
			return renderGate.promise;
		},
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'analysis-source',
				name: 'analysis.wav',
				storageKey: 'analysis-source',
				mimeType: 'audio/wav',
				frameCount: 4,
				channelCount: 1,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'analysis-clip',
				sourceId: 'analysis-source',
				title: 'Analysis',
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				sourceDurationFrames: 4,
				durationFrames: 4,
			},
		}],
	});

	const analysis = controller.actions.analysis.run();
	await renderStarted.promise;
	const previousProjectId = controller.getSnapshot().project.id;
	const projectSwitch = controller.actions.project.create({ title: 'Replacement' });
	renderGate.resolve(createAudioBuffer());
	await Promise.all([analysis, projectSwitch]);

	assert.notEqual(controller.getSnapshot().project.id, previousProjectId);
	assert.equal(controller.getSnapshot().analysis, null);
	assert.equal(store.analysisWrites.length, 0);
	await controller.dispose();
});

test('an export published after a project switch is cleaned up without becoming current output', async () => {
	const publishStarted = deferred();
	const publishGate = deferred();
	let publishedCleanupCalls = 0;
	const store = createStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine: createEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createCache(),
		renderSnapshot: async () => createAudioBuffer(2),
		fileService: {
			isDesktop: false,
			async createDownload() {
				publishStarted.resolve();
				await publishGate.promise;
				return {
					cancelled: false,
					url: 'blob:late-export',
					fileName: 'late.wav',
					method: 'object-url',
					cleanup() { publishedCleanupCalls += 1; },
				};
			},
		},
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'export-source', name: 'export.wav', storageKey: 'export-source', mimeType: 'audio/wav',
				frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'export-clip', sourceId: 'export-source', title: 'Export', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
			},
		}],
	});

	const exporting = controller.actions.export.start({ format: 'wav', bitDepth: 16, includeTail: false });
	const startState = await Promise.race([
		publishStarted.promise.then(() => 'publishing'),
		exporting.then(() => 'settled'),
		unrefTimeout(1_000, 'timed-out'),
	]);
	if (startState !== 'publishing') {
		const status = controller.getSnapshot().status;
		await controller.dispose();
		assert.equal(startState, 'publishing', JSON.stringify(status));
	}
	const switching = controller.actions.project.create({ title: 'Replacement' });
	publishGate.resolve();
	await Promise.all([exporting, switching]);

	assert.equal(controller.getSnapshot().export.output, null);
	assert.equal(publishedCleanupCalls, 1);
	await controller.dispose();
});

test('best-effort settings report failures without unhandled rejections while required routing rejects', async () => {
	const store = createStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine: createEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createCache(),
	});
	await controller.ready;
	const saveSetting = store.saveSetting.bind(store);
	const unhandled = [];
	const onUnhandled = (error) => { unhandled.push(error); };
	process.on('unhandledRejection', onUnhandled);
	store.saveSetting = async () => { throw new Error('settings unavailable'); };
	try {
		controller.actions.transport.toggleMetronome();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(unhandled.length, 0);
		assert.match(controller.getSnapshot().status.message, /settings unavailable/);

		controller.actions.project.rename('Durable project data');
		await controller.actions.project.flush();
		assert.equal([...store.projects.values()].at(-1)?.title, 'Durable project data');
		assert.equal(controller.getSnapshot().save.state, 'saved');

		await assert.rejects(
			() => controller.actions.recording.setSourceOffset('device:default', 12),
			/settings unavailable/,
		);
	} finally {
		process.off('unhandledRejection', onUnhandled);
		store.saveSetting = saveSetting;
		await controller.dispose();
	}
});

function createStore(overrides = {}) {
	const projects = new Map();
	const settings = new Map();
	const analysisWrites = [];
	return {
		projects,
		settings,
		analysisWrites,
		closeCalls: 0,
		async ready() { return this; },
		async cleanupTemporaryAssets() {},
		async requestPersistentStorage() { return false; },
		async loadSetting(key, fallback) { return settings.has(key) ? settings.get(key) : fallback; },
		async saveSetting(key, value) { settings.set(key, structuredClone(value)); },
		async saveProject(project) { projects.set(project.id, structuredClone(project)); },
		async loadProject(id) { return projects.has(id) ? structuredClone(projects.get(id)) : null; },
		async listProjects() { return [...projects.values()].map((project) => structuredClone(project)); },
		async loadAnalysis() { return null; },
		async saveAnalysis(key, value) { analysisWrites.push({ key, value }); },
		async getSourceMetadata() { return null; },
		async loadMediaAsset() { return null; },
		async listVideoDerivatives() { return []; },
		async pruneUnreferencedSources() { return { deletedSourceIds: [] }; },
		async estimateStorage() { return { usage: 0, quota: 1_000_000 }; },
		async close() { this.closeCalls += 1; },
		...overrides,
	};
}

function createAudioBuffer(numberOfChannels = 1) {
	const samples = Float32Array.of(0, 0.25, -0.25, 0);
	return {
		numberOfChannels,
		length: samples.length,
		sampleRate: 48_000,
		getChannelData() { return samples; },
	};
}

function createEngine() {
	return {
		loadedProjects: [],
		setSourceResolver() {},
		loadProject(project) { this.loadedProjects.push(structuredClone(project)); },
		async applyProject() {},
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		getPositionFrames() { return 0; },
		stop() {},
		async dispose() {},
	};
}

function createCache() {
	return {
		createEngineSourceResolver() { return () => null; },
		retainClipIds() {},
		getProtectedSourceIds() { return new Set(); },
		dispose() {},
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

function unrefTimeout(delay, value) {
	return new Promise((resolve) => {
		const handle = setTimeout(() => resolve(value), delay);
		handle.unref?.();
	});
}
