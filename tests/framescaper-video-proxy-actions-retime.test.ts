/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FramescaperCapturedVideoProxyRequest } from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import { createFramescaperVideoProxyActions } from '../src/framescaper/editor-video-proxy-actions-retime.ts';
import {
	FramescaperVideoProxyCleanupCoordinatorRetime,
} from '../src/framescaper/editor-video-proxy-cleanup-retime.ts';

const PROXY_KEY = `video-proxy-sha256:${'34'.repeat(32)}`;
const TIMING_KEY = `video-timing-sha256:${'56'.repeat(32)}`;
const HEAVY = { droppedFrameRatio: 0.5, decodeQueueDepth: 0, viewportScale: 1 };
const PORTS = { name: 'TypeError', message: 'Framescaper 1.0 proxy actions require their exact controller ports.' };
const CHANGED = { allowChangedContent: true };

test('construction refuses an options record missing any of its exact controller ports', () => {
	const cleanup = { prepareReplacement: () => 0, cancel: () => 0, settle: () => 0 };
	const mutations: readonly ((options: Record<string, unknown>) => void)[] = [
		(options) => { options.owner = null; },
		(options) => { options.owner = 'owner'; },
		(options) => { options.createScheduler = 'factory'; },
		(options) => { options.previewTrust = 'verified'; },
		(options) => { options.cleanup = null; },
		(options) => { options.cleanup = { ...cleanup, prepareReplacement: undefined }; },
		(options) => { options.cleanup = { ...cleanup, cancel: undefined }; },
		(options) => { options.cleanup = { ...cleanup, settle: undefined }; },
		(options) => { ownerActions(options).edit = null; },
		(options) => { ownerActions(options).projectBin = null; },
		(options) => { ownerActions(options).video = { reloadSourceVisual: 'reload' }; },
	];
	for (const [index, mutate] of mutations.entries()) {
		const options = optionsFixture(ownerFixture(null));
		mutate(options);
		assert.throws(() => createFramescaperVideoProxyActions(options as never), PORTS, `mutation ${index}`);
	}
	assert.throws(() => createFramescaperVideoProxyActions(undefined as never), PORTS);
});

test('the editorial proxy session identifier must be bounded printable text', () => {
	for (const sessionId of ['', 'session with a space', 'x'.repeat(257), 'session-é']) {
		assert.throws(() => build(ownerFixture(null), { createSessionId: () => sessionId }),
			{ name: 'TypeError', message: 'The Framescaper editorial proxy session ID is invalid.' });
	}
});

test('an omitted session factory draws its identifier from secure randomness', async () => {
	const requests: FramescaperCapturedVideoProxyRequest[] = [];
	await build(ownerFixture(null), {
		createSessionId: undefined,
		createScheduler: scheduler(async (request) => { requests.push(request); }),
	}).generate('video-source');
	assert.match(requests[0]!.sessionId, /^editorial-proxy-[0-9a-f-]{36}$/u);
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
	try {
		assert.throws(() => build(ownerFixture(null), { createSessionId: undefined }),
			{ message: 'Secure random generation is required for editorial proxies.' });
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
	}
});

test('every proxy entry point refuses an identifier outside the bounded printable range', async () => {
	const runtime = build(ownerFixture(null));
	const refusal = { name: 'TypeError', message: 'A bounded printable Framescaper video-proxy identifier is required.' };
	for (const sourceId of ['', ' leading-space', 'x'.repeat(257)]) {
		assert.throws(() => runtime.mode(sourceId), refusal);
		assert.throws(() => runtime.pressure(sourceId), refusal);
		assert.throws(() => runtime.previewTrust(sourceId), refusal);
		await assert.rejects(runtime.setMode(sourceId, 'proxy'), refusal);
		await assert.rejects(runtime.reportPreviewPressure(sourceId, HEAVY), refusal);
		await assert.rejects(runtime.generate(sourceId), refusal);
		await assert.rejects(runtime.attachExisting(sourceId, new Blob(['proxy'])), refusal);
		await assert.rejects(runtime.detach(sourceId), refusal);
		await assert.rejects(runtime.regenerate(sourceId), refusal);
		await assert.rejects(runtime.relinkOriginal(sourceId, relinkCandidate()), refusal);
	}
});

