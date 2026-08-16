/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_SMOKE_PREFIX,
	parseDesktopSmokeConfiguration,
	runProjectLibraryRendererSmoke,
} from '../desktop/desktop-smoke.js';
import {
	DESKTOP_DIRECT_WAV_SMOKE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS,
} from '../desktop/direct-wav-smoke.js';
import {
	DIRECT_WAV_TARGET_PATHS,
	validDesktopDirectWavNativeEvidence,
	validDesktopDirectWavRendererResult,
} from './helpers/desktop-direct-wav-smoke-probe.js';
import {
	DIRECT_WAV_MODE,
	DIRECT_WAV_TOKEN,
	HANDOFF_MODE,
	MODE,
	PROJECT_ID,
	canonicalJson,
	descriptor,
	directWavArgv,
	encodePlan,
	escapeRegex,
	flushAsync,
	handoffPlan,
	lifecycleArgv,
	lifecycleArgvEncoded,
	planArgument,
	probeFixture,
	projectDocument,
	rendererScope,
} from './helpers/desktop-smoke-probe-fixture.mjs';

test('desktop smoke configuration preserves the base artifact probe', () => {
	assert.deepEqual(parseDesktopSmokeConfiguration(['/opt/Soundscaper']), {
		mode: 'disabled',
		plan: null,
	});
	assert.deepEqual(parseDesktopSmokeConfiguration([
		'/opt/Soundscaper',
		'--soundscaper-smoke',
	]), {
		mode: 'artifact',
		plan: null,
	});
});

test('project-library smoke plans require one closed canonical base64url JSON value', () => {
	const plan = handoffPlan();
	const parsed = parseDesktopSmokeConfiguration(lifecycleArgv(plan));
	assert.deepEqual(parsed, { mode: MODE, plan });
	assert.equal(Object.isFrozen(parsed), true);
	assert.equal(Object.isFrozen(parsed.plan), true);
	assert.equal(Object.isFrozen(parsed.plan?.target), true);

	assert.throws(() => parseDesktopSmokeConfiguration([
		...lifecycleArgv(plan),
		HANDOFF_MODE,
	]), /exactly one.*smoke mode|duplicate.*smoke mode/iu);
	assert.throws(() => parseDesktopSmokeConfiguration([
		...lifecycleArgv(plan),
		planArgument(plan),
	]), /exactly one.*smoke plan|duplicate.*smoke plan/iu);
	assert.throws(() => parseDesktopSmokeConfiguration([
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		HANDOFF_MODE,
	]), /requires.*smoke plan/iu);
	assert.throws(() => parseDesktopSmokeConfiguration([
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		'--soundscaper-smoke-mode=unknown-v1',
	]), /unsupported.*smoke mode/iu);
	assert.throws(() => parseDesktopSmokeConfiguration([
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		planArgument(plan),
	]), /plan.*project-library.*mode/iu);

	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgv({ ...plan, unexpected: true })),
		/unsupported field|closed/iu,
	);
	const spacedJson = ` ${canonicalJson(plan)}`;
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgvEncoded(Buffer.from(spacedJson).toString('base64url'))),
		/canonical.*JSON/iu,
	);
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgvEncoded(
			Buffer.from(JSON.stringify(plan), 'utf8').toString('base64url'),
		)),
		/canonical.*JSON/iu,
	);
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgvEncoded(`${encodePlan(plan)}=`)),
		/canonical.*base64url/iu,
	);
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgvEncoded(Buffer.alloc(64 * 1024 + 1).toString('base64url'))),
		/64 KiB|65,536|byte limit/iu,
	);
});

