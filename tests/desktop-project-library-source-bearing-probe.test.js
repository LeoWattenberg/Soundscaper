/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopSmokeProbe,
	parseDesktopSmokeConfiguration,
} from '../desktop/desktop-smoke.js';
import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX,
	createDesktopProjectLibrarySourceBearingPlan,
	createDesktopProjectLibrarySourceBearingWorkflows,
	encodeDesktopProjectLibrarySourceBearingPlan,
} from '../desktop/project-library-source-bearing-smoke.js';

const SHA256 = 'ab'.repeat(32);

test('desktop smoke configuration admits one fixed source-bearing roundtrip plan', () => {
	const plan = publishPlan();
	const configuration = parseDesktopSmokeConfiguration(argvFor(plan));

	assert.deepEqual(configuration, { mode: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE, plan });
	assert.equal(Object.isFrozen(configuration), true);
	assert.throws(
		() => parseDesktopSmokeConfiguration(argvFor(plan).slice(0, -1)),
		/requires exactly one smoke plan/iu,
	);
});

test('desktop smoke probe preserves a source-bearing session across renderer reloads', async () => {
	const plan = publishPlan();
	const sources = sourcesFor(plan);
	const project = { id: plan.seed.projectId, title: plan.seed.title, revision: 1, sha256: SHA256 };
	const executions = [
		{ phase: 'prepared', sources },
		{ phase: 'activated', project, sources, ui: uiFor(plan, sources) },
	];
	const scripts = [];
	const logs = [];
	const exits = [];
	const delays = [];
	const probe = createDesktopSmokeProbe({
		argv: argvFor(plan),
		appName: 'Soundscaper',
		appOrigin: 'soundscaper-app://bundle',
		productId: 'soundscaper',
		projectLibraryEvidence: async (projectId) => {
			assert.equal(projectId, plan.seed.projectId);
			return {
				host: {
					closed: false,
					owner: { product: 'soundscaper' },
					activeWriter: null,
					lastWriter: {
						fencingToken: 3,
						tookOverStaleLease: false, recovery: { outcome: 'clean' },
					},
				},
				catalogRevision: 7, project, sources,
			};
		},
		exit: async (code) => { exits.push(code); },
		log: (line) => { logs.push(line); },
		reportError: assert.fail,
		setTimeout: (_callback, delay) => { delays.push(delay); return 1; },
		clearTimeout: () => {},
	});
	let navigationListener = null;
	const window = {
		webContents: {
			once(event, listener) {
				if (event === 'will-navigate') navigationListener = listener;
			},
			removeListener: () => {},
			getURL: () => 'soundscaper-app://bundle/',
			loadURL: async () => {},
			async executeJavaScript(script, userGesture) {
				scripts.push({ script, userGesture });
				const execution = executions.shift();
				if (execution?.phase === 'activated') {
					queueMicrotask(() => navigationListener?.(
						{}, `soundscaper-app://bundle/framescaper/en/?project=${plan.seed.projectId}`,
					));
				}
				return execution;
			},
		},
	};

	probe.attach(window);
	await probe.rendererReady();
	await probe.rendererReady();
	await probe.rendererReady();

	assert.deepEqual(delays, [90_000]);
	assert.equal(scripts.length, 2);
	assert.ok(scripts.every(({ userGesture }) => userGesture === true));
	assert.deepEqual(exits, [0]);
	assert.equal(logs.length, 1);
	assert.match(logs[0], new RegExp(`^${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX}`, 'u'));
	const result = JSON.parse(logs[0].slice(DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX.length));
	assert.equal(result.workflowId, plan.workflowId);
	assert.equal(result.ui.handoffInvoked, true);
	assert.deepEqual(result.sources, sources);
});

function publishPlan() {
	const [workflow] = createDesktopProjectLibrarySourceBearingWorkflows();
	return createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id, stage: 'publish', previous: null,
	});
}

function argvFor(plan) {
	return [
		'/opt/Soundscaper', '--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE}`,
		`--soundscaper-smoke-plan=${encodeDesktopProjectLibrarySourceBearingPlan(plan)}`,
	];
}

function sourcesFor(plan) {
	return [
		{
			bindingId: `m${'cd'.repeat(32)}`, byteLength: 19_204,
			encoding: 'audio-f32le-chunks-v1', kind: 'audio', sha256: SHA256,
			sourceId: plan.seed.audio.sourceId, storageKey: plan.seed.audio.storageKey,
		},
		{
			bindingId: `v${'ef'.repeat(32)}`, byteLength: 1_024,
			encoding: 'video-original-v1', kind: 'video', sha256: SHA256,
			sourceId: plan.seed.video.sourceId, storageKey: plan.seed.video.storageKey,
		},
	];
}

function uiFor(plan, sources) {
	return {
		activeProjectId: plan.seed.projectId,
		audioTrackName: 'Packaged sound',
		clipCount: 2,
		fallbackRoles: [],
		handoffInvoked: true,
		playbackStarted: true,
		playbackStopped: true,
		productId: plan.productId,
		projectBinSourceId: plan.seed.video.sourceId,
		trackCount: 2,
		videoSha256: sources[1].sha256,
	};
}