test('proxy actions refuse a project that is not a writable Framescaper 1.0 document', () => {
	const owner = ownerFixture(null);
	const runtime = build(owner);
	for (const project of [null, 'project', [], { schemaFamily: 'soundscaper', schemaVersion: 1 },
		{ schemaFamily: 'framescaper', schemaVersion: 2 }]) {
		owner.project = project as unknown as Record<string, unknown>;
		assert.throws(() => runtime.previewTrust('video-source'),
			{ message: 'Editorial proxy mutation requires a writable Framescaper 1.0 project.' });
	}
});

test('a missing, non-video or carrier-less source is refused by its own diagnosis', () => {
	const owner = ownerFixture(null);
	const runtime = build(owner);
	const cases: readonly Readonly<{ sources: unknown; name: string; message: string }>[] = [
		{ sources: 'sources', name: 'TypeError', message: 'The Framescaper project source list is invalid.' },
		{ sources: [], name: 'ReferenceError', message: 'Video source video-source does not exist.' },
		{ sources: [null, 'source', { id: 'video-source', kind: 'audio', proxyAttachment: null }],
			name: 'ReferenceError', message: 'Video source video-source does not exist.' },
		{ sources: [{ id: 'video-source', kind: 'video' }], name: 'TypeError',
			message: 'Video source video-source has no proxy-attachment carrier.' },
	];
	for (const { sources, name, message } of cases) {
		owner.project.sources = sources;
		assert.throws(() => runtime.previewTrust('video-source'), { name, message });
	}
});

test('the captured request refuses an invalid project revision or source digest', async () => {
	const owner = ownerFixture(null);
	let disposals = 0;
	const runtime = build(owner, { createScheduler: scheduler(undefined, () => { disposals += 1; }) });
	for (const revision of [-1, 1.5, '4']) {
		owner.project.revision = revision;
		await assert.rejects(runtime.generate('video-source'),
			{ name: 'RangeError', message: 'The Framescaper editorial proxy project revision is invalid.' });
	}
	owner.project.revision = 4;
	for (const contentSha256 of ['AB'.repeat(32), 'ab', 12]) {
		owner.source().contentSha256 = contentSha256;
		await assert.rejects(runtime.generate('video-source'), { name: 'TypeError',
			message: 'The Framescaper editorial proxy source digest is invalid.' });
	}
	assert.equal(disposals, 6, 'every refused request still disposes its scheduler');
	assert.equal(owner.refreshes, 0);
});

test('setMode refuses an unsupported mode, skips an unchanged selection and withdraws a failed one', async () => {
	const owner = ownerFixture(attachment());
	const runtime = build(owner);
	await assert.rejects(runtime.setMode('video-source', 'balanced' as never),
		{ name: 'RangeError', message: 'The Framescaper video-proxy mode is unsupported.' });
	await runtime.setMode('video-source', 'auto');
	assert.equal(owner.refreshes, 0, 'the implicit Auto default is already selected');
	await runtime.setMode('video-source', 'proxy');
	await runtime.setMode('video-source', 'proxy');
	assert.equal(owner.refreshes, 1);
	assert.equal(runtime.mode('video-source'), 'proxy');
	const failing = ownerFixture(attachment());
	failing.reload = async () => { throw new Error('planned refresh failure'); };
	const failingRuntime = build(failing);
	await assert.rejects(failingRuntime.setMode('video-source', 'proxy'), /planned refresh failure/u);
	assert.equal(failingRuntime.mode('video-source'), 'auto', 'a failed first selection is withdrawn');
});

test('preview trust reports unavailable without an attachment and unverified without a resolver', () => {
	const owner = ownerFixture(null);
	const runtime = build(owner);
	assert.equal(runtime.previewTrust('video-source'), 'unavailable');
	owner.replaceProxy(attachment());
	assert.equal(runtime.previewTrust('video-source'), 'unverified');
});

test('a pressure report is refused out of bounds, ignored outside Auto and withdrawn when it cannot land', async () => {
	const owner = ownerFixture(attachment());
	const runtime = build(owner);
	await assert.rejects(runtime.reportPreviewPressure('video-source',
		{ droppedFrameRatio: 2, decodeQueueDepth: 0, viewportScale: 1 }), { name: 'RangeError' });
	await assert.rejects(runtime.reportPreviewPressure('video-source',
		{ droppedFrameRatio: 0.1, decodeQueueDepth: 1 } as never), { name: 'TypeError' });
	assert.equal(runtime.pressure('video-source'), null);
	await runtime.setMode('video-source', 'original');
	await runtime.reportPreviewPressure('video-source', HEAVY);
	assert.equal(owner.refreshes, 1, 'an explicit mode is never overridden by pressure');
	assert.deepEqual(runtime.pressure('video-source'), HEAVY);
	const failing = ownerFixture(attachment());
	failing.reload = async () => { throw new Error('planned pressure refresh failure'); };
	const failingRuntime = build(failing);
	await assert.rejects(failingRuntime.reportPreviewPressure('video-source', HEAVY),
		/planned pressure refresh failure/u);
	assert.equal(failingRuntime.pressure('video-source'), null);
});

