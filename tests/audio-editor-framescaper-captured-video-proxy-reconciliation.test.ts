/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperCaptureDerivativeScheduler,
	createFramescaperCaptureProxyActiveProjectSynchronizer,
	type FramescaperCapturedVideoProxyActiveUpdate,
} from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV18,
	createFramescaperCapturedVideoProxySchedulerV19,
	type FramescaperCapturedVideoProxyRuntimeComposition,
} from '../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	FramescaperDesktopProjectLibraryV10CommittedError,
	type FramescaperDesktopProjectLibraryV10Renderer,
} from '../src/framescaper/desktop-project-library-v10-renderer.ts';
import type { FramescaperEditorProjectEnvironmentV18 } from '../src/framescaper/editor-project-environment-v18.ts';
import type { FramescaperEditorProjectEnvironmentV19 } from '../src/framescaper/editor-project-environment-v19.ts';
import { FramescaperDesktopV10MainFixture } from './helpers/framescaper-desktop-v10-store-fixture.ts';
import {
	capturedProxyRequest,
	capturedVideoSource,
	createCapturedProxyFixture,
	type CapturedProxyFixture,
} from './helpers/framescaper-captured-video-proxy-fixture.ts';
import { ORIGINAL_SOURCE_ID } from './helpers/video-proxy-relationship-fixtures.ts';

test('a landed desktop target retries claim cleanup and then installs its session history', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	const cleanup = fixture.environment.claimCleanup as unknown as {
		cleanupOperation: (...args: unknown[]) => Promise<unknown>;
	};
	const cleanupOperation = cleanup.cleanupOperation.bind(cleanup);
	const retryGate = deferred<void>();
	let cleanupCalls = 0;
	cleanup.cleanupOperation = async (...args) => {
		cleanupCalls += 1;
		if (cleanupCalls === 1) throw new Error('planned landed cleanup failure');
		await retryGate.promise;
		return cleanupOperation(...args);
	};
	context.after(() => { cleanup.cleanupOperation = cleanupOperation; });
	const request = capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256);

	await assert.rejects(fixture.schedule(request), /Captured proxy cleanup failed/u);
	const landed = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(landed && capturedVideoSource(landed, ORIGINAL_SOURCE_ID).proxyAttachment);
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision));

	await waitFor(() => cleanupCalls === 2, 'automatic cleanup retry did not start');
	retryGate.resolve();
	await waitFor(
		() => originTabRevision(fixture) === Number(fixture.origin.revision) + 1,
		'automatic cleanup retry did not install the landed target',
	);
	assert.equal(cleanupCalls, 2);
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision) + 1);
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
});

test('a typed desktop commit survives its failed first reread and automatically reconciles', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	const retryGate = deferred<void>();
	const injected = injectCommittedDesktopRereadFailure(context, fixture, retryGate.promise);
	const cleanup = fixture.environment.claimCleanup as unknown as {
		cleanupOperation: (...args: unknown[]) => Promise<unknown>;
	};
	const cleanupOperation = cleanup.cleanupOperation.bind(cleanup);
	let cleanupCalls = 0;
	cleanup.cleanupOperation = (...args) => { cleanupCalls += 1; return cleanupOperation(...args); };
	context.after(() => { cleanup.cleanupOperation = cleanupOperation; });
	const publicationsBefore = main.publications;

	await assert.rejects(
		fixture.schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/requires renderer reconciliation/iu,
	);
	await waitFor(() => injected.readsAfterCommit() === 2, 'automatic authoritative reread did not start');
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision));
	assert.equal(main.publications, publicationsBefore + 1);
	assert.equal(cleanupCalls, 0, 'claim cleanup waits for authoritative shadow reconciliation');
	retryGate.resolve();

	await waitFor(
		() => originTabRevision(fixture) === Number(fixture.origin.revision) + 1,
		'typed committed target did not reconcile into its session',
	);
	assert.equal(injected.committedFailures(), 1);
	assert.equal(cleanupCalls, 1);
	assert.equal(main.publications, publicationsBefore + 1, 'reconciliation never republishes the media');
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
});

