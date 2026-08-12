/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTransientAnalysisService,
	type TransientAnalysisControllerProject,
} from '../src/common/editor/controller/transient-analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import { transientAnalysisIdentity } from '../src/common/editor/storage/transient-analysis-cache.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);

test('analyzes the exact clip source window and publishes a self-bound derivative', async () => {
	const fixture = createFixture();
	const outcome = await fixture.service.analyzeClip('clip-1', {
		channelPolicy: 'mono-average',
		parameters: { windowFrames: 4, hopFrames: 2, minimumSpacingFrames: 0 },
	});

	assert.equal(outcome.cacheStatus, 'computed');
	assert.equal(outcome.clipId, 'clip-1');
	assert.equal(outcome.sourceId, 'source-1');
	assert.deepEqual(outcome.analysis.sourceRange, { startFrame: 10, endFrame: 18 });
	assert.equal(fixture.reads.length, 1);
	assert.deepEqual(fixture.reads[0], { sourceId: 'source-1', startFrame: 10, endFrame: 18 });
	assert.equal(fixture.saved.size, 1);
	const expected = transientAnalysisIdentity({
		sourceSha256: SOURCE_SHA256,
		sourceRange: { startFrame: 10, endFrame: 18 },
		channelPolicy: 'mono-average',
		parameters: { windowFrames: 4, hopFrames: 2, minimumSpacingFrames: 0 },
	});
	assert.equal(outcome.cacheKey, expected.key);
	assert.equal(fixture.saved.get(expected.key)?.key, expected.key);
});

test('returns an exact cache hit without reading PCM', async () => {
	const fixture = createFixture();
	const first = await fixture.service.analyzeClip('clip-1');
	fixture.reads.length = 0;

	const second = await fixture.service.analyzeClip('clip-1');

	assert.equal(first.cacheStatus, 'computed');
	assert.equal(second.cacheStatus, 'hit');
	assert.deepEqual(second.analysis, first.analysis);
	assert.deepEqual(fixture.reads, []);
});

test('digestless audio resolves a full-source PCM identity before cache and range reads', async () => {
	const resolvedSha256 = 'ef'.repeat(32);
	const fixture = createFixture({
		sourceSha256: undefined,
		resolveSourceSha256: async (projectId, source, signal) => {
			assert.equal(projectId, 'project-1');
			assert.equal(source.id, 'source-1');
			assert.equal(signal.aborted, false);
			fixture.events.push('digest');
			return resolvedSha256;
		},
	});

	const outcome = await fixture.service.analyzeClip('clip-1');

	assert.deepEqual(fixture.events.slice(0, 3), ['digest', 'load', 'range']);
	assert.equal(outcome.cacheKey, transientAnalysisIdentity({
		sourceSha256: resolvedSha256,
		sourceRange: { startFrame: 10, endFrame: 18 },
	}).key);
});

test('source authority is rechecked around asynchronous digest resolution', async () => {
	const fixture = createFixture({
		sourceSha256: undefined,
		resolveSourceSha256: async () => {
			fixture.project = project({ sourceSha256: undefined, storageKey: 'replacement' });
			return 'ef'.repeat(32);
		},
	});

	await assert.rejects(
		fixture.service.analyzeClip('clip-1'),
		/clip clip-1 changed before transient analysis completed/u,
	);
	assert.deepEqual(fixture.events, []);
	assert.deepEqual(fixture.reads, []);
});

test('discards corrupt cache data before recomputing it', async () => {
	const fixture = createFixture();
	const identity = transientAnalysisIdentity({
		sourceSha256: SOURCE_SHA256,
		sourceRange: { startFrame: 10, endFrame: 18 },
	});
	fixture.saved.set(identity.key, { key: identity.key, payloadSha256: 'not-a-digest' });

	const outcome = await fixture.service.analyzeClip('clip-1');

	assert.equal(outcome.cacheStatus, 'computed');
	assert.deepEqual(fixture.deleted, [identity.key]);
	assert.equal(fixture.reads.length, 1);
});

test('rejects a result when the clip changes across the PCM read boundary', async () => {
	const fixture = createFixture({
		afterRead: () => {
			fixture.project = project({ sourceStartFrame: 12, sourceDurationFrames: 6 });
		},
	});

	await assert.rejects(
		fixture.service.analyzeClip('clip-1'),
		/clip clip-1 changed before transient analysis completed/u,
	);
	assert.equal(fixture.saved.size, 0);
});

test('project activation invalidates late detector completion', async () => {
	let release!: () => void;
	const detectorGate = new Promise<void>((resolve) => { release = resolve; });
	const fixture = createFixture({
		analyze: async (channels, options, signal) => {
			await detectorGate;
			return fixture.defaultAnalyze(channels, options, signal);
		},
	});
	const pending = fixture.service.analyzeClip('clip-1');
	await fixture.readStarted;
	fixture.projectGeneration.activate('project-2');
	release();

	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(fixture.saved.size, 0);
});

test('a replacement analysis cancels the prior clip task', async () => {
	let releaseFirst!: () => void;
	let detectorCalls = 0;
	const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
	const fixture = createFixture({
		analyze: async (channels, options, signal) => {
			detectorCalls += 1;
			if (detectorCalls === 1) await firstGate;
			return fixture.defaultAnalyze(channels, options, signal);
		},
	});
	const first = fixture.service.analyzeClip('clip-1');
	await fixture.readStarted;
	const second = fixture.service.analyzeClip('clip-1', { parameters: { sensitivity: 2 } });
	releaseFirst();

	await assert.rejects(first, { name: 'AbortError' });
	assert.equal((await second).cacheStatus, 'computed');
});

