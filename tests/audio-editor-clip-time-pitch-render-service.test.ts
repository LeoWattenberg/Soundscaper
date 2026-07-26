import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipTimePitchRenderService,
	type ClipTimePitchRenderStore,
} from '../src/common/editor/controller/clip-time-pitch-render-service.ts';
import type { ClipTimePitchCacheEntry } from '../src/common/editor/controller/clip-time-pitch-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-domain-types.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';

test('rendering commits persisted StaffPad output as one source/clip replacement batch', async () => {
	const harness = createHarness(projectFixture());

	assert.equal(await harness.service.renderClipPitchSpeed('clip'), 'clip');

	assert.deepEqual(harness.processing, [true, false]);
	assert.deepEqual(harness.statuses, [
		['Rendering…', undefined], ['Done', 'success'],
	]);
	assert.deepEqual(harness.preflights, [{ bytes: 16, purpose: 'effect' }]);
	assert.deepEqual(harness.writerEvents, ['write:4', 'commit']);
	assert.deepEqual(harness.savedAnalysis, ['peaks:rendered-clip-1']);
	assert.equal(harness.commits.length, 1);
	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected a render replacement batch.');
	assert.deepEqual(command.commands.map((entry) => entry.type), [
		'source/add', 'clip/remove', 'clip/add',
	]);
	const sourceCommand = command.commands[0];
	assert.equal(sourceCommand?.type, 'source/add');
	if (sourceCommand?.type !== 'source/add') assert.fail('Expected a rendered source.');
	assert.equal(sourceCommand.source.id, 'rendered-clip-1');
	assert.equal(sourceCommand.source.name, 'Voice — Render Pitch and Speed');
	const clipCommand = command.commands[2];
	assert.equal(clipCommand?.type, 'clip/add');
	if (clipCommand?.type !== 'clip/add') assert.fail('Expected a rendered clip.');
	assert.deepEqual({
		id: clipCommand.clip.id,
		sourceId: clipCommand.clip.sourceId,
		pitchCents: clipCommand.clip.pitchCents,
		speedRatio: clipCommand.clip.speedRatio,
		reversed: clipCommand.clip.reversed,
		renderCacheRevision: clipCommand.clip.renderCacheRevision,
	}, {
		id: 'clip', sourceId: 'rendered-clip-1', pitchCents: 0,
		speedRatio: 1, reversed: false, renderCacheRevision: 0,
	});
	assert.deepEqual(harness.commits[0]?.selection, {
		selectTrackId: 'track', selectClipId: 'clip',
	});
});

test('project switching during materialization suppresses storage and document publication', async () => {
	const gate = deferred<ClipTimePitchCacheEntry>();
	const harness = createHarness(projectFixture(), {
		materialize: () => gate.promise,
	});

	const pending = harness.service.renderClipPitchSpeed('clip');
	await Promise.resolve();
	harness.switchProject(projectFixture({ id: 'other-project' }));
	gate.resolve(cacheEntry('late', audioBufferFixture()));

	await assert.rejects(pending, { name: 'AbortError', code: 'PROJECT_CHANGED' });
	assert.deepEqual(harness.writerEvents, []);
	assert.deepEqual(harness.commits, []);
	assert.deepEqual(harness.processing, [true, false]);
});

test('failed writes abort and remove every partially published cache and storage record', async () => {
	const harness = createHarness(projectFixture(), { failCommit: true });

	await assert.rejects(harness.service.renderClipPitchSpeed('clip'), /commit failed/);

	assert.deepEqual(harness.writerEvents, ['write:4', 'commit', 'abort']);
	assert.deepEqual(harness.deletedSources, ['rendered-clip-1']);
	assert.deepEqual(harness.deletedAnalysis, ['peaks:rendered-clip-1']);
	assert.equal(harness.sourceBuffers.has('rendered-clip-1'), false);
	assert.equal(harness.sourcePeaks.has('rendered-clip-1'), false);
	assert.deepEqual(harness.commits, []);
});

test('render prerequisites, blocking, and already-rendered clips have deterministic outcomes', async () => {
	const blocked = createHarness(projectFixture());
	blocked.setBlocked(true);
	assert.equal(await blocked.service.renderClipPitchSpeed('clip'), null);
	assert.deepEqual(blocked.processing, []);

	const plain = createHarness(projectFixture({
		clips: [clipFixture({ pitchCents: 0, speedRatio: 1 })],
	}));
	assert.equal(await plain.service.renderClipPitchSpeed('clip'), 'clip');
	assert.deepEqual(plain.writerEvents, []);

	const missing = createHarness(projectFixture());
	await assert.rejects(missing.service.renderClipPitchSpeed('missing'), /Audio clip/);
	const missingTrack = createHarness(projectFixture({
		tracks: [{ id: 'track', name: 'Voice track', type: 'audio', clipIds: [] }],
	}));
	await assert.rejects(missingTrack.service.renderClipPitchSpeed('clip'), /Audio clip/);
	const missingSource = createHarness(projectFixture({ sources: [] }));
	await assert.rejects(missingSource.service.renderClipPitchSpeed('clip'), /Audio clip/);

	const noBuffer = createHarness(projectFixture(), {
		materialize: async () => ({ cacheKey: 'empty', sampleRate: 48_000 }),
	});
	await assert.rejects(noBuffer.service.renderClipPitchSpeed('clip'), /did not materialize/);
	assert.deepEqual(noBuffer.deletedSources, []);
});