test('an indeterminate desktop acknowledgement retains exact evidence until main proves target', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	const publicationsBefore = main.publications;
	main.finishFailureAfterCommit = new Error('planned lost main finish acknowledgement');
	main.afterFinishCommit = () => {
		main.failNextReads(
			String(fixture.origin.id),
			2,
			new Error('planned immediate authoritative reread failure'),
		);
	};
	const laterRead = deferred<void>();
	let publicationReads = 0;
	main.beforeRead = async (projectId) => {
		if (projectId !== fixture.origin.id || main.publications === publicationsBefore) return;
		publicationReads += 1;
		if (publicationReads === 3) await laterRead.promise;
	};
	const cleanup = fixture.environment.claimCleanup as unknown as {
		cleanupOperation: (...args: unknown[]) => Promise<unknown>;
	};
	const cleanupOperation = cleanup.cleanupOperation.bind(cleanup);
	let cleanupCalls = 0;
	cleanup.cleanupOperation = (...args) => { cleanupCalls += 1; return cleanupOperation(...args); };
	context.after(() => { cleanup.cleanupOperation = cleanupOperation; });
	await assert.rejects(
		fixture.schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/outcome requires authoritative reconciliation/iu,
	);
	await waitFor(() => publicationReads === 3, 'automatic authoritative outcome proof did not start');
	assert.equal(main.publications, publicationsBefore + 1, 'main may already own the exact proxy target');
	assert.equal(cleanupCalls, 0, 'indeterminate ownership keeps operation claims rooted');
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision));
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
	laterRead.resolve();

	await waitFor(
		() => originTabRevision(fixture) === Number(fixture.origin.revision) + 1,
		'indeterminate main target did not reconcile into its predecessor session',
	);
	assert.equal(main.publications, publicationsBefore + 1, 'authority proof never republishes media');
	assert.equal(cleanupCalls, 1);
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
	const durable = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(durable && capturedVideoSource(durable, ORIGINAL_SOURCE_ID).proxyAttachment);
});

test('the one-shot production derivative path warns and automatically retries landed installation', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19);
	const retryGate = deferred<void>();
	const failing = installFailingSession(fixture.session, retryGate.promise);
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
		failing.session,
		composition(fixture),
	);
	const derivativeCalls: string[] = [];
	const derivatives = createFramescaperCaptureDerivativeScheduler({
		getOriginProject: () => fixture.origin as never,
		store: {
			getSourceMetadata: () => null,
			loadMediaAsset: async (sourceId) => {
				const body = await fixture.environment.store.loadMediaAsset(sourceId);
				return body instanceof Blob ? body : null;
			},
			saveVideoDerivative: () => undefined,
		},
		activateStoredSource: () => undefined,
		createVideoFrameExtractor: () => ({
			metadata: Object.freeze({ durationSeconds: 1, width: 16, height: 16 }),
			capture: (timestampSeconds) => Object.freeze({
				timestampSeconds, width: 16, height: 16, mimeType: 'image/webp',
				blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
			}),
			dispose: () => undefined,
		}),
		videoThumbnailTimes: () => Object.freeze([]),
		scheduleProxy: (request) => {
			derivativeCalls.push(request.sourceId);
			return schedule(request);
		},
	});
	const warning = deferred<unknown>();
	void Promise.resolve().then(() => derivatives({
		projectId: String(fixture.origin.id),
		sessionId: 'captured-session',
		sourceIds: Object.freeze([ORIGINAL_SOURCE_ID]),
		plan: Object.freeze({
			destination: 'both', command: Object.freeze({ type: 'batch', commands: Object.freeze([]) }),
			entries: Object.freeze([{ sourceId: ORIGINAL_SOURCE_ID }]),
		}) as never,
	})).catch((error: unknown) => { warning.resolve(error); });

	assert.match(String(await warning.promise), /capture derivatives completed with failures/iu);
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision));
	assert.ok(capturedVideoSource(
		await fixture.environment.store.loadProject(String(fixture.origin.id)),
		ORIGINAL_SOURCE_ID,
	).proxyAttachment);

	await waitFor(() => failing.installationCalls() === 2, 'automatic installation retry did not start');
	retryGate.resolve();
	await waitFor(
		() => originTabRevision(fixture) === Number(fixture.origin.revision) + 1,
		'automatic installation retry did not install the landed target',
	);
	assert.deepEqual(derivativeCalls, [ORIGINAL_SOURCE_ID], 'canonical derivatives invoke the proxy scheduler once');
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision) + 1);
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
});

