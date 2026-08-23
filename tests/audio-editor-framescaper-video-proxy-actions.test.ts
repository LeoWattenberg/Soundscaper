/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperVideoProxyActionRuntimeFor,
	type FramescaperVideoProxyProgress,
} from '../src/framescaper/editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperVideoProxyActionsV20,
	createFramescaperVideoProxyActionsV27,
} from '../src/framescaper/editor-video-proxy-actions-v20.ts';
import type { FramescaperCapturedVideoProxyRequest } from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';

test('selected V20 generation publishes through a disposable scheduler with progress and modes', async () => {
	const owner = ownerFixture(20, null);
	const requests: FramescaperCapturedVideoProxyRequest[] = [];
	let disposals = 0;
	const runtime = createFramescaperVideoProxyActionsV20({
		owner: owner.owner as never,
		createSessionId: () => 'editorial-session',
		createScheduler: () => Object.assign(
			async (request: FramescaperCapturedVideoProxyRequest) => { requests.push(request); },
			{ dispose: async () => { disposals += 1; } },
		),
	});
	const progress: FramescaperVideoProxyProgress[] = [];
	await runtime.generate('video-source', { onProgress: (value) => { progress.push(value); } });

	assert.equal(framescaperVideoProxyActionRuntimeFor(owner.owner), runtime);
	assert.equal(runtime.mode('video-source'), 'auto');
	await runtime.setMode('video-source', 'proxy');
	assert.equal(runtime.mode('video-source'), 'proxy');
	assert.equal(owner.refreshes, 2, 'publication and mode changes refresh the selected source');
	assert.deepEqual(requests, [{
		projectId: 'proxy-project', sessionId: 'editorial-session', sourceId: 'video-source',
		expectedProjectRevision: 4, expectedContentSha256: '12'.repeat(32),
	}]);
	assert.deepEqual(progress.map(({ phase }) => phase), [
		'queued', 'generating', 'publishing', 'complete', 'cleaning',
	]);
	assert.equal(disposals, 1);
});

test('cancelling generation disposes the exact scheduler and rejects as an abort', async () => {
	const owner = ownerFixture(20, null);
	let rejectOperation: ((error: unknown) => void) | null = null;
	let disposals = 0;
	const runtime = createFramescaperVideoProxyActionsV20({
		owner: owner.owner as never,
		createSessionId: () => 'cancel-session',
		createScheduler: () => Object.assign(
			() => new Promise<void>((_resolve, reject) => { rejectOperation = reject; }),
			{ dispose: async () => {
				disposals += 1;
				rejectOperation?.(new DOMException('cancelled', 'AbortError'));
			} },
		),
	});
	const abort = new AbortController();
	const pending = runtime.generate('video-source', { signal: abort.signal });
	abort.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
	assert.equal(disposals, 1);
});

test('detach and failed regenerate use normal history and restore only their own current edit', async () => {
	const owner = ownerFixture(20, attachment());
	const commands: unknown[] = [];
	owner.commit = (command) => {
		commands.push(command);
		owner.detach();
	};
	let undoCalls = 0;
	owner.undo = () => { undoCalls += 1; owner.restore(); };
	const runtime = createFramescaperVideoProxyActionsV20({
		owner: owner.owner as never,
		createSessionId: () => 'regenerate-session',
		createScheduler: () => Object.assign(
			async () => { throw new Error('planned generation failure'); },
			{ dispose: async () => undefined },
		),
	});

	await assert.rejects(runtime.regenerate('video-source'), /planned generation failure/u);
	assert.equal(undoCalls, 1);
	assert.equal(commands.length, 1);
	assert.equal((commands[0] as Readonly<Record<string, unknown>>).type,
		'framescaper/video-proxy-detach');
	assert.ok(owner.source().proxyAttachment);
});