test('generation and existing-body attachment refuse a source that already carries a proxy', async () => {
	const owner = ownerFixture(attachment());
	let schedulers = 0;
	const counted = (): unknown => { schedulers += 1; return scheduler()(); };
	const runtime = build(owner, { createScheduler: counted, createAttachExistingScheduler: counted });
	const refusal = { name: 'RangeError', message: 'Source video-source already has a proxy; use Regenerate.' };
	await assert.rejects(runtime.generate('video-source'), refusal);
	await assert.rejects(runtime.attachExisting('video-source', new Blob(['proxy'])), refusal);
	assert.equal(schedulers, 0, 'a refused publication never builds work');
});

test('an already aborted operation refuses before any scheduler exists', async () => {
	let schedulers = 0;
	const runtime = build(ownerFixture(null), {
		createScheduler: () => { schedulers += 1; return scheduler()(); },
	});
	const abort = new AbortController();
	const reason = new Error('the operator cancelled the proxy');
	abort.abort(reason);
	await assert.rejects(runtime.generate('video-source', { signal: abort.signal }),
		(error: unknown) => error === reason);
	// A signal that reports no reason still refuses as a well-named abort.
	const reasonless = { aborted: true, reason: undefined, addEventListener: () => undefined,
		removeEventListener: () => undefined } as unknown as AbortSignal;
	await assert.rejects(runtime.generate('video-source', { signal: reasonless }),
		(error: Error) => error.name === 'AbortError'
			&& error.message === 'Video proxy generation was cancelled.');
	assert.equal(schedulers, 0);
});

test('an abort that lands after the scheduler resolves still refuses publication', async () => {
	const owner = ownerFixture(null);
	const abort = new AbortController();
	let disposals = 0;
	const runtime = build(owner, { createScheduler: scheduler(
		async () => { abort.abort(new DOMException('cancelled', 'AbortError')); },
		() => { disposals += 1; },
	) });
	await assert.rejects(runtime.generate('video-source', { signal: abort.signal }),
		(error: Error) => error.name === 'AbortError');
	assert.equal(owner.refreshes, 0, 'a cancelled publication never reaches the visual');
	assert.equal(disposals, 1, 'the abort listener and the finally clause share one disposal');
});

test('detaching without a command builder commits the default detach command once', async () => {
	const owner = ownerFixture(attachment());
	const commands: Record<string, unknown>[] = [];
	owner.commit = (command) => { commands.push(command as Record<string, unknown>); owner.detachProxy(); };
	const runtime = build(owner);
	await runtime.detach('video-source');
	assert.equal(commands.length, 1);
	assert.equal(commands[0]!.type, 'framescaper/video-proxy-detach');
	assert.equal(commands[0]!.sourceId, 'video-source');
	assert.equal((commands[0]!.expectedAttachment as Record<string, unknown>).storageKey, PROXY_KEY);
	assert.equal(owner.refreshes, 1);
	await runtime.detach('video-source');
	assert.equal(commands.length, 1, 'a source without a proxy has nothing to detach');
	assert.equal(owner.refreshes, 1);
});

test('regenerating a source without a proxy generates one without a cleanup claim', async () => {
	const owner = ownerFixture(null);
	let claims = 0;
	const requests: FramescaperCapturedVideoProxyRequest[] = [];
	await build(owner, {
		cleanup: stubCleanup({ prepareReplacement: async () => { claims += 1; return {}; } }),
		createScheduler: scheduler(async (request) => { requests.push(request); }),
	}).regenerate('video-source');
	assert.equal(claims, 0);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]!.expectedProxyAttachment, undefined);
	assert.equal(owner.refreshes, 1);
});

test('a regeneration that fails after the attachment changed reclaims the replaced bodies', async () => {
	const owner = ownerFixture(attachment());
	const deleted: string[] = [];
	await assert.rejects(build(owner, {
		cleanup: cleanupFixture(owner, deleted),
		createScheduler: scheduler(async () => {
			owner.replaceProxy(attachment('78', '9a'));
			throw new Error('planned publication failure');
		}),
	}).regenerate('video-source'), /planned publication failure/u);
	assert.deepEqual(deleted, [PROXY_KEY, TIMING_KEY]);
});

