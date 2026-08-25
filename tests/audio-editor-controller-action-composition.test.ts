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

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');
const { createSoundscaperProjectRuntimeV30Selection } = await import(
	'../src/soundscaper/editor-project-runtime-v30-selection.ts'
);

const COPY = Object.freeze({
	ready: 'Ready', untitledProject: 'Untitled', track: 'Track',
	projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
	genericError: 'Error: {message}', unknownError: 'Unknown error',
});

test('real controller export actions retain the configured file service', async () => {
	const saves: Array<Readonly<Record<string, unknown>>> = [];
	const controller = createController(saves);
	try {
		await controller.ready;
		const preset = await controller.actions.export.presets.save({
			label: 'Web master', kind: 'audio', format: 'wav',
		});
		await controller.actions.export.presets.saveToFile(preset.id);

		assert.equal(saves.length, 1);
		assert.equal(saves[0]?.purpose, 'preset');
		assert.equal(saves[0]?.suggestedName, 'Web-master.json');
	} finally {
		await controller.dispose();
	}
});

test('real controller exposes linked-audio relink classification to the Project Bin UI', async () => {
	const controller = createController([]);
	try {
		await controller.ready;
		assert.equal(
			typeof controller.actions.projectBin.classifyLinkedAudioRelink,
			'function',
		);
	} finally {
		await controller.dispose();
	}
});

test('common controller does not claim the selected product assistance command owner', async () => {
	const controller = createController([]);
	try {
		await controller.ready;
		assert.equal(controller.selectedMediaPreparation.acceptValidatedResult, undefined);
	} finally {
		await controller.dispose();
	}
});

test('real controller accepts one reviewed transcript into storage and one undo step', async () => {
	const projectRuntime = createSoundscaperProjectRuntimeV30Selection();
	const store = projectRuntime.createProjectStore({ indexedDB: null, preferOpfs: false });
	const controller = createController([], store, projectRuntime);
	try {
		await controller.ready;
		const trackId = controller.project.tracks[0].id as string;
		controller.actions.edit.commit({
			type: 'batch',
			commands: [{
				type: 'source/add',
				source: {
					id: 'assistance-source', name: 'Interview.wav', kind: 'audio',
					storageKey: 'owned:assistance-source', mimeType: 'audio/wav',
					contentSha256: 'ab'.repeat(32), frameCount: 48_000, channelCount: 1,
					sampleRate: 48_000, originalSampleRate: 48_000,
					sampleFormat: 'float32', chunkFrames: 65_536,
				},
			}, {
				type: 'clip/add', trackId,
				clip: {
					id: 'assistance-clip', title: 'Interview', kind: 'audio',
					sourceId: 'assistance-source', timelineStartFrame: 0,
					sourceStartFrame: 0, sourceDurationFrames: 48_000,
					durationFrames: 48_000,
				},
			}],
		});
		controller.actions.timeline.selectClip('assistance-clip');
		const prepared = await controller.selectedMediaPreparation.prepareSelectedMedia({
			sourceId: 'assistance-source', operation: 'speech-recognition',
		});
		const revisionBeforeAcceptance = controller.project.revision as number;
		await controller.selectedMediaPreparation.acceptValidatedResult?.({
			sourceId: 'assistance-source', operation: 'speech-recognition',
			selectionFence: prepared.selectionFence,
			model: {
				modelId: 'parakeet-tdt-0.6b-v3', version: '1', task: 'speech-recognition',
				artifactSha256s: ['12'.repeat(32)],
			},
			outputs: [{
				claim: {
					claimVersion: 1, claimId: 'a'.repeat(40), jobId: 'b'.repeat(40),
					role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
					byteLength: 128, sha256: '34'.repeat(32),
				},
				review: {
					kind: 'transcript', language: 'en', segments: [{
						startSeconds: 0, endSeconds: 0.5, text: 'Accepted words',
						words: [], speaker: null,
					}],
				},
			}],
		});

		assert.equal(controller.project.revision, revisionBeforeAcceptance + 1);
		assert.equal(controller.project.assistanceAssets.length, 1);
		const reference = controller.project.assistanceAssets[0];
		assert.equal(reference.sourceId, 'assistance-source');
		const transcriptTrack = controller.project.tracks.find((track: Readonly<{ type: string }>) => (
			track.type === 'label'
		));
		assert.equal(transcriptTrack?.labels[0]?.title, 'Accepted words');
		assert.equal(transcriptTrack?.labels[0]?.startFrame, 0);
		assert.equal(transcriptTrack?.labels[0]?.endFrame, 24_000);
		assert.equal((await store.getMediaAssetMetadata(reference.body.storageKey))?.sha256,
			reference.body.sha256);
		assert.ok(await store.loadMediaAsset(reference.body.storageKey));

		controller.actions.edit.undo();
		assert.deepEqual(controller.project.assistanceAssets, []);
		assert.equal(controller.project.tracks.some((track: Readonly<{ type: string }>) => (
			track.type === 'label'
		)), false);
		controller.actions.edit.redo();
		assert.equal(controller.project.assistanceAssets.length, 1);
	} finally {
		await controller.dispose();
	}
});

