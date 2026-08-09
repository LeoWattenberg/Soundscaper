/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createImportVideoFile,
	type ImportVideoRuntime,
} from '../src/common/editor/controller/source-import.ts';
import {
	VideoPreviewEncodedPayloadTooLargeError,
	VideoPreviewSourceGeometryTooLargeError,
} from '../src/common/editor/video-preview-capture-admission.ts';
import {
	beginOwnedMediaAssetWriteFixture,
	videoFile,
} from './helpers/audio-editor-source-import-fixture.ts';

function isSourceAddCommand(value: unknown): value is Readonly<{
	type: 'source/add';
	source: Record<string, unknown>;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const command = value as Readonly<Record<string, unknown>>;
	return command.type === 'source/add'
		&& Boolean(command.source)
		&& typeof command.source === 'object'
		&& !Array.isArray(command.source);
}

export function createFixture() {
	const calls: string[] = [];
	const addedSources: Record<string, unknown>[] = [];
	const derivatives: Array<{ timestamp: number; type: string }> = [];
	const commits: Array<{ command: { commands: unknown[] }; selection: Record<string, unknown> }> = [];
	const deletedSources: string[] = [];
	const deletedMedia: string[] = [];
	const boundSnapshots: unknown[] = [];
	const releasedLocators: unknown[] = [];
	const unlinkedBindings: Array<Readonly<{
		projectId: string;
		sourceId: string;
		bindingToken: string;
	}>> = [];
	const mediaDiscardAttempts: string[] = [];
	const mediaGenerations = new Map<string, number>();
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const options = {
		decodeMode: 'native' as 'native' | 'fallback' | 'none',
		posterFails: false,
		posterSourceAdmissionFails: false,
		thumbnailAdmissionFailure: null as number | null,
		thumbnailFailure: null as number | null,
		writeMediaFails: false,
		writerFails: false,
		activateFails: false,
		replaceMediaBeforeRollback: false,
		activationGate: null as Promise<void> | null,
		bindFails: false,
		commitFails: false,
		commitMutatesThenFails: false,
		extractorFails: false,
		preflightFails: false,
		peaksFail: false,
	};
	const canonicalAudio = {
		length: 8,
		numberOfChannels: 1,
		sampleRate: 48_000,
		channels: [Float32Array.of(0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1)],
	};
	let project = {
		id: 'project-import-video',
		tracks: [] as Array<{ id: string; type: string; laneGroupId?: string }>,
		sources: [] as Record<string, unknown>[],
	};
	let projectGeneration = 0;
	const ids = new Map<string, number>();
	const stableId = (prefix: string) => {
		const next = (ids.get(prefix) || 0) + 1;
		ids.set(prefix, next);
		return `${prefix}-${next}`;
	};
	const extractor = {
		metadata: { durationSeconds: 2, width: 1_920, height: 1_080 },
		async capture(timestamp: number, captureOptions?: unknown) {
			calls.push(`capture:${timestamp}:${captureOptions ? 'poster' : 'thumbnail'}`);
			if (timestamp === 0 && options.posterSourceAdmissionFails) {
				throw new VideoPreviewSourceGeometryTooLargeError(16_385, 1, 'exceeds the maximum width');
			}
			if (timestamp === options.thumbnailAdmissionFailure) {
				throw new VideoPreviewEncodedPayloadTooLargeError(2, 1);
			}
			if ((timestamp === 0 && options.posterFails) || timestamp === options.thumbnailFailure) {
				throw new Error('capture failed');
			}
			return {
				blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
				width: 320,
				height: 180,
				mimeType: 'image/webp',
				timestampSeconds: timestamp,
			};
		},
		dispose() { calls.push('dispose'); },
	};
	const writer = {
		async write() {
			calls.push('writer-write');
			if (options.writerFails) throw new Error('writer failed');
		},
		async commit() { calls.push('writer-commit'); },
		async abort() { calls.push('writer-abort'); },
	};
	const runtime: ImportVideoRuntime = {
		SOURCE_CHUNK_FRAMES: 65_536,
		activateVideoSource: async (source: { id: string }) => {
			calls.push(`activate:${source.id}`);
			if (options.activationGate) await options.activationGate;
			if (options.activateFails) {
				if (options.replaceMediaBeforeRollback) {
					mediaGenerations.set(source.id, (mediaGenerations.get(source.id) ?? 0) + 1);
				}
				throw new Error('activation failed');
			}
		},
		audioBufferChannels: (value: typeof canonicalAudio) => value.channels || canonicalAudio.channels,
		audioEditorVideoThumbnailTimes: () => [1, 2],
		bufferFromChannels: async () => canonicalAudio,
		cacheSourceBuffer: (sourceId: string, value: unknown) => { sourceBuffers.set(sourceId, value); },
		canonicalizeBuffer: async () => canonicalAudio,
		commit: (command: { commands: unknown[] }, selection: Record<string, unknown>) => {
			calls.push('commit');
			if (options.commitFails) throw new Error('commit failed');
			if (options.commitMutatesThenFails) {
				project = {
					...project,
					sources: [
						...project.sources,
						...command.commands.filter(isSourceAddCommand).map(({ source }) => source),
					],
				};
				throw new Error('post-commit publication failed');
			}
			commits.push({ command, selection });
		},
		copy: {},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => {
			addedSources.push(source as Record<string, unknown>);
			return { type: 'source/add', source };
		},
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createAudioEditorVideoFrameExtractor: async () => {
			if (options.extractorFails) throw new Error('extractor failed');
			return extractor;
		},
		createStableId: stableId,
		engine: {
			getAudioContext: async () => ({}),
			decodeAudioData: async () => {
				if (options.decodeMode !== 'native') throw new Error('native decode failed');
				return {
					...canonicalAudio,
					channels: undefined,
				};
			},
		},
		ffmpeg: {
			decode: async () => {
				if (options.decodeMode === 'none') throw new Error('no audio');
				return { channels: canonicalAudio.channels, sampleRate: 44_100 };
			},
		},
		findTrack: (value: typeof project, trackId: string) => value.tracks.find((track) => track.id === trackId) || null,
		fitAudioBufferToFrames: () => canonicalAudio,
		generateWaveformPeaks: async () => {
			if (options.peaksFail) throw new Error('peaks failed');
			return { levels: [] };
		},
		inspectEncodedAudioSampleRate: () => 44_100,
		normalizeImportOptions: () => ({ destination: 'timeline', trackId: null, timelineStartFrame: 0 }),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		preflightStorage: async (bytes: number) => {
			calls.push(`preflight:${bytes}`);
			if (options.preflightFails) throw new Error('preflight failed');
		},
		captureProject: () => Object.freeze({ generation: projectGeneration, projectId: project.id }),
		assertProject: (token: Readonly<{ generation: number; projectId: string }>) => {
			calls.push(`assert-project:${token.generation}`);
			if (token.generation !== projectGeneration || token.projectId !== project.id) {
				throw new Error('The project changed during video import.');
			}
		},
		getProject: () => project,
		projectSampleRate: () => 48_000,
		revokeVideoVisual: (sourceId: string) => { calls.push(`revoke:${sourceId}`); },
		sourceBuffers,
		sourcePeaks,
		store: {
			async beginMediaAssetWrite(
				sourceId: string,
				_metadata: Readonly<Record<string, unknown>>,
				writeOptions: Readonly<{ expectedBytes: number; expectedSha256: string }>,
			) {
				return beginOwnedMediaAssetWriteFixture(sourceId, writeOptions, {
					calls,
					deletedMedia,
					discardAttempts: mediaDiscardAttempts,
					generations: mediaGenerations,
					writeFails: options.writeMediaFails,
				});
			},
			async saveVideoDerivative(_sourceId: string, derivative: { timestamp: number; type: string }) {
				derivatives.push(derivative);
			},
			async saveLinkedVideoDerivative(
				_projectId: string,
				_source: unknown,
				_binding: unknown,
				derivative: { timestamp: number; type: string },
			) {
				calls.push('save-linked-derivative');
				derivatives.push(derivative);
			},
			async beginSourceWrite() { return writer; },
			async saveAnalysis() { calls.push('save-analysis'); },
			async deleteSource(sourceId: string) { deletedSources.push(sourceId); },
			async deleteMediaAsset(sourceId: string) { deletedMedia.push(sourceId); },
			async bindLinkedVideoOriginal(
				projectId: string,
				source: { id: string },
				locatorId: string,
				bindOptions: { expectedLocatorRevision: string; expectedSnapshot: unknown },
			) {
				calls.push(`bind:${projectId}:${source.id}:${locatorId}`);
				assert.equal(bindOptions.expectedLocatorRevision, 'revision_0000000000000001');
				boundSnapshots.push(bindOptions.expectedSnapshot);
				if (options.bindFails) throw new Error('binding failed');
				return Object.freeze({
					projectId,
					sourceId: source.id,
					storageKey: source.id,
					locatorId,
					locatorRevision: 'revision_0000000000000001',
					byteLength: 32,
					sha256: '1'.repeat(64),
					bindingToken: 'binding_token_0000000000001',
					boundAt: '2026-08-02T00:00:00.000Z',
				});
			},
			async unlinkLinkedVideoOriginal(projectId: string, sourceId: string, bindingToken: string) {
				unlinkedBindings.push({ projectId, sourceId, bindingToken });
				return true;
			},
			async releaseLinkedVideoOriginalLocator(reference: unknown) {
				releasedLocators.push(reference);
				return true;
			},
		},
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => { calls.push('warn-envelope'); },
		writeBuffer: async (target: typeof writer) => { await target.write(); },
	};
	return {
		addedSources,
		boundSnapshots,
		calls,
		commits,
		deletedMedia,
		deletedSources,
		derivatives,
		options,
		getProject: () => project,
		mediaDiscardAttempts,
		releasedLocators,
		replaceMediaGeneration: (sourceId: string) => {
			mediaGenerations.set(sourceId, (mediaGenerations.get(sourceId) ?? 0) + 1);
		},
		runtime,
		setProject: (value: typeof project) => { projectGeneration += 1; project = value; },
		sourceBuffers,
		sourcePeaks,
		unlinkedBindings,
	};
}