test('a cleanup coordinator that cannot cancel or settle reports both failures together', async () => {
	const mutation = new Error('planned publication failure');
	const cancelFailure = new Error('planned cancellation failure');
	await assert.rejects(build(ownerFixture(attachment()), {
		cleanup: stubCleanup({ cancel: async () => { throw cancelFailure; } }),
		createScheduler: scheduler(async () => { throw mutation; }),
	}).regenerate('video-source'), (error: AggregateError) => {
		assert.equal(error.name, 'AggregateError');
		assert.deepEqual(error.errors, [mutation, cancelFailure]);
		assert.equal(error.cause, mutation);
		assert.match(error.message, /cleanup intent could not be cancelled/u);
		return true;
	});
	const settleFailure = new Error('planned settlement failure');
	const settling = ownerFixture(attachment());
	await assert.rejects(build(settling, {
		cleanup: stubCleanup({ settle: async () => { throw settleFailure; } }),
		createScheduler: scheduler(async () => {
			settling.replaceProxy(attachment('78', '9a'));
			throw mutation;
		}),
	}).regenerate('video-source'), (error: AggregateError) => {
		assert.deepEqual(error.errors, [mutation, settleFailure]);
		assert.match(error.message, /body cleanup remains recoverable/u);
		return true;
	});
});

test('relink refuses an unrelinkable source and an unclassifiable candidate', async () => {
	const owner = ownerFixture(attachment());
	const runtime = build(owner);
	for (const answer of [false, 'yes', undefined]) {
		owner.canRelink = answer;
		await assert.rejects(runtime.relinkOriginal('video-source', relinkCandidate()),
			{ message: 'Source video-source is not an offline linked video original.' });
	}
	let relinks = 0;
	owner.canRelink = true;
	owner.classify = 'unknown-content';
	owner.relink = async () => { relinks += 1; };
	await assert.rejects(runtime.relinkOriginal('video-source', relinkCandidate(), CHANGED),
		{ message: 'The selected video is not an admissible original relink candidate.' });
	assert.equal(relinks, 0, 'an inadmissible candidate never reaches the Project Bin relink');
});

test('relink requires exactly one Project Bin video occurrence for the source', async () => {
	const owner = ownerFixture(attachment());
	const runtime = build(owner);
	const bins: readonly unknown[] = [
		null,
		{ clips: 'clips' },
		{ clips: [] },
		{ clips: [{ kind: 'audio', id: 'bin-audio', sourceId: 'video-source' }] },
		{ clips: [{ kind: 'video', id: 'one', sourceId: 'video-source' }, { kind: 'video', id: 'two', sourceId: 'video-source' }] },
		{ clips: [{ kind: 'video', id: 7, sourceId: 'video-source' }] },
	];
	for (const projectBin of bins) {
		owner.project.projectBin = projectBin;
		await assert.rejects(runtime.relinkOriginal('video-source', relinkCandidate()),
			(error: Error) => /Project Bin/u.test(error.message));
	}
});

test('changed-content relink of a proxy-less source skips the invalidation fence entirely', async () => {
	const owner = ownerFixture(null);
	owner.classify = 'changed-content';
	let claims = 0;
	const observed: RelinkCallOptions[] = [];
	owner.relink = async (_clipId, _file, _locator, options = {}) => { observed.push(options); };
	const cleanup = stubCleanup({ prepareReplacement: async () => { claims += 1; return {}; } });
	const runtime = build(owner, { cleanup });
	assert.equal(await runtime.relinkOriginal('video-source', relinkCandidate(), CHANGED), 'relinked');
	assert.equal(claims, 0);
	assert.equal(observed[0]?.allowChangedContent, true);
	assert.equal(observed[0]?.changedContentProxyInvalidation, undefined);
	assert.equal(owner.refreshes, 1);
});