test('a landed active target retries playback synchronization after app state changed', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 18);
	fixture.session.switchProject(String(fixture.origin.id));
	let appProject = fixture.origin;
	let appHistory = originTab(fixture).history as Record<string, unknown>;
	let playbackProject: Readonly<Record<string, unknown>> = fixture.origin;
	let publishedProject: Readonly<Record<string, unknown>> = fixture.origin;
	const retryGate = deferred<void>();
	let failPlayback = true;
	const synchronizeActiveProject = createFramescaperCaptureProxyActiveProjectSynchronizer({
		getActiveProject: () => appProject,
		setActiveProject: (project) => { appProject = project; },
		setActiveHistory: (history) => { appHistory = history; },
		applyProjectToPlaybackEngine: async (project) => {
			if (failPlayback) {
				failPlayback = false;
				throw new Error('planned playback synchronization failure');
			}
			await retryGate.promise;
			playbackProject = project;
		},
		publishProjectState: () => { publishedProject = appProject; },
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV18(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV18>,
		fixture.session,
		composition(fixture, synchronizeActiveProject),
	);
	const request = capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256);

	await assert.rejects(schedule(request), /planned playback synchronization failure/u);
	assert.equal(Number(appProject.revision), Number(fixture.origin.revision) + 1);
	assert.equal(appHistory.present, appProject);
	assert.equal(playbackProject, fixture.origin);
	assert.equal(publishedProject, fixture.origin);

	retryGate.resolve();
	await waitFor(() => playbackProject === appProject && publishedProject === appProject,
		'automatic playback reconciliation did not complete');
	assert.equal(playbackProject, appProject);
	assert.equal(publishedProject, appProject);
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
});

test('a landed active target retries app snapshot publication after playback changed', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19);
	fixture.session.switchProject(String(fixture.origin.id));
	let appProject = fixture.origin;
	let appHistory = originTab(fixture).history as Record<string, unknown>;
	let playbackProject: Readonly<Record<string, unknown>> = fixture.origin;
	let publishedProject: Readonly<Record<string, unknown>> = fixture.origin;
	const retryGate = deferred<void>();
	let failPublication = true;
	const synchronizeActiveProject = createFramescaperCaptureProxyActiveProjectSynchronizer({
		getActiveProject: () => appProject,
		setActiveProject: (project) => { appProject = project; },
		setActiveHistory: (history) => { appHistory = history; },
		applyProjectToPlaybackEngine: async (project) => {
			if (!failPublication) await retryGate.promise;
			playbackProject = project;
		},
		publishProjectState: () => {
			if (failPublication) {
				failPublication = false;
				throw new Error('planned snapshot publication failure');
			}
			publishedProject = appProject;
		},
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
		fixture.session,
		composition(fixture, synchronizeActiveProject),
	);
	const request = capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256);

	await assert.rejects(schedule(request), /planned snapshot publication failure/u);
	assert.equal(playbackProject, appProject);
	assert.equal(publishedProject, fixture.origin);

	retryGate.resolve();
	await waitFor(() => publishedProject === appProject,
		'automatic snapshot publication reconciliation did not complete');
	assert.equal(appHistory.present, appProject);
	assert.equal(playbackProject, appProject);
	assert.equal(publishedProject, appProject);
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
});