test('project-library smoke plan stages close previous and target descriptors', () => {
	for (const [stage, productId, previousDocument, revision] of [
		['publish', 'soundscaper', null, 1],
		['advance', 'framescaper', projectDocument(1, 'Soundscaper revision'), 2],
		['return', 'soundscaper', projectDocument(2, 'Framescaper revision'), 3],
	]) {
		const plan = handoffPlan({ stage, productId, previousDocument, revision });
		const parsed = parseDesktopSmokeConfiguration(lifecycleArgv(plan));
		assert.equal(parsed.plan?.stage, stage);
		assert.deepEqual(parsed.plan?.previous, previousDocument === null ? null : descriptor(previousDocument));
	}
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgv(handoffPlan({ stage: 'verify' }))),
		/unsupported.*stage|stage.*publish.*advance.*return/iu,
	);
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgv(handoffPlan({
			previousDocument: projectDocument(0, 'Existing'),
		}))),
		/publish.*previous.*null|previous.*publish/iu,
	);
	assert.throws(
		() => parseDesktopSmokeConfiguration(lifecycleArgv(handoffPlan({
			stage: 'advance',
			productId: 'framescaper',
			previousDocument: null,
		}))),
		/advance.*previous|previous.*descriptor/iu,
	);
});

test('renderer handoff verifies previous digest, commits target, rereads, and filters scratch projects', async () => {
	const previousDocument = projectDocument(1, 'Soundscaper revision');
	const targetDocument = projectDocument(2, 'Framescaper revision');
	const plan = handoffPlan({
		stage: 'advance',
		productId: 'framescaper',
		previousDocument,
		revision: 2,
		title: 'Framescaper revision',
	});
	const calls = [];
	let current = previousDocument;
	const scope = rendererScope({
		readSharedProject: async (projectId) => {
			calls.push(`read:${projectId}`);
			return current;
		},
		commitSharedProject: async (request) => {
			calls.push(`commit:${request.document}:${String(request.expectedRevision)}`);
			current = request.document;
			return { status: 'committed', document: request.document };
		},
		listSharedProjects: async () => {
			calls.push('list');
			return [
				{ id: 'ui-scratch-project', title: 'Scratch', revision: 1, updatedAt: '2026-07-30T12:00:00.000Z' },
				{ id: PROJECT_ID, title: 'Framescaper revision', revision: 2, updatedAt: '2026-07-30T12:01:00.000Z' },
			];
		},
	});

	const result = await runProjectLibraryRendererSmoke(scope, plan);

	assert.deepEqual(calls, [
		`read:${PROJECT_ID}`,
		`commit:${targetDocument}:1`,
		`read:${PROJECT_ID}`,
		'list',
	]);
	assert.deepEqual(result, {
		summary: { id: PROJECT_ID, title: 'Framescaper revision', revision: 2 },
	});
	assert.doesNotMatch(JSON.stringify(result), /schemaVersion|sources|projectBin/iu);
});

test('renderer handoff refuses previous drift, noncanonical text, and source-bearing targets before commit', async () => {
	const previousDocument = projectDocument(1, 'Soundscaper revision');
	const validPlan = handoffPlan({
		stage: 'advance',
		productId: 'framescaper',
		previousDocument,
		revision: 2,
		title: 'Framescaper revision',
	});
	let commitCalls = 0;
	const api = {
		readSharedProject: async () => projectDocument(1, 'Drifted title'),
		commitSharedProject: async (document) => {
			commitCalls += 1;
			return document;
		},
		listSharedProjects: async () => [],
	};
	await assert.rejects(
		() => runProjectLibraryRendererSmoke(rendererScope(api), validPlan),
		/previous.*descriptor|SHA-256|changed before.*handoff/iu,
	);
	assert.equal(commitCalls, 0);

	const noncanonical = handoffPlan({ targetDocument: ` ${projectDocument(1, 'Revision')}` });
	await assert.rejects(
		() => runProjectLibraryRendererSmoke(rendererScope({ ...api, readSharedProject: async () => null }), noncanonical),
		/canonical.*document/iu,
	);
	assert.equal(commitCalls, 0);

	const sourceBearingDocument = projectDocument(1, 'Revision', {
		sources: [{ id: 'source-1' }],
	});
	const sourceBearing = handoffPlan({ targetDocument: sourceBearingDocument });
	await assert.rejects(
		() => runProjectLibraryRendererSmoke(rendererScope({ ...api, readSharedProject: async () => null }), sourceBearing),
		/source-free/iu,
	);
	assert.equal(commitCalls, 0);
});