test('video import extracts linked audio and creates a new timeline lane pair', async () => {
	const fixture = createFixture();
	const result = await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'timeline',
		trackId: null,
		trackIndex: 3,
		timelineStartFrame: 12,
	});

	assert.equal(result.destination, 'timeline');
	assert.match(result.sourceId, /^video-source-/u);
	assert.match(result.audioSourceId, /^source-/u);
	assert.match(result.trackId, /^video-track-/u);
	const videoSource = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(videoSource);
	assert.equal(videoSource.posterStorageKey, null);
	assert.equal(videoSource.thumbnailStorageKey, null);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.command.commands.length, 6);
	const committedVideoSource = fixture.commits[0]?.command.commands
		.filter(isSourceAddCommand)
		.map(({ source }) => source)
		.find(({ kind }) => kind === 'video');
	assert.ok(committedVideoSource);
	assert.equal(committedVideoSource.posterStorageKey, null);
	assert.equal(committedVideoSource.thumbnailStorageKey, null);
	assert.deepEqual(fixture.derivatives.map(({ timestamp, type }) => [timestamp, type]), [
		[0, 'poster'], [1, 'thumbnail'], [2, 'thumbnail'],
	]);
	assert.equal(fixture.sourceBuffers.size, 1);
	assert.equal(fixture.sourcePeaks.size, 1);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('video import reuses both members of an existing lane group', async () => {
	const fixture = createFixture();
	fixture.setProject({
		id: 'project-import-video',
		tracks: [
			{ id: 'video-lane', type: 'video', laneGroupId: 'media' },
			{ id: 'audio-lane', type: 'audio', laneGroupId: 'media' },
		],
		sources: [],
	});
	fixture.options.decodeMode = 'fallback';
	const result = await createImportVideoFile(fixture.runtime)(videoFile('fallback.mov'), {
		destination: 'timeline', trackId: 'audio-lane', timelineStartFrame: 0,
	});

	assert.equal(result.trackId, 'video-lane');
	assert.equal(fixture.commits[0]?.command.commands.length, 4);
	assert.equal(fixture.calls.includes('writer-commit'), true);
});