test('a changed-content relink that never publishes its idempotent fence fails afterwards', async () => {
	const failure = { message: 'Changed-content relink did not publish its proxy invalidation fence.' };
	const untouched = ownerFixture(attachment());
	untouched.classify = 'changed-content';
	const kept: string[] = [];
	await assert.rejects(build(untouched, { cleanup: cleanupFixture(untouched, kept) })
		.relinkOriginal('video-source', relinkCandidate(), CHANGED), failure);
	assert.deepEqual(untouched.source().proxyAttachment, attachment());
	assert.deepEqual(kept, [], 'the still-current proxy keeps its bodies');
	// The fence is idempotent, so a doubled invalidation still commits one edit.
	const unconfirmed = ownerFixture(attachment());
	let commits = 0;
	unconfirmed.classify = 'changed-content';
	unconfirmed.commit = () => { commits += 1; unconfirmed.detachProxy(); };
	unconfirmed.relink = async (_clipId, _file, _locator, options = {}) => {
		options.changedContentProxyInvalidation?.commit();
		options.changedContentProxyInvalidation?.commit();
	};
	const reclaimed: string[] = [];
	await assert.rejects(build(unconfirmed, { cleanup: cleanupFixture(unconfirmed, reclaimed) })
		.relinkOriginal('video-source', relinkCandidate(), CHANGED), failure);
	assert.equal(commits, 1);
	assert.equal(unconfirmed.source().proxyAttachment, null);
	assert.deepEqual(reclaimed, [PROXY_KEY, TIMING_KEY]);
});

test('a failing changed-content relink is restored, cancelled or settled by the fence it reached', async () => {
	const relinkFailure = new Error('planned relink failure');
	const restoreFailure = new Error('planned undo failure');
	const cases: readonly Readonly<{
		name: string; undos: number; reclaimed: readonly string[];
		arrange: (owner: ReturnType<typeof ownerFixture>) => void;
		expected: Readonly<Record<string, unknown>> | ((error: unknown) => boolean);
	}>[] = [
		{ name: 'an asynchronous fence commit', undos: 1, reclaimed: [],
			arrange: (owner) => { owner.commit = () => Promise.resolve(); },
			expected: { message: 'Proxy invalidation must commit synchronously at the relink fence.' } },
		{ name: 'a fence commit that keeps the attachment', undos: 1, reclaimed: [],
			arrange: (owner) => { owner.commit = () => undefined; },
			expected: { message: 'Changed-content relink did not atomically invalidate the old proxy.' } },
		{ name: 'a relink that fails before the fence', undos: 0, reclaimed: [],
			arrange: (owner) => { owner.relink = async () => { throw relinkFailure; }; },
			expected: (error) => error === relinkFailure },
		{ name: 'a restoration that fails after a broken fence', undos: 1, reclaimed: [PROXY_KEY, TIMING_KEY],
			arrange: (owner) => {
				owner.commit = () => { owner.detachProxy(); };
				owner.undo = () => { throw restoreFailure; };
				owner.relink = async (_clipId, _file, _locator, options = {}) => {
					options.changedContentProxyInvalidation?.commit();
					throw relinkFailure;
				};
			},
			expected: (error) => {
				assert.equal((error as Error).cause, relinkFailure);
				assert.deepEqual((error as AggregateError).errors, [relinkFailure, restoreFailure]);
				assert.match((error as Error).message, /Original relink proxy restoration failed/u);
				return true;
			} },
		{ name: 'a relink whose project moved past the invalidation', undos: 0, reclaimed: [PROXY_KEY, TIMING_KEY],
			arrange: (owner) => {
				owner.commit = () => { owner.detachProxy(); };
				owner.relink = async (_clipId, _file, _locator, options = {}) => {
					options.changedContentProxyInvalidation?.commit();
					owner.advance();
					throw relinkFailure;
				};
			},
			expected: (error) => error === relinkFailure },
	];
	for (const { name, arrange, expected, undos, reclaimed } of cases) {
		const owner = ownerFixture(attachment());
		owner.classify = 'changed-content';
		owner.relink = async (_clipId, _file, _locator, options = {}) => {
			options.changedContentProxyInvalidation?.commit();
		};
		arrange(owner);
		const deleted: string[] = [];
		await assert.rejects(build(owner, { cleanup: cleanupFixture(owner, deleted) })
			.relinkOriginal('video-source', relinkCandidate(), CHANGED), expected);
		assert.equal(owner.undos, undos, name);
		assert.deepEqual(deleted, reclaimed, name);
		assert.deepEqual(owner.source().proxyAttachment, reclaimed.length === 0 ? attachment() : null, name);
	}
});

type RelinkCallOptions = Readonly<{
	readonly allowChangedContent?: boolean;
	readonly changedContentProxyInvalidation?: Readonly<{ commit(): void; confirmBindingPublished(): void }>;
}>;