test('base artifact smoke remains did-finish-load driven', async () => {
	const fixture = probeFixture({ argv: ['/opt/Soundscaper', '--soundscaper-smoke'] });
	fixture.probe.attach(fixture.window);
	assert.equal(fixture.window.webContents.executions.length, 0);

	await fixture.window.webContents.emit('did-finish-load');

	assert.equal(fixture.window.webContents.executions.length, 1);
	assert.deepEqual(fixture.exits, [0]);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], /^SOUNDSCAPER_DESKTOP_SMOKE /u);
	assert.equal(fixture.evidenceCalls.length, 0);
});

test('project-library lifecycle waits for renderer ready and emits only the runner contract', async () => {
	const previousDocument = projectDocument(1, 'Soundscaper revision');
	const plan = handoffPlan({
		stage: 'advance',
		productId: 'framescaper',
		previousDocument,
		revision: 2,
		title: 'Framescaper revision',
	});
	const fixture = probeFixture({
		argv: lifecycleArgv(plan),
		executionResult: {
			summary: { id: PROJECT_ID, title: 'Framescaper revision', revision: 2 },
		},
		productId: 'framescaper',
		appName: 'Framescaper',
		appOrigin: 'framescaper-app://bundle',
		plan,
	});
	fixture.probe.attach(fixture.window);
	await fixture.window.webContents.emit('did-finish-load');
	assert.equal(fixture.window.webContents.executions.length, 0, 'load completion must not start handoff');

	await fixture.probe.rendererReady();

	assert.equal(fixture.window.webContents.executions.length, 1);
	assert.deepEqual(fixture.exits, [0]);
	assert.deepEqual(fixture.evidenceCalls, [PROJECT_ID]);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], new RegExp(`^${DESKTOP_PROJECT_LIBRARY_SMOKE_PREFIX} `, 'u'));
	const payload = JSON.parse(fixture.logs[0].slice(DESKTOP_PROJECT_LIBRARY_SMOKE_PREFIX.length + 1));
	assert.deepEqual(payload, {
		schemaVersion: 1,
		mode: MODE,
		stage: 'advance',
		productId: 'framescaper',
		project: {
			id: PROJECT_ID,
			title: 'Framescaper revision',
			revision: 2,
			sha256: plan.target.sha256,
		},
		summary: { id: PROJECT_ID, title: 'Framescaper revision', revision: 2 },
		host: {
			owner: { product: 'framescaper' },
			fencingToken: 2,
			tookOverStaleLease: false,
			recovery: { outcome: 'clean' },
		},
		preferredProduct: 'framescaper',
		catalogRevision: 7,
	});
	const serialized = JSON.stringify(payload);
	assert.doesNotMatch(serialized, new RegExp(escapeRegex(plan.target.document), 'u'));
	assert.doesNotMatch(serialized, /private-instance|processId|metadataFile/iu);
});

test('direct-WAV lifecycle resolves only smoke targets and emits bounded renderer and native evidence', async () => {
	const plan = {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
	};
	const selections = [];
	const targetPaths = DIRECT_WAV_TARGET_PATHS;
	const fixture = probeFixture({
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
			`--soundscaper-smoke-plan=${encodePlan(plan)}`,
			'--soundscaper-smoke-app-data=/private/smoke-root',
		],
		executionResult: validDesktopDirectWavRendererResult(),
		directWavTargetHarness: {
			async resolveSavePath(choice) {
				selections.push(choice.purpose);
				return targetPaths[selections.length - 1] ?? null;
			},
			async evidence() {
				return validDesktopDirectWavNativeEvidence({ selectionPurposes: selections });
			},
		},
	});

	fixture.probe.attach(fixture.window);
	assert.equal(DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS, 1_200_000);
	assert.deepEqual(fixture.scheduledDelays, [DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[0]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[1]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[2]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[3]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[4]);
	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [0]);
	assert.deepEqual(fixture.window.webContents.userGestures, [true]);
	assert.equal(fixture.errors.length, 0);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], new RegExp(`^${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} `, 'u'));
	assert.deepEqual(JSON.parse(fixture.logs[0].slice(DESKTOP_DIRECT_WAV_SMOKE_PREFIX.length + 1)), {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
		renderer: validDesktopDirectWavRendererResult(),
		native: validDesktopDirectWavNativeEvidence(),
	});
	assert.doesNotMatch(fixture.logs[0], /private\/smoke/u);
});