test('fails closed without an audio clip and verified source digest', async () => {
	const missingDigest = createFixture({ sourceSha256: undefined });
	await assert.rejects(missingDigest.service.analyzeClip('clip-1'), /verified source SHA-256/u);
	const fixture = createFixture();
	await assert.rejects(fixture.service.analyzeClip('missing'), /Audio clip missing was not found/u);
	fixture.project = project({ kind: 'video' });
	await assert.rejects(fixture.service.analyzeClip('clip-1'), /Audio clip clip-1 was not found/u);
});

test('aggregate PCM and detector admission refuses before source-range allocation', async () => {
	const fixture = createFixture({
		projectOverrides: {
			sourceStartFrame: 0,
			sourceDurationFrames: 2_031_617,
			frameCount: 2_031_617,
			channelCount: 32,
			chunkFrames: 65_536,
		},
	});

	await assert.rejects(fixture.service.analyzeClip('clip-1', {
		parameters: { windowFrames: 1_048_576, hopFrames: 1_048_576 },
	}), /aggregate PCM and detector working-set bytes/iu);
	assert.deepEqual(fixture.reads, [], 'range reader was never invoked');
	assert.deepEqual(fixture.events, ['load'], 'admission runs after the cache miss but before PCM access');
});

test('unmaintained source chunks refuse before cache or range access', async () => {
	const fixture = createFixture({ projectOverrides: { chunkFrames: 65_537 } });
	await assert.rejects(fixture.service.analyzeClip('clip-1'), /source chunk frames.*65536/iu);
	assert.deepEqual(fixture.events, []);
	assert.deepEqual(fixture.reads, []);
});

type Analyze = NonNullable<Parameters<typeof createTransientAnalysisService>[0]['analyzeChannels']>;

function createFixture(options: Readonly<{
	sourceSha256?: string | undefined;
	afterRead?: () => void;
	analyze?: Analyze;
	resolveSourceSha256?: Parameters<typeof createTransientAnalysisService>[0]['resolveSourceSha256'];
	projectOverrides?: Parameters<typeof project>[0];
}> = {}) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('project-1');
	let resolveRead!: () => void;
	const readStarted = new Promise<void>((resolve) => { resolveRead = resolve; });
	const reads: Array<{ sourceId: string; startFrame: number; endFrame: number }> = [];
	const saved = new Map<string, Record<string, unknown>>();
	const deleted: string[] = [];
	const fixture = {
		project: project({
			...options.projectOverrides,
			sourceSha256: Object.hasOwn(options, 'sourceSha256') ? options.sourceSha256 : SOURCE_SHA256,
		}),
		lifetime,
		projectGeneration,
		reads,
		saved,
		deleted,
		events: [] as string[],
		readStarted,
		defaultAnalyze: null as unknown as Analyze,
		service: null as unknown as ReturnType<typeof createTransientAnalysisService>,
	};
	fixture.defaultAnalyze = async (channels, detectorOptions) => {
		const { detectPcmTransients } = await import('../src/common/editor/transient-analysis.ts');
		return detectPcmTransients(channels, detectorOptions);
	};
	fixture.service = createTransientAnalysisService({
		lifetime,
		getProject: () => fixture.project,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		loadAnalysis: async (key) => { fixture.events.push('load'); return saved.get(key) ?? null; },
		saveAnalysis: async (key, value) => { saved.set(key, value as Record<string, unknown>); },
		deleteAnalysis: async (key) => { deleted.push(key); saved.delete(key); },
		readSourceRange: async (source, range, signal) => {
			assert.equal(signal.aborted, false);
			fixture.events.push('range');
			reads.push({ sourceId: source.id, ...range });
			resolveRead();
			options.afterRead?.();
			return [Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0])];
		},
		analyzeChannels: options.analyze ?? ((channels, detectorOptions, signal) => (
			fixture.defaultAnalyze(channels, detectorOptions, signal)
		)),
		...(options.resolveSourceSha256 ? { resolveSourceSha256: options.resolveSourceSha256 } : {}),
	});
	lifetime.markReady();
	return fixture;
}

function project(overrides: Readonly<{
	sourceStartFrame?: number;
	sourceDurationFrames?: number;
	sourceSha256?: string | undefined;
	kind?: 'audio' | 'video';
	storageKey?: string;
	frameCount?: number;
	channelCount?: number;
	chunkFrames?: number;
}> = {}): TransientAnalysisControllerProject {
	return Object.freeze({
		id: 'project-1',
		clips: [Object.freeze({
			id: 'clip-1',
			kind: overrides.kind ?? 'audio',
			sourceId: 'source-1',
			sourceStartFrame: overrides.sourceStartFrame ?? 10,
			sourceDurationFrames: overrides.sourceDurationFrames ?? 8,
		})],
		sources: [Object.freeze({
			id: 'source-1',
			storageKey: overrides.storageKey ?? 'stored-source-1',
			frameCount: overrides.frameCount ?? 100,
			channelCount: overrides.channelCount ?? 1,
			chunkFrames: overrides.chunkFrames ?? 64,
			sampleRate: 48_000,
			contentSha256: Object.hasOwn(overrides, 'sourceSha256') ? overrides.sourceSha256 : SOURCE_SHA256,
		})],
	});
}