test('scheduler disposal shuts down a queued automatic reconciliation retry', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19);
	let installationCalls = 0;
	const session = Object.freeze({
		getSnapshot: () => fixture.session.getSnapshot(),
		captureProjectHistory: (projectId: string) => fixture.session.captureProjectHistory(projectId),
		assertProjectHistoryToken: (projectId: string, token: object) => (
			fixture.session.assertProjectHistoryToken(projectId, token)
		),
		beginProjectActivation: (
			projectId: string,
			options: Parameters<typeof fixture.session.beginProjectActivation>[1],
		) => fixture.session.beginProjectActivation(projectId, options),
		installCommittedProjectHistory: () => {
			installationCalls += 1;
			throw new Error('planned persistent installation failure');
		},
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
		session,
		composition(fixture),
	);

	await assert.rejects(
		schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/planned persistent installation failure/u,
	);
	await schedule.dispose();
	await new Promise<void>((resolve) => { setImmediate(resolve); });

	assert.equal(installationCalls, 1);
	assert.equal(fixture.relationship.counters.generatorCalls, 1);
	await assert.rejects(
		schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/disposed|cancel/iu,
	);
});

test('retry exhaustion stays bounded and retains exact evidence for later explicit recovery', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19, true);
	let installationCalls = 0;
	let failInstallation = true;
	const session = Object.freeze({
		getSnapshot: () => fixture.session.getSnapshot(),
		captureProjectHistory: (projectId: string) => fixture.session.captureProjectHistory(projectId),
		assertProjectHistoryToken: (projectId: string, token: object) => (
			fixture.session.assertProjectHistoryToken(projectId, token)
		),
		beginProjectActivation: (
			projectId: string,
			options: Parameters<typeof fixture.session.beginProjectActivation>[1],
		) => fixture.session.beginProjectActivation(projectId, options),
		installCommittedProjectHistory: (
			projectId: string,
			history: Parameters<typeof fixture.session.installCommittedProjectHistory>[1],
			options: Parameters<typeof fixture.session.installCommittedProjectHistory>[2],
		) => {
			installationCalls += 1;
			if (failInstallation) throw new Error('planned persistent retry exhaustion');
			return fixture.session.installCommittedProjectHistory(projectId, history, options);
		},
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
		session,
		{
			...composition(fixture),
			maximumReconciliationAttempts: 2,
			maximumLandedEntries: 1,
		},
	);
	const request = capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256);

	await assert.rejects(schedule(request), /planned persistent retry exhaustion/u);
	await waitFor(() => installationCalls === 3, 'bounded automatic retries did not exhaust');
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(installationCalls, 3, 'no microtask runs after exact retry exhaustion');
	await assert.rejects(
		schedule(capturedProxyRequest(fixture.origin, 'second-video', fixture.originalSha256)),
		/landed reconciliation capacity/iu,
	);
	assert.equal(fixture.relationship.counters.generatorCalls, 1, 'bounded ownership applies before regeneration');
	failInstallation = false;
	await schedule(request);
	assert.equal(installationCalls, 4, 'an explicit retry retains exact predecessor-to-target evidence');
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision) + 1);
	await schedule(capturedProxyRequest(fixture.origin, 'second-video', fixture.originalSha256));
	assert.equal(fixture.relationship.counters.generatorCalls, 2);
});

function composition(
	fixture: CapturedProxyFixture,
	synchronizeActiveProject?: (update: FramescaperCapturedVideoProxyActiveUpdate) => PromiseLike<unknown> | unknown,
): FramescaperCapturedVideoProxyRuntimeComposition {
	return {
		runtime: null,
		candidateObserver: fixture.relationship.candidateObserver,
		...(synchronizeActiveProject ? { synchronizeActiveProject } : {}),
	};
}

