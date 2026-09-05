/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { videoMotionSettingsSha256V1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import {
	bindFramescaperMotionAnalysisActionsFinishing as bind,
	createFramescaperMotionAnalysisActionsFinishing as createActions,
	framescaperMotionAnalysisActionsFinishingFor as actionsFor,
	framescaperMotionAnalysisActionsFor,
	type FramescaperMotionAnalysisActionsFinishing,
	type FramescaperMotionAnalysisFrameProviderFinishing,
	type FramescaperMotionAnalysisFrameRequestFinishing,
	type FramescaperMotionAnalysisProgressFinishing,
} from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';

type Data = Record<string, unknown>;
type FrameProvider = FramescaperMotionAnalysisFrameProviderFinishing;

interface Publication { readonly metadata: Data; discardIfCurrent(): Promise<boolean> }

interface WriteOptions {
	readonly expectedBytes: number; readonly expectedSha256: string; readonly signal?: AbortSignal;
}

interface Writer {
	readonly maximumChunkBytes: number;
	readonly bytesWritten: number;
	write(bytes: Uint8Array): Promise<void>;
	commitOwned(): Promise<Publication>;
	abort(): Promise<void>;
}

interface Store {
	getMediaAssetMetadata(key: string): Promise<Data | null>;
	beginMediaAssetWrite(key: string, metadata: Data, options: WriteOptions): Promise<Writer>;
}

interface Owner { project: unknown; actions: { edit: { commit(command: unknown): unknown } } }

interface HarnessOptions {
	readonly projectValue?: Data;
	readonly frameProvider?: FrameProvider;
	readonly commit?: (command: unknown) => unknown;
	readonly prior?: Data | null;
	readonly onLookup?: (owner: Owner) => void;
	readonly maximumChunkBytes?: number;
	readonly bytesWritten?: number;
	readonly failWrite?: Error;
	readonly failAbort?: Error;
	readonly failDiscard?: Error;
	readonly commitMetadata?: Data;
}

interface Harness {
	readonly owner: Owner;
	readonly actions: FramescaperMotionAnalysisActionsFinishing;
	readonly commands: Data[];
	readonly chunks: Uint8Array[];
	readonly begins: { key: string; metadata: Data; options: WriteOptions }[];
	readonly lookups: string[];
	readonly log: string[];
}

const RUN = Object.freeze({ processorStackId: 'stack-1', startFrame: 0, endFrame: 3 });
const SOURCE_DIGEST = 'ab'.repeat(32);
const OTHER_DIGEST = 'ef'.repeat(32);

test('creating the finishing motion actions refuses an owner, store, or provider that cannot serve them', () => {
	const { store } = harnessStore({}, []);
	assert.throws(() => createActions({ owner: {} as never, store, frameProvider: decodeFrames }),
		/requires a controller owner/u);
	assert.throws(() => createActions({
		owner: { project: null, actions: { edit: { commit: 'nope' } } } as never, store, frameProvider: decodeFrames,
	}), (error: unknown) => error instanceof TypeError && /requires a controller owner/u.test(error.message));
	assert.throws(() => createActions({
		owner: harness().owner, store: { getMediaAssetMetadata: () => null } as never, frameProvider: decodeFrames,
	}), /requires an exact asset store/u);
	assert.throws(() => createActions({ owner: harness().owner, store, frameProvider: null as never }),
		(error: unknown) => error instanceof TypeError && /requires a frame provider/u.test(error.message));
});

test('a bound runtime is returned only for the object it was bound to', () => {
	const held = harness();
	const stranger = {};

	assert.equal(actionsFor(held.owner), null);
	bind(held.owner, held.actions);

	assert.equal(actionsFor(held.owner), held.actions);
	assert.equal(actionsFor(stranger), null);
	assert.equal(actionsFor('stack-1'), null);
	assert.equal(actionsFor(null), null);
	assert.equal(framescaperMotionAnalysisActionsFor, actionsFor);
	assert.throws(() => bind(null as never, held.actions), /finishing motion-analysis owner is required/u);
});

test('targets refuses a foreign project and a video source without a usable frame count', () => {
	assert.throws(() => harness({ projectValue: { schemaFamily: 'soundscaper', schemaVersion: 1 } }).actions.targets(),
		/cannot author a foreign project/u);
	assert.throws(() => harness({ projectValue: { id: 'project-1' } }).actions.targets(),
		/project schema identity is incomplete/u);
	assert.throws(() => harness({
		projectValue: projectValue({ sources: [videoSource({ sourceFrameCount: 0 })] }),
	}).actions.targets(), /finishing video source frame count must be positive/u);
	assert.throws(() => harness({ projectValue: projectValue({ sources: {} }) }).actions.targets(),
		/finishing motion-analysis sources must be an array/u);
});

test('targets describes a stack with no analysis and clamps its range to the run ceiling', () => {
	const near = harness().actions.targets();

	assert.deepEqual(near, [{
		stackId: 'stack-1', sourceId: 'video-source', sourceName: 'Clip A',
		startFrame: 0, endFrame: 12, analysisId: 'analysis:stack-1', freshness: 'missing',
	}]);
	assert.ok(Object.isFrozen(near) && Object.isFrozen(near[0]));

	const wide = harness({
		projectValue: projectValue({ sources: [videoSource({ sourceFrameCount: 9_000, name: '' })] }),
	}).actions.targets();

	assert.equal(wide[0]?.endFrame, 4_096, 'the ceiling, not the source length, bounds one run');
	assert.equal(wide[0]?.sourceName, 'video-source', 'an unnamed source falls back to its identity');
});

test('targets omits stacks that are malformed, mis-tracked, or aimed at an unusable source', () => {
	const disabled = trackingProcessor({ id: 'tracking-off', enabled: false });
	const held = harness({ projectValue: projectValue({
		sources: [videoSource(), { kind: 'audio', id: 'audio-source', name: 'Room tone' }],
		videoProcessorStacks: [
			processorStack({ id: 'malformed', schemaVersion: 2 }),
			processorStack({ id: 'no-tracker', processors: [disabled] }),
			processorStack({ id: 'two-trackers', processors: [
				trackingProcessor(), trackingProcessor({ id: 'tracking-2' }),
			] }),
			processorStack({ id: 'ghost-source', sourceId: 'missing-source' }),
			processorStack({ id: 'audio-aimed', sourceId: 'audio-source' }),
		],
	}) });

	assert.deepEqual(held.actions.targets(), []);
});

test('targets calls an analysis current only while its source and settings digests still hold', () => {
	const fresh = harness({ projectValue: projectValue({ videoMotionAnalyses: [analysisReference()] }) });
	assert.equal(fresh.actions.targets()[0]?.freshness, 'current');

	const restaged = harness({ projectValue: projectValue({
		sources: [videoSource({ contentSha256: OTHER_DIGEST })],
		videoMotionAnalyses: [analysisReference()],
	}) });
	assert.equal(restaged.actions.targets()[0]?.freshness, 'stale');

	const retuned = harness({ projectValue: projectValue({
		videoMotionAnalyses: [analysisReference({ settingsSha256: OTHER_DIGEST })],
	}) });
	assert.equal(retuned.actions.targets()[0]?.freshness, 'stale');
	assert.equal(retuned.actions.targets()[0]?.analysisId, 'analysis:stack-1');
});

test('a second analysis is refused while the first is still in flight', async () => {
	let release = (): void => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const held = harness({ frameProvider: async (request) => { await gate; return decodeFrames(request); } });

	const first = held.actions.analyze(RUN);
	await assert.rejects(held.actions.analyze(RUN), /already running/u);

	release();
	assert.equal((await first).processorStackId, 'stack-1');
	await held.actions.analyze(RUN);
	assert.equal(held.commands.length, 2, 'the lock is released once a run settles');
});

test('an already-aborted request rethrows its own reason before any frame is decoded', async () => {
	const controller = new AbortController();
	const reason = new Error('the operator cancelled the run');
	controller.abort(reason);
	let decoded = 0;
	const held = harness({ frameProvider: (request) => { decoded += 1; return decodeFrames(request); } });

	await assert.rejects(held.actions.analyze({ ...RUN, signal: controller.signal }),
		(error: unknown) => error === reason);
	assert.equal(decoded, 0);
	assert.deepEqual(held.lookups, []);
});

test('a request aborted while frames decode never reaches the asset store or the command log', async () => {
	const controller = new AbortController();
	const held = harness({ frameProvider: (request) => { controller.abort(); return decodeFrames(request); } });

	await assert.rejects(held.actions.analyze({ ...RUN, signal: controller.signal }),
		(error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.deepEqual(held.lookups, []);
	assert.deepEqual(held.commands, []);
});

test('analyze refuses a stack, a source, or an analysis set the project cannot serve', async () => {
	const held = harness();
	await assert.rejects(held.actions.analyze({ ...RUN, processorStackId: 'absent' }),
		(error: unknown) => error instanceof ReferenceError && /stack absent is unavailable/u.test(error.message));
	await assert.rejects(held.actions.analyze({ ...RUN, processorStackId: 'not a stack id' }),
		/finishing processor stack ID is invalid/u);

	const audio = harness({ projectValue: projectValue({
		sources: [{ kind: 'audio', id: 'video-source', name: 'Room tone' }],
	}) });
	await assert.rejects(audio.actions.analyze(RUN),
		(error: unknown) => error instanceof ReferenceError && /video source video-source is unavailable/u.test(error.message));

	const doubled = harness({ projectValue: projectValue({ videoMotionAnalyses: [
		analysisReference(), analysisReference({ id: 'analysis:stack-1.b' }, 'cd'.repeat(32)),
	] }) });
	await assert.rejects(doubled.actions.analyze(RUN), /has multiple motion analyses/u);
});

test('analyze refuses ranges that are empty, out of the source, or above the run ceiling', async () => {
	const held = harness();
	const refusals: readonly (readonly [number, number, RegExp])[] = [
		[0, 1, /at least two contained source frames/u],
		[5, 6, /at least two contained source frames/u],
		[0, 13, /at least two contained source frames/u],
		[-1, 3, /start frame must be non-negative/u],
		[0, 0, /end frame must be positive/u],
		[0, 3.5, /end frame must be non-negative/u],
	];
	for (const [startFrame, endFrame, message] of refusals) {
		await assert.rejects(held.actions.analyze({ ...RUN, startFrame, endFrame }),
			(error: unknown) => error instanceof RangeError && message.test(error.message));
	}

	const wide = harness({ projectValue: projectValue({ sources: [videoSource({ sourceFrameCount: 9_000 })] }) });
	await assert.rejects(wide.actions.analyze({ ...RUN, endFrame: 4_100 }), /limited to 4096 frames/u);
	assert.deepEqual(wide.lookups, []);
});

test('the frame provider receives the project identity, a detached source, and the requested range', async () => {
	const seen: FramescaperMotionAnalysisFrameRequestFinishing[] = [];
	const held = harness({ frameProvider: (request) => { seen.push(request); return decodeFrames(request); } });

	await held.actions.analyze(RUN);

	const request = seen[0];
	assert.equal(seen.length, 1);
	assert.equal(request?.projectId, 'project-1');
	assert.equal(request?.startFrame, 0);
	assert.equal(request?.endFrame, 3);
	assert.equal(request?.source.id, 'video-source');
	const recorded = ((held.owner.project as Data).sources as Data[])[0];
	assert.notEqual(request?.source, recorded, 'the provider is handed a detached copy of the source');
	assert.deepEqual(request?.source, recorded);
	assert.equal(Object.hasOwn(request as object, 'signal'), false,
		'an unsignalled run must not hand the provider an undefined signal key');
});

test('analyze reports every phase and keeps running when a progress observer throws', async () => {
	const seen: FramescaperMotionAnalysisProgressFinishing[] = [];
	const held = harness({ frameProvider: (request) => {
		request.onProgress({ phase: 'decoding', completed: 2, total: 3 });
		return decodeFrames(request);
	} });

	const reference = await held.actions.analyze({ ...RUN, onProgress: (progress) => {
		seen.push(progress);
		throw new Error('a progress observer must not own the run');
	} });

	assert.equal(reference.startFrame, 0);
	assert.deepEqual(seen[0], { phase: 'decoding', completed: 0, total: 3 });
	assert.deepEqual(seen[1], { phase: 'decoding', completed: 2, total: 3 });
	assert.deepEqual(seen[seen.length - 1], { phase: 'complete', completed: 1, total: 1 });
	assert.deepEqual(new Set(seen.map(({ phase }) => phase)),
		new Set(['decoding', 'tracking', 'publishing', 'complete']));
	assert.ok(seen.every((progress) => Object.isFrozen(progress)));
});

test('a first analysis writes its body in bounded chunks and commits the new reference', async () => {
	const held = harness({ maximumChunkBytes: 24 });

	const reference = await held.actions.analyze(RUN);

	assert.deepEqual(held.lookups, [reference.storageKey]);
	assert.equal(held.begins.length, 1);
	assert.equal(held.begins[0]?.key, reference.storageKey);
	assert.deepEqual(held.begins[0]?.metadata, {
		name: 'analysis:stack-1.motion.json',
		mimeType: 'application/vnd.framescaper.motion-analysis+json',
		sha256: reference.sha256,
	});
	assert.deepEqual(held.begins[0]?.options,
		{ expectedBytes: reference.byteLength, expectedSha256: reference.sha256 });
	assert.ok(held.chunks.length > 1, 'a body larger than the chunk limit is written in several writes');
	assert.ok(held.chunks.every((chunk) => chunk.byteLength <= 24 && chunk.byteLength > 0));
	const body = concat(held.chunks);
	assert.equal(body.byteLength, reference.byteLength);
	assert.equal(bytesToHex(sha256(body)), reference.sha256);
	assert.deepEqual(held.log, ['begin', 'commitOwned']);
	assert.deepEqual(held.commands, [{
		type: 'video-motion-analysis/set',
		motionAnalysisId: 'analysis:stack-1',
		expectedMotionAnalysis: null,
		motionAnalysis: reference,
	}]);
	assert.equal(reference.sourceId, 'video-source');
	assert.equal(reference.processorStackId, 'stack-1');
	assert.equal(reference.endFrame, 3);
	assert.equal(reference.inputSha256, SOURCE_DIGEST);
	assert.equal(reference.settingsSha256, videoMotionSettingsSha256V1(processorStack()));
	assert.equal(reference.storageKey, `motion-sha256:${reference.sha256}`);
});

test('a stale recorded analysis becomes the expectation the replacement command carries', async () => {
	const stale = analysisReference({ settingsSha256: OTHER_DIGEST }, 'cd'.repeat(32));
	const held = harness({ projectValue: projectValue({ videoMotionAnalyses: [stale] }) });

	const reference = await held.actions.analyze(RUN);

	assert.equal(held.commands.length, 1);
	assert.deepEqual(held.commands[0]?.expectedMotionAnalysis, stale);
	assert.deepEqual(held.commands[0]?.motionAnalysis, reference);
	assert.notEqual(reference.settingsSha256, OTHER_DIGEST);
});

test('an unchanged analysis whose body is already stored republishes nothing', async () => {
	const first = harness();
	const reference = await first.actions.analyze(RUN);

	const held = harness({
		projectValue: projectValue({ videoMotionAnalyses: [reference as unknown as Data] }),
		prior: { byteLength: reference.byteLength, sha256: reference.sha256 },
	});
	const repeated = await held.actions.analyze(RUN);

	assert.deepEqual(repeated, reference);
	assert.deepEqual(held.begins, [], 'a stored body is never restaged');
	assert.deepEqual(held.commands, [], 'an identical reference is not committed again');
});

test('a stored body that disagrees with the computed reference is refused before any write', async () => {
	const held = harness({ prior: { size: 4, sha256: '0'.repeat(64) } });

	await assert.rejects(held.actions.analyze(RUN), /body is corrupt or conflicting/u);
	assert.deepEqual(held.begins, []);
	assert.deepEqual(held.commands, []);
	assert.deepEqual(held.log, []);
});

test('a writer that is not empty, has no chunk limit, or commits a mismatched body is cleaned up', async () => {
	const dirty = harness({ bytesWritten: 8 });
	await assert.rejects(dirty.actions.analyze(RUN), /writer is not empty/u);
	assert.deepEqual(dirty.log, ['begin', 'abort']);
	assert.deepEqual(dirty.chunks, []);

	const unbounded = harness({ maximumChunkBytes: 0 });
	await assert.rejects(unbounded.actions.analyze(RUN),
		(error: unknown) => error instanceof RangeError && /chunk limit must be positive/u.test(error.message));
	assert.deepEqual(unbounded.log, ['begin', 'abort']);

	const mismatched = harness({ commitMetadata: { size: 3, sha256: '0'.repeat(64) } });
	await assert.rejects(mismatched.actions.analyze(RUN), /body is corrupt or conflicting/u);
	assert.deepEqual(mismatched.log, ['begin', 'commitOwned', 'discard'],
		'a committed body that fails its check is discarded, not aborted');
	assert.deepEqual(mismatched.commands, []);
});

test('a staging failure whose cleanup also fails is raised as one aggregate error', async () => {
	const failWrite = new Error('the asset store lost the staging slot');
	const failAbort = new Error('the staging slot could not be released');
	const held = harness({ failWrite, failAbort });

	await assert.rejects(held.actions.analyze(RUN), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /staging and cleanup both failed/u);
		assert.deepEqual(error.errors, [failWrite, failAbort]);
		assert.equal(error.cause, failWrite);
		return true;
	});
	assert.deepEqual(held.log, ['begin', 'abort']);
});

test('a refused commit discards the freshly written body and rethrows the commit failure', async () => {
	const refusal = new Error('the finishing history refused the command');
	const held = harness({ commit: () => { throw refusal; } });

	await assert.rejects(held.actions.analyze(RUN), (error: unknown) => error === refusal);
	assert.deepEqual(held.log, ['begin', 'commitOwned', 'discard']);

	const failDiscard = new Error('the published body could not be rolled back');
	const both = harness({ commit: () => { throw refusal; }, failDiscard });
	await assert.rejects(both.actions.analyze(RUN), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /publication and body rollback both failed/u);
		assert.deepEqual(error.errors, [refusal, failDiscard]);
		assert.equal(error.cause, refusal);
		return true;
	});
});