test('post-commit analysis failures roll back durable data without aborting a committed writer', async () => {
	const project = projectFixture({
		clips: [clipFixture({ title: '' })],
		sources: [sourceFixture({ name: '' })],
	});
	const harness = createHarness(project, { failPeaks: true });

	await assert.rejects(harness.service.renderClipPitchSpeed('clip'), /peaks failed/);

	assert.deepEqual(harness.writerEvents, ['write:4', 'commit']);
	assert.deepEqual(harness.deletedSources, ['rendered-clip-1']);
	assert.deepEqual(harness.deletedAnalysis, ['peaks:rendered-clip-1']);
});

function createHarness(
	initialProject: ClipTransformProject,
	options: Readonly<{
		materialize?: () => Promise<ClipTimePitchCacheEntry>;
		failCommit?: boolean;
		failPeaks?: boolean;
	}> = {},
) {
	let project = initialProject;
	let blocked = false;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const sourceBuffers = new Map<string, AudioBufferLike>();
	const sourcePeaks = new Map<string, unknown>();
	const writerEvents: string[] = [];
	const deletedSources: string[] = [];
	const deletedAnalysis: string[] = [];
	const savedAnalysis: string[] = [];
	const store: ClipTimePitchRenderStore = {
		async beginSourceWrite() {
			return {
				async write(channels) { writerEvents.push(`write:${channels[0]?.length ?? 0}`); },
				async commit() {
					writerEvents.push('commit');
					if (options.failCommit) throw new Error('commit failed');
				},
				async abort() { writerEvents.push('abort'); },
			};
		},
		async saveAnalysis(key) { savedAnalysis.push(key); },
		async deleteAnalysis(key) { deletedAnalysis.push(key); },
		async deleteSource(sourceId) { deletedSources.push(sourceId); },
	};
	const commits: Array<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}> = [];
	const processing: boolean[] = [];
	const statuses: Array<[string, string | undefined]> = [];
	const preflights: Array<{ bytes: number; purpose: string }> = [];
	const rendered = audioBufferFixture();
	const service = createClipTimePitchRenderService({
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.',
			rendering: 'Rendering…',
			renderPitchSpeed: 'Render Pitch and Speed',
			done: 'Done',
		},
		store,
		sourceBuffers,
		sourcePeaks,
		sourceChunkFrames: 65_536,
		getProject: () => project,
		getSelectedClipId: () => 'clip',
		editingBlocked: () => blocked,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		prepareCommittedOutput: async () => cacheEntry('cache', rendered),
		materializeEntry: options.materialize ?? (async (entry) => entry),
		preflightStorage: async (bytes, purpose) => { preflights.push({ bytes, purpose }); },
		createId: (() => {
			let next = 0;
			return (prefix: string) => `${prefix}-${++next}`;
		})(),
		writeBuffer: async (writer, buffer) => {
			await writer.write(Array.from(
				{ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel),
			));
		},
		generateWaveformPeaks: async () => {
			if (options.failPeaks) throw new Error('peaks failed');
			return { version: 1 };
		},
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer: (sourceId, buffer) => { sourceBuffers.set(sourceId, buffer); },
		commit: (command, selection) => {
			commits.push({ command, ...(selection ? { selection } : {}) });
			return project;
		},
		setProcessing: (value) => { processing.push(value); },
		setStatus: (message, kind) => { statuses.push([message, kind]); },
		publish: () => undefined,
	});
	return {
		commits,
		deletedAnalysis,
		deletedSources,
		preflights,
		processing,
		savedAnalysis,
		service,
		sourceBuffers,
		sourcePeaks,
		statuses,
		writerEvents,
		setBlocked(value: boolean) { blocked = value; },
		switchProject(next: ClipTransformProject) {
			project = next;
			generation.activate(next.id);
		},
	};
}

function projectFixture(overrides: Partial<ClipTransformProject> = {}): ClipTransformProject {
	return {
		schemaVersion: 2, id: 'project', title: 'Project', sampleRate: 48_000,
		tracks: [{ id: 'track', name: 'Voice track', type: 'audio', clipIds: ['clip'] }],
		clips: [clipFixture()],
		sources: [sourceFixture()],
		selection: null,
		...overrides,
	};
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'clip', sourceId: 'source', title: 'Voice', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4,
		durationFrames: 4, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 1, fadeOutFrames: 1, reversed: true,
		envelope: [], groupId: null, pitchCents: 200, speedRatio: 1,
		preserveFormants: true, renderCacheRevision: 2,
		...overrides,
	};
}

function sourceFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'source', storageKey: 'source', name: 'Voice', mimeType: 'audio/wav',
		frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		...overrides,
	};
}

function cacheEntry(cacheKey: string, audioBuffer: AudioBufferLike): ClipTimePitchCacheEntry {
	return { cacheKey, sampleRate: audioBuffer.sampleRate, audioBuffer };
}

function audioBufferFixture(): AudioBufferLike {
	const channel = Float32Array.from([0, 0.25, -0.25, 0]);
	return {
		length: channel.length, numberOfChannels: 1, sampleRate: 48_000,
		getChannelData: () => channel,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}