test('project-bin video import tolerates missing audio and disposable preview failures', async () => {
	const fixture = createFixture();
	fixture.options.decodeMode = 'none';
	fixture.options.posterFails = true;
	fixture.options.thumbnailFailure = 1;
	const result = await createImportVideoFile(fixture.runtime)(videoFile(''), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.equal(result.destination, 'project-bin');
	assert.equal(result.audioSourceId, null);
	assert.equal(result.audioClipId, null);
	assert.equal(result.trackId, null);
	assert.equal(fixture.commits[0]?.command.commands.length, 2);
	assert.deepEqual(fixture.derivatives.map(({ timestamp }) => timestamp), [2]);
	assert.equal(fixture.calls.includes('warn-envelope'), true);
});

test('video import stops disposable filmstrip work after an encoded hard-cap refusal', async () => {
	const fixture = createFixture();
	fixture.options.thumbnailAdmissionFailure = 1;
	await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.deepEqual(
		fixture.calls.filter((call) => call.startsWith('capture:')),
		['capture:0:poster', 'capture:1:thumbnail'],
	);
	assert.deepEqual(fixture.derivatives.map(({ timestamp }) => timestamp), [0]);
});

test('video import skips all disposable captures after source-frame admission refuses the poster', async () => {
	const fixture = createFixture();
	fixture.options.posterSourceAdmissionFails = true;
	await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.deepEqual(
		fixture.calls.filter((call) => call.startsWith('capture:')),
		['capture:0:poster'],
	);
	assert.deepEqual(fixture.derivatives, []);
});

test('a selected ungrouped video lane causes a companion lane pair to be created', async () => {
	const fixture = createFixture();
	fixture.setProject({
		id: 'project-import-video', tracks: [{ id: 'video-only', type: 'video' }], sources: [],
	});
	const result = await createImportVideoFile(fixture.runtime)(videoFile('clip.webm'), {
		destination: 'timeline', trackId: 'video-only', timelineStartFrame: 4,
	});
	assert.match(result.trackId, /^video-track-/u);
	assert.equal(fixture.commits[0]?.command.commands.length, 6);
});

test('video import removes persisted media and audio when activation fails', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/activation failed/u,
	);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, ['video-source-1']);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.calls.includes('revoke:video-source-1'), true);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('video import aborts a failed extracted-audio write and keeps cleanup idempotent', async () => {
	const fixture = createFixture();
	fixture.options.writerFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/writer failed/u,
	);
	assert.equal(fixture.calls.includes('writer-abort'), true);
	assert.deepEqual(fixture.deletedSources, []);
	assert.deepEqual(fixture.deletedMedia, ['video-source-1']);
});