function installFailingSession(
	session: CapturedProxyFixture['session'],
	retryGate: Promise<void>,
): Readonly<{ readonly session: unknown; installationCalls(): number }> {
	let failInstallation = true;
	let installationCalls = 0;
	return Object.freeze({
		installationCalls: () => installationCalls,
		session: Object.freeze({
		getSnapshot: () => session.getSnapshot(),
		captureProjectHistory: (projectId: string) => session.captureProjectHistory(projectId),
		assertProjectHistoryToken: (projectId: string, token: object) => (
			session.assertProjectHistoryToken(projectId, token)
		),
		beginProjectActivation: (
			projectId: string,
			options: Parameters<typeof session.beginProjectActivation>[1],
		) => session.beginProjectActivation(projectId, options),
		installCommittedProjectHistory: async (
			projectId: string,
			history: Parameters<typeof session.installCommittedProjectHistory>[1],
			options: Parameters<typeof session.installCommittedProjectHistory>[2],
		) => {
			installationCalls += 1;
			if (failInstallation) {
				failInstallation = false;
				throw new Error('planned history installation failure');
			}
			await retryGate;
			return session.installCommittedProjectHistory(projectId, history, options);
		},
		}),
	});
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((settle) => { resolve = settle; });
	return Object.freeze({ promise, resolve });
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	assert.fail(message);
}

function injectCommittedDesktopRereadFailure(
	context: TestContext,
	fixture: CapturedProxyFixture,
	retryGate: Promise<void>,
): Readonly<{ readonly readsAfterCommit: () => number; readonly committedFailures: () => number }> {
	const environment = fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV18>;
	const renderer = environment.desktopProjectLibrary;
	assert.ok(renderer);
	const prototype = Object.getPrototypeOf(renderer) as FramescaperDesktopProjectLibraryV10Renderer;
	const publishDescriptor = Object.getOwnPropertyDescriptor(prototype, 'publishProject');
	const readDescriptor = Object.getOwnPropertyDescriptor(prototype, 'readProject');
	assert.ok(publishDescriptor?.value && readDescriptor?.value);
	const publishProject = publishDescriptor.value as FramescaperDesktopProjectLibraryV10Renderer['publishProject'];
	const readProject = readDescriptor.value as FramescaperDesktopProjectLibraryV10Renderer['readProject'];
	let committedFailures = 0;
	let committed = false;
	let readsAfterCommit = 0;
	Object.defineProperties(prototype, {
		publishProject: {
			...publishDescriptor,
			value: async function publishWithCommittedFailure(
				this: FramescaperDesktopProjectLibraryV10Renderer,
				request: Parameters<FramescaperDesktopProjectLibraryV10Renderer['publishProject']>[0],
			) {
				const published = await Reflect.apply(publishProject, this, [request]);
				committed = true;
				committedFailures += 1;
				throw new FramescaperDesktopProjectLibraryV10CommittedError(
					'publication', String(published.id), new Error('planned renderer settlement failure'),
				);
			},
		},
		readProject: {
			...readDescriptor,
			value: async function readWithFirstFailure(
				this: FramescaperDesktopProjectLibraryV10Renderer,
				projectId: string,
				options?: Readonly<{ signal?: AbortSignal }>,
			) {
				if (committed) {
					readsAfterCommit += 1;
					if (readsAfterCommit === 1) throw new Error('planned first authoritative reread failure');
					if (readsAfterCommit === 2) await retryGate;
				}
				return Reflect.apply(readProject, this, options === undefined
					? [projectId]
					: [projectId, options]);
			},
		},
	});
	context.after(() => {
		Object.defineProperties(prototype, {
			publishProject: publishDescriptor,
			readProject: readDescriptor,
		});
	});
	return Object.freeze({
		readsAfterCommit: () => readsAfterCommit,
		committedFailures: () => committedFailures,
	});
}

function originTab(fixture: CapturedProxyFixture): Readonly<{
	readonly history: Readonly<Record<string, unknown>>;
}> {
	const tab = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.origin.id,
	);
	assert.ok(tab);
	return tab as unknown as Readonly<{ readonly history: Readonly<Record<string, unknown>> }>;
}

function originTabRevision(fixture: CapturedProxyFixture): number {
	return Number((originTab(fixture).history.present as Record<string, unknown>).revision);
}
