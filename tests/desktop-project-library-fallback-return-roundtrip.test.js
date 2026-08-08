/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_FALLBACK_RETURN_WORKFLOW_IDS,
} from '../desktop/project-library-fallback-role-witnesses.js';
import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	createDesktopProjectLibrarySourceBearingPlan,
	createDesktopProjectLibrarySourceBearingWorkflows,
} from '../desktop/project-library-source-bearing-smoke.js';
import {
	createDesktopProjectLibrarySourceBearingAggregate,
} from '../scripts/lib/desktop-project-library-source-bearing-handoff.mjs';

const SHA256 = 'ab'.repeat(32);

test('packaged fallback return evidence owns the four exact roadmap workflows', () => {
	const workflows = createDesktopProjectLibrarySourceBearingWorkflows();
	assert.deepEqual(DESKTOP_PROJECT_LIBRARY_FALLBACK_RETURN_WORKFLOW_IDS, [
		'audio-whole-mix-electron-roundtrip',
		'audio-track-render-electron-roundtrip',
		'video-full-project-electron-roundtrip',
		'video-clip-render-electron-roundtrip',
	]);
	assert.deepEqual(
		workflows.flatMap(({ seed }) => seed.roleWitnesses.map(({ workflowId }) => workflowId)),
		DESKTOP_PROJECT_LIBRARY_FALLBACK_RETURN_WORKFLOW_IDS,
	);
});

test('packaged fallback return aggregate pairs recipient handoff with an exact editable origin reopen', () => {
	const results = resultsForAllStages();
	const aggregate = createDesktopProjectLibrarySourceBearingAggregate(results);
	const roundtrips = aggregate.workflows.flatMap(({ fallbackRoundtrips }) => fallbackRoundtrips);

	assert.deepEqual(
		roundtrips.map(({ workflowId }) => workflowId),
		DESKTOP_PROJECT_LIBRARY_FALLBACK_RETURN_WORKFLOW_IDS,
	);
	for (const roundtrip of roundtrips) {
		assert.equal(roundtrip.recipient.readOnly, true);
		assert.equal(roundtrip.recipient.editable, false);
		assert.equal(roundtrip.recipient.compatibilityNotice, true);
		assert.equal(roundtrip.recipient.handoffInvoked, true);
		assert.equal(roundtrip.origin.readOnly, false);
		assert.equal(roundtrip.origin.editable, true);
		assert.equal(roundtrip.origin.compatibilityNotice, false);
		assert.equal(roundtrip.origin.handoffInvoked, false);
		assert.equal(roundtrip.origin.documentSha256, roundtrip.recipient.documentSha256);
		assert.equal(roundtrip.origin.nativeSha256, roundtrip.recipient.nativeSha256);
		assert.equal(roundtrip.origin.sha256, roundtrip.recipient.sha256);
	}

	const drifted = structuredClone(results);
	drifted[2].ui.fallbackRoles[0].documentSha256 = 'fe'.repeat(32);
	assert.throws(
		() => createDesktopProjectLibrarySourceBearingAggregate(drifted),
		/fallback.*changed|roundtrip.*changed/iu,
	);
});

function resultsForAllStages() {
	const results = [];
	let sequence = 0;
	for (const workflow of createDesktopProjectLibrarySourceBearingWorkflows()) {
		let previous = null;
		for (const { stage } of workflow.stages) {
			const plan = createDesktopProjectLibrarySourceBearingPlan({
				workflowId: workflow.id, stage, previous,
			});
			sequence += 1;
			const result = resultFor(plan, sequence);
			results.push(result);
			previous = { project: result.project, sources: result.sources };
		}
	}
	return results;
}

function resultFor(plan, sequence) {
	const previousRevision = plan.previous?.project.revision ?? 0;
	const revision = plan.stage === 'advance' ? previousRevision + 1
		: plan.stage === 'return' ? previousRevision : 1;
	const project = plan.stage === 'return'
		? plan.previous.project
		: {
			id: plan.seed.projectId,
			title: plan.seed.title,
			revision,
			sha256: (revision === 1 ? 'ab' : 'cd').repeat(32),
		};
	const sources = plan.stage === 'advance'
		? plan.previous.sources.map((source, index) => ({
			...source,
			bindingId: `${source.kind === 'audio' ? 'm' : 'v'}${String(index + 5).repeat(64).slice(0, 64)}`,
		}))
		: plan.previous?.sources ?? managedSources(plan.seed);
	return {
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
		workflowId: plan.workflowId,
		stage: plan.stage,
		productId: plan.productId,
		project,
		sources,
		ui: {
			activeProjectId: plan.seed.projectId,
			audioTrackName: plan.stage === 'publish' ? 'Packaged sound' : plan.seed.advanceTrackName,
			clipCount: 2,
			fallbackRoles: fallbackEvidence(plan),
			handoffInvoked: plan.stage !== 'return',
			playbackStarted: true,
			playbackStopped: true,
			productId: plan.productId,
			projectBinSourceId: plan.seed.video.sourceId,
			trackCount: 2,
			videoSha256: sources[1].sha256,
		},
		host: {
			owner: { product: plan.productId },
			fencingToken: sequence,
			tookOverStaleLease: false,
			recovery: { outcome: 'clean' },
		},
		catalogRevision: sequence,
	};
}

function fallbackEvidence(plan) {
	if (plan.stage === 'publish') return [];
	const recipient = plan.stage === 'advance';
	return plan.seed.roleWitnesses.map((witness) => ({
		workflowId: witness.workflowId,
		featureId: witness.featureId,
		kind: witness.kind,
		projectId: witness.projectId,
		requirementId: witness.requirementId,
		role: witness.role,
		documentSha256: SHA256,
		nativeSha256: SHA256,
		sha256: SHA256,
		sourceId: witness.fallback.sourceId,
		readOnly: recipient,
		editable: !recipient,
		compatibilityNotice: recipient,
		handoffInvoked: recipient,
		playbackStarted: true,
		playbackStopped: true,
	}));
}

function managedSources(seed) {
	return [
		{
			bindingId: `m${'cd'.repeat(32)}`,
			byteLength: 4 + seed.audio.frameCount * seed.audio.channelCount * Float32Array.BYTES_PER_ELEMENT,
			encoding: 'audio-f32le-chunks-v1',
			kind: 'audio', sha256: SHA256,
			sourceId: seed.audio.sourceId, storageKey: seed.audio.storageKey,
		},
		{
			bindingId: `v${'ef'.repeat(32)}`, byteLength: 1_024,
			encoding: 'video-original-v1', kind: 'video', sha256: SHA256,
			sourceId: seed.video.sourceId, storageKey: seed.video.storageKey,
		},
	];
}