test('V27 requires and uses its own detach command builder while sharing the lifecycle binder', async () => {
	const owner = ownerFixture(27, attachment());
	const commands: unknown[] = [];
	owner.commit = (command) => { commands.push(command); owner.detach(); };
	const runtime = createFramescaperVideoProxyActionsV27({
		owner: owner.owner as never,
		createSessionId: () => 'v27-session',
		createScheduler: () => Object.assign(async () => undefined, { dispose: async () => undefined }),
		createAttachExistingScheduler: () => Object.assign(
			async () => undefined, { dispose: async () => undefined },
		),
		createDetachCommand: (sourceId, expectedAttachment) => ({
			type: 'framescaper-v27/video-proxy-detach', sourceId, expectedAttachment,
		}),
	});
	await runtime.detach('video-source');
	assert.equal((commands[0] as Readonly<Record<string, unknown>>).type,
		'framescaper-v27/video-proxy-detach');
	assert.equal(framescaperVideoProxyActionRuntimeFor(owner.owner), runtime);
});

test('adaptive pressure refreshes Auto only when it crosses the proxy threshold', async () => {
	const owner = ownerFixture(27, attachment());
	const runtime = createFramescaperVideoProxyActionsV27({
		owner: owner.owner as never,
		createSessionId: () => 'v27-pressure-session',
		createScheduler: () => Object.assign(async () => undefined, { dispose: async () => undefined }),
		createAttachExistingScheduler: () => Object.assign(
			async () => undefined, { dispose: async () => undefined },
		),
		createDetachCommand: () => ({ type: 'framescaper-v27/video-proxy-detach' }),
	});
	await runtime.reportPreviewPressure('video-source', {
		droppedFrameRatio: 0, decodeQueueDepth: 0, viewportScale: 1,
	});
	assert.equal(owner.refreshes, 0);
	await runtime.reportPreviewPressure('video-source', {
		droppedFrameRatio: 0.03, decodeQueueDepth: 0, viewportScale: 1,
	});
	assert.equal(owner.refreshes, 1);
	assert.deepEqual(runtime.pressure('video-source'), {
		droppedFrameRatio: 0.03, decodeQueueDepth: 0, viewportScale: 1,
	});
});

test('original relink uses the maintained exact-content classification and confirms changed content', async () => {
	const owner = ownerFixture(27, attachment());
	let classification: 'exact-content' | 'changed-content' = 'exact-content';
	const relinks: Readonly<{ readonly allowChangedContent?: boolean }>[] = [];
	let detachCommands = 0;
	owner.commit = () => { detachCommands += 1; owner.detach(); };
	owner.owner.actions.projectBin.classifyLinkedVideoRelink = async () => classification;
	owner.owner.actions.projectBin.relinkLinkedVideo = async (_clipId, _file, _locator, options = {}) => {
		relinks.push(options);
	};
	const runtime = createFramescaperVideoProxyActionsV27({
		owner: owner.owner as never,
		createSessionId: () => 'v27-relink-session',
		createScheduler: () => Object.assign(async () => undefined, { dispose: async () => undefined }),
		createAttachExistingScheduler: () => Object.assign(
			async () => undefined, { dispose: async () => undefined },
		),
		createDetachCommand: () => ({ type: 'framescaper-v27/video-proxy-detach' }),
	});
	const candidate = {
		file: new File(['original'], 'original.mp4', { type: 'video/mp4' }),
		locator: { locatorId: 'locator', locatorRevision: 'revision' },
	};

	assert.equal(await runtime.relinkOriginal('video-source', candidate), 'relinked');
	classification = 'changed-content';
	assert.equal(await runtime.relinkOriginal('video-source', candidate), 'confirmation-required');
	assert.equal(relinks.length, 1);
	assert.equal(detachCommands, 0);
	assert.equal(await runtime.relinkOriginal(
		'video-source', candidate, { allowChangedContent: true },
	), 'relinked');
	assert.deepEqual(relinks, [{}, { allowChangedContent: true }]);
	assert.equal(detachCommands, 1);
	assert.equal(owner.source().proxyAttachment, null);
});