test('linked video import keeps local derivatives and extracted PCM while activating the exact binding', async () => {
	const fixture = createFixture();
	const locatorId = 'locator_0000000000000001';
	const file = videoFile();
	const result = await createImportVideoFile(fixture.runtime)(file, {
		destination: 'timeline',
		trackId: null,
		timelineStartFrame: 0,
		linkedVideoLocatorId: locatorId,
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});

	assert.equal(fixture.calls.some((call) => call.startsWith('write-media:')), false);
	assert.ok(fixture.calls.indexOf(`bind:project-import-video:${result.sourceId}:${locatorId}`)
		< fixture.calls.indexOf('save-linked-derivative'));
	assert.ok(fixture.calls.indexOf('save-linked-derivative')
		< fixture.calls.indexOf(`activate:${result.sourceId}`));
	assert.ok(fixture.calls.indexOf('assert-project:0')
		< fixture.calls.indexOf(`bind:project-import-video:${result.sourceId}:${locatorId}`));
	assert.ok(fixture.calls.lastIndexOf('assert-project:0')
		> fixture.calls.indexOf(`activate:${result.sourceId}`));
	assert.ok(fixture.calls.lastIndexOf('assert-project:0') < fixture.calls.indexOf('commit'));
	assert.equal(fixture.derivatives.length, 3);
	assert.equal(fixture.calls.includes('writer-commit'), true);
	assert.equal(fixture.sourceBuffers.size, 1);
	assert.equal(Object.hasOwn(result, 'linkedVideoOriginal'), false);
	assert.deepEqual(fixture.boundSnapshots, [file]);
	assert.deepEqual(fixture.releasedLocators, []);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.equal(fixture.commits.length, 1);
});