test('a project edited while the body is staged refuses publication instead of overwriting it', async () => {
	const decoded: Harness = harness({ frameProvider: (request) => {
		decoded.owner.project = projectValue({ sources: [videoSource({ contentSha256: OTHER_DIGEST })] });
		return decodeFrames(request);
	} });
	await assert.rejects(decoded.actions.analyze(RUN), /source, settings, or reference changed before publication/u);
	assert.deepEqual(decoded.lookups, [], 'a superseded run stops before it touches the store');

	const staged = harness({ onLookup: (target) => {
		target.project = projectValue({ videoProcessorStacks: [processorStack({
			processors: [trackingProcessor({ windowRadius: 3 })],
		}) ] });
	} });
	await assert.rejects(staged.actions.analyze(RUN), /source, settings, or reference changed before publication/u);
	assert.deepEqual(staged.log, ['begin', 'commitOwned', 'discard']);
	assert.deepEqual(staged.commands, []);
});

test('a failed run releases the lock so the next request is served', async () => {
	let attempts = 0;
	const held = harness({ frameProvider: (request) => {
		attempts += 1;
		if (attempts === 1) throw new Error('the decoder was unavailable');
		return decodeFrames(request);
	} });

	await assert.rejects(held.actions.analyze(RUN), /decoder was unavailable/u);
	const reference = await held.actions.analyze(RUN);

	assert.equal(attempts, 2);
	assert.equal(held.commands.length, 1);
	assert.equal(reference.id, 'analysis:stack-1');
});