test('a direct-WAV watchdog timeout names the stage the renderer stalled on', async () => {
	const fixture = probeFixture({
		argv: directWavArgv(),
		executionResult: 'completed BW64 export',
		productId: 'soundscaper',
		directWavTargetHarness: {
			resolveSavePath: async () => '/private/smoke/completed.wav',
			evidence: async () => validDesktopDirectWavNativeEvidence(),
		},
	});
	fixture.probe.attach(fixture.window);
	assert.equal(fixture.scheduledCallbacks.length, 1);

	fixture.scheduledCallbacks[0]();
	await flushAsync();

	assert.equal(fixture.errors.length, 1);
	assert.match(fixture.errors[0], /timed out waiting for completed BW64 export/u);
	assert.deepEqual(fixture.exits, [2]);
	assert.match(fixture.window.webContents.executions.at(-1), /__scapeDirectWavSmokeStage/u);
});

test('a direct-WAV watchdog timeout stays unqualified when the stage marker is unreadable', async () => {
	const fixture = probeFixture({
		argv: directWavArgv(),
		executionError: new Error('renderer is unresponsive'),
		productId: 'soundscaper',
		directWavTargetHarness: {
			resolveSavePath: async () => '/private/smoke/completed.wav',
			evidence: async () => validDesktopDirectWavNativeEvidence(),
		},
	});
	fixture.probe.attach(fixture.window);

	fixture.scheduledCallbacks[0]();
	await flushAsync();

	assert.equal(fixture.errors.length, 1);
	assert.equal(fixture.errors[0], `${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} timed out`);
	assert.deepEqual(fixture.exits, [2]);
});

test('direct-WAV lifecycle reports validation failures under its own bounded prefix', async () => {
	const plan = {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
	};
	let evidenceCalls = 0;
	const fixture = probeFixture({
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
			`--soundscaper-smoke-plan=${encodePlan(plan)}`,
			'--soundscaper-smoke-app-data=/private/smoke-root',
		],
		executionResult: validDesktopDirectWavRendererResult({ realtimeCount: 1 }),
		directWavTargetHarness: {
			resolveSavePath: async () => null,
			evidence: async () => {
				evidenceCalls += 1;
				return validDesktopDirectWavNativeEvidence();
			},
		},
	});
	fixture.probe.attach(fixture.window);

	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [2]);
	assert.equal(fixture.logs.length, 0);
	assert.equal(fixture.errors.length, 1);
	assert.equal(evidenceCalls, 0);
	assert.match(fixture.errors[0], new RegExp(`^${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} failed:`, 'u'));
});

test('desktop smoke preserves a cross-realm renderer rejection message', async () => {
	const plan = {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
	};
	const fixture = probeFixture({
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
			`--soundscaper-smoke-plan=${encodePlan(plan)}`,
			'--soundscaper-smoke-app-data=/private/smoke-root',
		],
		executionError: Object.create(Object.freeze({
			name: 'Error',
			message: 'Renderer timing probe exposed its actual failure.',
		})),
		directWavTargetHarness: {
			resolveSavePath: async () => null,
			evidence: async () => validDesktopDirectWavNativeEvidence(),
		},
	});
	fixture.probe.attach(fixture.window);

	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [2]);
	assert.deepEqual(fixture.errors, [
		`${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} failed: Renderer timing probe exposed its actual failure.`,
	]);
});