test('V27 attaches a pathless existing body through the atomic scheduler with progress', async () => {
	const owner = ownerFixture(27, null);
	const candidate = new File(['existing-proxy'], 'proxy.webm', { type: 'video/webm' });
	const requests: FramescaperCapturedVideoProxyRequest[] = [];
	let observedCandidate: Blob | null = null;
	let disposals = 0;
	const runtime = createFramescaperVideoProxyActionsV27({
		owner: owner.owner as never,
		createSessionId: () => 'v27-existing-session',
		createScheduler: () => Object.assign(async () => undefined, { dispose: async () => undefined }),
		createAttachExistingScheduler: (value) => {
			observedCandidate = value;
			return Object.assign(
				async (request: FramescaperCapturedVideoProxyRequest) => { requests.push(request); },
				{ dispose: async () => { disposals += 1; } },
			);
		},
		createDetachCommand: () => ({ type: 'framescaper-v27/video-proxy-detach' }),
	});
	const progress: FramescaperVideoProxyProgress[] = [];
	await runtime.attachExisting('video-source', candidate, {
		onProgress: (value) => { progress.push(value); },
	});

	assert.equal(observedCandidate, candidate);
	assert.deepEqual(requests, [{
		projectId: 'proxy-project', sessionId: 'v27-existing-session', sourceId: 'video-source',
		expectedProjectRevision: 4, expectedContentSha256: '12'.repeat(32),
	}]);
	assert.deepEqual(progress.map(({ phase }) => phase), [
		'queued', 'validating', 'publishing', 'complete', 'cleaning',
	]);
	assert.equal(disposals, 1);
	assert.equal(owner.refreshes, 1);
});

test('cancelling an existing-body attachment disposes its exact scheduler', async () => {
	const owner = ownerFixture(27, null);
	let rejectOperation: ((error: unknown) => void) | null = null;
	let disposals = 0;
	const runtime = createFramescaperVideoProxyActionsV27({
		owner: owner.owner as never,
		createSessionId: () => 'v27-existing-cancel-session',
		createScheduler: () => Object.assign(async () => undefined, { dispose: async () => undefined }),
		createAttachExistingScheduler: () => Object.assign(
			() => new Promise<void>((_resolve, reject) => { rejectOperation = reject; }),
			{ dispose: async () => {
				disposals += 1;
				rejectOperation?.(new DOMException('cancelled', 'AbortError'));
			} },
		),
		createDetachCommand: () => ({ type: 'framescaper-v27/video-proxy-detach' }),
	});
	const abort = new AbortController();
	const pending = runtime.attachExisting(
		'video-source', new Blob(['proxy'], { type: 'video/webm' }), { signal: abort.signal },
	);
	abort.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
	assert.equal(disposals, 1);
});

function ownerFixture(schemaVersion: 20 | 27, proxyAttachment: unknown) {
	let prior: Record<string, unknown> | null = null;
	let project = projectFixture(schemaVersion, proxyAttachment);
	const fixture = {
		commit: (_command: unknown): unknown => undefined,
		undo: (): unknown => undefined,
		refreshes: 0,
		owner: {
			get project() { return project; },
			actions: {
				edit: {
					commit: (command: unknown) => fixture.commit(command),
					undo: () => fixture.undo(),
				},
				video: {
					reloadSourceVisual: async () => { fixture.refreshes += 1; },
				},
				projectBin: {
					canRelinkLinkedVideo: async () => true,
					classifyLinkedVideoRelink: async (): Promise<'exact-content' | 'changed-content'> => 'exact-content',
					relinkLinkedVideo: async (
						_clipId: string,
						_file: File,
						_locator: Readonly<{ locatorId: string; locatorRevision: string }>,
						_options: Readonly<{ allowChangedContent?: boolean }> = {},
					) => undefined,
				},
			},
		},
		detach() {
			prior = project;
			project = structuredClone(project);
			fixture.source().proxyAttachment = null;
			project.revision = Number(project.revision) + 1;
		},
		restore() {
			if (prior) project = prior;
		},
		source(): Record<string, unknown> {
			return (project.sources as Record<string, unknown>[])[0]!;
		},
	};
	return fixture;
}

function projectFixture(schemaVersion: 20 | 27, proxyAttachment: unknown): Record<string, unknown> {
	return {
		schemaVersion, id: 'proxy-project', revision: 4,
		sources: [{
			kind: 'video', id: 'video-source', contentSha256: '12'.repeat(32),
			proxyAttachment,
		}],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}

function attachment(): Record<string, unknown> {
	const proxySha256 = '34'.repeat(32);
	const timingSha256 = '56'.repeat(32);
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
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256, sourceSha256: proxySha256,
			byteLength: 112, frameCount: 10, timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