function harness(options: HarnessOptions = {}): Harness {
	const commands: Data[] = [];
	const log: string[] = [];
	const held: Owner = { project: options.projectValue ?? projectValue(), actions: { edit: {
		commit: (command: unknown) => { commands.push(command as Data); return options.commit?.(command); },
	} } };
	const { store, ...records } = harnessStore(options, log, held);
	const frameProvider = options.frameProvider ?? decodeFrames;
	const actions = createActions({ owner: held, store, frameProvider });
	return { owner: held, actions, commands, log, ...records };
}

function harnessStore(options: HarnessOptions, log: string[], held?: Owner) {
	const chunks: Uint8Array[] = [];
	const begins: { key: string; metadata: Data; options: WriteOptions }[] = [];
	const lookups: string[] = [];
	const store: Store = {
		getMediaAssetMetadata: async (key) => {
			lookups.push(key);
			if (held) options.onLookup?.(held);
			return options.prior ?? null;
		},
		beginMediaAssetWrite: async (key, metadata, writeOptions) => {
			begins.push({ key, metadata: { ...metadata }, options: { ...writeOptions } });
			log.push('begin');
			const written: Uint8Array[] = [];
			return {
				maximumChunkBytes: options.maximumChunkBytes ?? 64,
				bytesWritten: options.bytesWritten ?? 0,
				write: async (bytes: Uint8Array) => {
					if (options.failWrite) throw options.failWrite;
					written.push(Uint8Array.from(bytes));
					chunks.push(Uint8Array.from(bytes));
				},
				commitOwned: async () => {
					log.push('commitOwned');
					const body = concat(written);
					return {
						metadata: options.commitMetadata
							?? { size: body.byteLength, sha256: bytesToHex(sha256(body)) },
						discardIfCurrent: async () => {
							log.push('discard');
							if (options.failDiscard) throw options.failDiscard;
							return true;
						},
					};
				},
				abort: async () => { log.push('abort'); if (options.failAbort) throw options.failAbort; },
			};
		},
	};
	return { store, chunks, begins, lookups };
}

