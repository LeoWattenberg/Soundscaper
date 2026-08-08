/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopProjectLibrarySourceBearingPlan,
	createDesktopProjectLibrarySourceBearingWorkflows,
} from '../desktop/project-library-source-bearing-smoke.js';
import {
	createDesktopProjectLibrarySourceBearingSmokeSession,
} from '../desktop/project-library-source-bearing-smoke-session.js';

const SHA256 = 'ab'.repeat(32);

test('source-bearing smoke session spans prepare, UI handoff, and reloaded final evidence', async () => {
	const [workflow] = createDesktopProjectLibrarySourceBearingWorkflows();
	const plan = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id, stage: 'publish', previous: null,
	});
	const sources = sourcesFor(plan);
	const project = { id: plan.seed.projectId, title: plan.seed.title, revision: 1, sha256: SHA256 };
	const calls = [];
	const executions = [
		{ phase: 'prepared', sources },
		{ phase: 'activated', project, sources, ui: uiFor(plan, sources, true) },
		{ phase: 'finalized', project, sources },
	];
	const session = createDesktopProjectLibrarySourceBearingSmokeSession({
		plan,
		productId: plan.productId,
		projectLibraryEvidence: async (projectId) => {
			assert.equal(projectId, plan.seed.projectId);
			return evidence(plan.productId, 11, 7);
		},
	});
	const webContents = {
		async executeJavaScript(script, userGesture) {
			calls.push({ script, userGesture });
			return executions.shift();
		},
	};

	assert.equal(await session.run(webContents), null);
	assert.equal(await session.run(webContents), null);
	const result = await session.run(webContents);
	assert.equal(result.stage, 'publish');
	assert.equal(result.project.revision, 1);
	assert.deepEqual(result.sources, sources);
	assert.equal(result.ui.handoffInvoked, true);
	assert.equal(result.host.fencingToken, 11);
	assert.equal(result.catalogRevision, 7);
	assert.equal(session.complete, true);
	assert.equal(calls.length, 3);
	assert.ok(calls.every(({ script, userGesture }) => script.includes(plan.seed.projectId) && userGesture === true));
	await assert.rejects(() => session.run(webContents), /already complete/iu);
});

test('source-bearing return session completes after UI activation without another handoff reload', async () => {
	const [workflow] = createDesktopProjectLibrarySourceBearingWorkflows();
	const previous = {
		project: { id: workflow.seed.projectId, title: workflow.seed.title, revision: 2, sha256: SHA256 },
		sources: sourcesFor({ seed: workflow.seed }),
	};
	const plan = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id, stage: 'return', previous,
	});
	const executions = [
		{ phase: 'prepared', sources: previous.sources },
		{
			phase: 'activated',
			project: previous.project,
			sources: previous.sources,
			ui: uiFor(plan, previous.sources, false),
		},
	];
	const session = createDesktopProjectLibrarySourceBearingSmokeSession({
		plan,
		productId: plan.productId,
		projectLibraryEvidence: () => evidence(plan.productId, 13, 9),
	});
	const webContents = { executeJavaScript: async () => executions.shift() };

	assert.equal(await session.run(webContents), null);
	const result = await session.run(webContents);
	assert.deepEqual(result.project, previous.project);
	assert.equal(result.ui.audioTrackName, plan.seed.advanceTrackName);
	assert.equal(result.ui.handoffInvoked, false);
	assert.equal(session.complete, true);
});

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

function uiFor(plan, sources, handoffInvoked) {
	return {
		activeProjectId: plan.seed.projectId,
		audioTrackName: plan.stage === 'publish' ? 'Packaged sound' : plan.seed.advanceTrackName,
		clipCount: 2,
		handoffInvoked,
		playbackStarted: true,
		playbackStopped: true,
		productId: plan.productId,
		projectBinSourceId: plan.seed.video.sourceId,
		trackCount: 2,
		videoSha256: sources[1].sha256,
	};
}

function evidence(product, fencingToken, catalogRevision) {
	return {
		host: {
			owner: { product }, fencingToken, tookOverStaleLease: false,
			recovery: { outcome: 'clean' },
		},
		catalogRevision,
	};
}