test('real Framescaper capture open action reveals Recording Setup without opening media', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		framescaperCaptureRouteSchemaVersion: 19,
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		fileService: { isDesktop: false },
	});
	try {
		await controller.ready;
		assert.equal(recordingSetupVisible(controller.getSnapshot()), false);
		const openSetup = controller.actions.capture.openSetup;
		if (typeof openSetup !== 'function') throw new TypeError('Capture openSetup action is unavailable.');
		await openSetup();
		assert.equal(recordingSetupVisible(controller.getSnapshot()), true);
	} finally {
		await controller.dispose();
	}
});

function createController(
	saves: Array<Readonly<Record<string, unknown>>>,
	store = createProjectStore({ indexedDB: null, preferOpfs: false }),
	projectRuntime: ReturnType<typeof createSoundscaperProjectRuntimeV30Selection> | null = null,
) {
	return createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine: createMemoryEngine(),
		engineFactory: createMemoryRenderEngine,
		...(projectRuntime ? {
			projectRuntime,
			sessionController: projectRuntime.createSessionController(),
		} : {}),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		fileService: {
			isDesktop: false,
			saveFile(request: Readonly<Record<string, unknown>>) {
				saves.push(request);
				return { cancelled: false };
			},
		},
	});
}

function createMemoryRenderEngine() {
	const render = (options: Readonly<Record<string, unknown>>) => {
		const startFrame = Number(options.startFrame);
		const endFrame = Number(options.endFrame);
		const channel = new Float32Array(endFrame - startFrame);
		return {
			numberOfChannels: 1,
			length: channel.length,
			sampleRate: 48_000,
			duration: channel.length / 48_000,
			getChannelData: () => channel,
		};
	};
	return {
		loadProject() {},
		setSourceResolver() {},
		async renderTrack(_trackId: string, options: Readonly<Record<string, unknown>>) { return render(options); },
		async renderMix(options: Readonly<Record<string, unknown>>) { return render(options); },
		async dispose() {},
	};
}

function createMemoryEngine() {
	return {
		loadProject() {},
		async applyProject() {},
		setSourceResolver() {},
		getPositionFrames() { return 0; },
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		stop() {},
		seek(frame: number) { return frame; },
		async getAudioContext() { return null; },
		async dispose() {},
	};
}

function createMemoryTimePitchCache() {
	return {
		createEngineSourceResolver() { return null; },
		retainClipIds() {},
		getProtectedSourceIds() { return new Set<string>(); },
		dispose() {},
	};
}

function recordingSetupVisible(snapshot: unknown): boolean {
	if (!snapshot || typeof snapshot !== 'object') return false;
	const preferences = (snapshot as Readonly<{ preferences?: unknown }>).preferences;
	if (!preferences || typeof preferences !== 'object') return false;
	const workspace = (preferences as Readonly<{ workspace?: unknown }>).workspace;
	if (!workspace || typeof workspace !== 'object') return false;
	const panels = (workspace as Readonly<{ panels?: unknown }>).panels;
	if (!panels || typeof panels !== 'object') return false;
	const setup = (panels as Readonly<Record<string, unknown>>)['recording-setup'];
	return Boolean(setup && typeof setup === 'object'
		&& (setup as Readonly<{ visible?: unknown }>).visible === true);
}