test('linked video import unlinks and releases its locator when activation fails', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/activation failed/u,
	);

	assert.deepEqual(fixture.unlinkedBindings, [{
		projectId: 'project-import-video',
		sourceId: 'video-source-1',
		bindingToken: 'binding_token_0000000000001',
	}]);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import releases an unused locator after an early admission failure', async () => {
	const fixture = createFixture();
	fixture.options.preflightFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/preflight failed/u,
	);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.equal(fixture.calls.includes('dispose'), false);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import releases an unpublished locator when exact binding fails', async () => {
	const fixture = createFixture();
	fixture.options.bindFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/binding failed/u,
	);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import rolls back its binding and local media when commit refuses', async () => {
	const fixture = createFixture();
	fixture.options.commitFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/commit failed/u,
	);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import rolls back when the active project changes during activation', async () => {
	const fixture = createFixture();
	let continueActivation!: () => void;
	fixture.options.activationGate = new Promise<void>((resolve) => { continueActivation = resolve; });
	const operation = createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		linkedVideoLocatorId: 'locator_0000000000000001',
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});
	while (!fixture.calls.includes('activate:video-source-1')) await Promise.resolve();
	fixture.setProject({ id: 'replacement-project', tracks: [], sources: [] });
	continueActivation();

	await assert.rejects(operation, /project changed during video import/iu);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId: 'locator_0000000000000001', locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.deepEqual(fixture.getProject().sources, []);
});

test('linked video import rolls back when the active project generation changes under the same id', async () => {
	const fixture = createFixture();
	let continueActivation!: () => void;
	fixture.options.activationGate = new Promise<void>((resolve) => { continueActivation = resolve; });
	const operation = createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		linkedVideoLocatorId: 'locator_0000000000000001',
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});
	while (!fixture.calls.includes('activate:video-source-1')) await Promise.resolve();
	fixture.setProject({ id: 'project-import-video', tracks: [], sources: [] });
	continueActivation();

	await assert.rejects(operation, /project changed during video import/iu);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId: 'locator_0000000000000001', locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.deepEqual(fixture.getProject().sources, []);
});

test('a post-mutation commit failure retains resources for the landed canonical source', async () => {
	const fixture = createFixture();
	fixture.options.commitMutatesThenFails = true;
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'project-bin', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: 'locator_0000000000000001',
			linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/post-commit publication failed/u,
	);
	assert.equal(fixture.getProject().sources.some(({ id }) => id === 'video-source-1'), true);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.deepEqual(fixture.releasedLocators, []);
	assert.deepEqual(fixture.deletedSources, []);
	assert.deepEqual(fixture.deletedMedia, []);
});