function projectValue(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1',
		sources: [videoSource()], videoProcessorStacks: [processorStack()],
		videoMotionAnalyses: [], ...overrides,
	};
}

function videoSource(overrides: Data = {}): Data {
	return {
		kind: 'video', id: 'video-source', name: 'Clip A',
		contentSha256: SOURCE_DIGEST, sourceFrameCount: 12, ...overrides,
	};
}

function processorStack(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'stack-1', sourceId: 'video-source',
		processors: [trackingProcessor()], ...overrides,
	};
}

function trackingProcessor(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
		maximumFeatures: 16, quality: 0.01, minimumDistance: 2,
		windowRadius: 2, pyramidLevels: 1, ...overrides,
	};
}

function analysisReference(overrides: Data = {}, digest = 'bc'.repeat(32)): Data {
	return {
		schemaVersion: 1, id: 'analysis:stack-1', sourceId: 'video-source',
		processorStackId: 'stack-1', inputSha256: SOURCE_DIGEST,
		settingsSha256: videoMotionSettingsSha256V1(processorStack()),
		storageKey: `motion-sha256:${digest}`, sha256: digest,
		byteLength: 64, startFrame: 0, endFrame: 3, ...overrides,
	};
}

const decodeFrames: FrameProvider = (request) => Array.from(
	{ length: request.endFrame - request.startFrame },
	(_unused, index) => ({ frameNumber: request.startFrame + index, frame: grayFrame(request.startFrame + index) }),
);

function grayFrame(seed: number) {
	const samples: number[] = [];
	for (let y = 0; y < 6; y += 1) {
		for (let x = 0; x < 6; x += 1) samples.push((((x + seed) * 7 + y * 13) % 5) / 4);
	}
	return { width: 6, height: 6, samples };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	chunks.reduce((offset, chunk) => { bytes.set(chunk, offset); return offset + chunk.byteLength; }, 0);
	return bytes;
}