function build(owner: ReturnType<typeof ownerFixture>, overrides: Readonly<Record<string, unknown>> = {}) {
	return createFramescaperVideoProxyActions(optionsFixture(owner, overrides) as never);
}

function optionsFixture(
	owner: ReturnType<typeof ownerFixture>, overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return { owner: owner.owner, cleanup: cleanupFixture(owner),
		createSessionId: () => 'retime-branch-session', createScheduler: scheduler(),
		createAttachExistingScheduler: scheduler(), ...overrides };
}

function ownerActions(options: Record<string, unknown>): Record<string, unknown> {
	return (options.owner as Readonly<{ actions: Record<string, unknown> }>).actions;
}

function scheduler(
	run: (request: FramescaperCapturedVideoProxyRequest) => Promise<void> = async () => undefined,
	onDispose: () => void = () => undefined,
) {
	return () => Object.assign(async (request: FramescaperCapturedVideoProxyRequest) => { await run(request); },
		{ dispose: async () => { onDispose(); } });
}

function stubCleanup(overrides: Readonly<Record<string, unknown>> = {}): FramescaperVideoProxyCleanupCoordinatorRetime {
	return { prepareReplacement: async () => ({ id: 'stub-claim' }),
		cancel: async () => undefined, settle: async () => undefined, ...overrides,
	} as unknown as FramescaperVideoProxyCleanupCoordinatorRetime;
}

function cleanupFixture(owner: ReturnType<typeof ownerFixture>, deleted: string[] = []) {
	let journal: unknown = [];
	return new FramescaperVideoProxyCleanupCoordinatorRetime({
		loadJournal: async () => structuredClone(journal),
		saveJournal: async (value) => { journal = structuredClone(value); },
		listCurrentProjects: async () => [owner.project],
		deleteBody: async (storageKey) => { deleted.push(storageKey); },
	});
}

function relinkCandidate() {
	return { file: new File(['original'], 'original.mp4', { type: 'video/mp4' }),
		locator: { locatorId: 'locator', locatorRevision: 'revision' } };
}

function ownerFixture(proxyAttachment: unknown) {
	const fixture = {
		project: projectFixture(proxyAttachment),
		refreshes: 0, undos: 0,
		canRelink: true as unknown,
		classify: 'exact-content',
		commit: (_command: unknown): unknown => undefined,
		undo: (): unknown => undefined,
		reload: async (): Promise<void> => undefined,
		relink: async (_c: string, _f: File, _l: unknown, _o: RelinkCallOptions = {}): Promise<void> => undefined,
		owner: {
			get project(): Record<string, unknown> { return fixture.project; },
			actions: {
				edit: {
					commit: (command: unknown): unknown => fixture.commit(command),
					undo: (): unknown => { fixture.undos += 1; return fixture.undo(); },
				},
				video: { reloadSourceVisual: async (): Promise<void> => {
					fixture.refreshes += 1;
					await fixture.reload();
				} },
				projectBin: {
					canRelinkLinkedVideo: async (): Promise<boolean> => fixture.canRelink as boolean,
					classifyLinkedVideoRelink: async (): Promise<string> => fixture.classify,
					relinkLinkedVideo: (clipId: string, file: File, locator: unknown,
						options: RelinkCallOptions = {}): Promise<void> => fixture.relink(clipId, file, locator, options),
				},
			},
		},
		source(): Record<string, unknown> { return (fixture.project.sources as Record<string, unknown>[])[0]!; },
		detachProxy(): void { fixture.advance(); fixture.source().proxyAttachment = null; },
		replaceProxy(value: unknown): void { fixture.advance(); fixture.source().proxyAttachment = value; },
		advance(): void {
			fixture.project = structuredClone(fixture.project);
			fixture.project.revision = Number(fixture.project.revision) + 1;
		},
	};
	return fixture;
}

function projectFixture(proxyAttachment: unknown): Record<string, unknown> {
	return { schemaFamily: 'framescaper', schemaVersion: 1, id: 'proxy-project', revision: 4,
		sources: [{ kind: 'video', id: 'video-source', contentSha256: '12'.repeat(32), proxyAttachment }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}

function attachment(proxyByte = '34', timingByte = '56'): Record<string, unknown> {
	const proxySha256 = proxyByte.repeat(32);
	const timingSha256 = timingByte.repeat(32);
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha256}`,
		mimeType: 'video/mp4', byteLength: 1_024, sha256: proxySha256,
		originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256, sourceSha256: proxySha256, byteLength: 112,
			frameCount: 10, timescale: 1_000, finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
