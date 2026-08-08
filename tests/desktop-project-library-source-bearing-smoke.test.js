/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_WORKFLOW_IDS,
	MAX_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_PLAN_BYTES,
	createDesktopProjectLibrarySourceBearingPlan,
	createDesktopProjectLibrarySourceBearingWorkflows,
	decodeDesktopProjectLibrarySourceBearingPlan,
	encodeDesktopProjectLibrarySourceBearingPlan,
	validateDesktopProjectLibrarySourceBearingResult,
} from '../desktop/project-library-source-bearing-smoke.js';
import { validateAudioEditorProjectV9 } from '../src/common/editor/project-v9.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';

const SHA256 = 'ab'.repeat(32);

test('source-bearing packaged handoff owns the two frozen Electron roundtrips', () => {
	const workflows = createDesktopProjectLibrarySourceBearingWorkflows();
	assert.deepEqual(workflows.map(({ id, stages }) => ({
		id,
		products: stages.map(({ productId }) => productId),
		profiles: stages.map(({ profileId }) => profileId),
	})), [
		{
			id: 'electron-soundscaper-to-framescaper-to-soundscaper-library',
			products: ['soundscaper', 'framescaper', 'soundscaper'],
			profiles: ['soundscaper', 'framescaper', 'soundscaper'],
		},
		{
			id: 'electron-framescaper-to-soundscaper-to-framescaper-library',
			products: ['framescaper', 'soundscaper', 'framescaper'],
			profiles: ['framescaper', 'soundscaper', 'framescaper'],
		},
	]);
	assert.deepEqual(
		DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_WORKFLOW_IDS,
		workflows.map(({ id }) => id),
	);

	for (const workflow of workflows) {
		assert.deepEqual(workflow.stages.map(({ stage }) => stage), ['publish', 'advance', 'return']);
		assert.equal(workflow.stages[0].profileId, workflow.stages[2].profileId);
		assert.notEqual(workflow.stages[0].profileId, workflow.stages[1].profileId);
		const project = parseScapeProjectDocument(workflow.seed.document);
		assert.equal(validateAudioEditorProjectV9(project), true);
		assert.equal(serializeScapeProjectDocument(project), workflow.seed.document);
		assert.equal(project.schemaVersion, 9);
		assert.equal(project.id, workflow.seed.projectId);
		assert.equal(project.revision, 1);
		assert.equal(project.sources.length, 2);
		assert.deepEqual(project.sources.map(({ kind }) => kind), ['audio', 'video']);
		assert.deepEqual(project.tracks.map(({ type }) => type), ['audio', 'video']);
		assert.deepEqual(project.clips.map(({ kind }) => kind), ['audio', 'video']);
		assert.equal(project.projectBin.clips.length, 1);
		assert.equal(project.projectBin.clips[0].sourceId, workflow.seed.video.sourceId);
		assert.equal(workflow.seed.audio.frameCount, 4_800);
		assert.equal(workflow.seed.audio.channelCount, 1);
		assert.equal(workflow.seed.video.width, 64);
		assert.equal(workflow.seed.video.height, 36);
		assert.equal(workflow.seed.video.frameRate, 30);
		assert.equal(Object.isFrozen(workflow), true);
		assert.equal(Object.isFrozen(workflow.seed), true);
	}
});

test('source-bearing packaged plans are bounded, canonical, and stage-bound', () => {
	const [workflow] = createDesktopProjectLibrarySourceBearingWorkflows();
	const publish = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id,
		stage: 'publish',
		previous: null,
	});
	const previous = {
		project: {
			id: workflow.seed.projectId,
			title: workflow.seed.title,
			revision: 1,
			sha256: SHA256,
		},
		sources: [
			managedSource(workflow.seed.audio, 'audio', 'm'),
			managedSource(workflow.seed.video, 'video', 'v'),
		],
	};
	const advance = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id,
		stage: 'advance',
		previous,
	});
	const encoded = encodeDesktopProjectLibrarySourceBearingPlan(advance);

	assert.equal(publish.mode, DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE);
	assert.equal(publish.productId, 'soundscaper');
	assert.equal(publish.previous, null);
	assert.equal(advance.productId, 'framescaper');
	assert.deepEqual(advance.previous, previous);
	assert.match(encoded, /^[A-Za-z0-9_-]+$/u);
	assert.ok(Buffer.byteLength(encoded) <= MAX_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_PLAN_BYTES);
	assert.deepEqual(decodeDesktopProjectLibrarySourceBearingPlan(encoded), advance);
	assert.equal(
		encodeDesktopProjectLibrarySourceBearingPlan({ z: 1, nested: { z: 2, a: 1 }, a: 2 }),
		encodeDesktopProjectLibrarySourceBearingPlan({ a: 2, nested: { a: 1, z: 2 }, z: 1 }),
	);
	assert.throws(
		() => createDesktopProjectLibrarySourceBearingPlan({
			workflowId: workflow.id,
			stage: 'publish',
			previous,
		}),
		/publish.*previous|previous.*publish/iu,
	);
	assert.throws(
		() => createDesktopProjectLibrarySourceBearingPlan({
			workflowId: workflow.id,
			stage: 'advance',
			previous: null,
		}),
		/advance.*previous|previous.*advance/iu,
	);
	assert.throws(() => decodeDesktopProjectLibrarySourceBearingPlan('not+base64'), /base64url/iu);
});

test('source-bearing packaged results bind UI playback, one recipient edit, and managed media', () => {
	const [workflow] = createDesktopProjectLibrarySourceBearingWorkflows();
	const publishPlan = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id, stage: 'publish', previous: null,
	});
	const published = resultFor(publishPlan, {
		project: { id: workflow.seed.projectId, title: workflow.seed.title, revision: 1, sha256: SHA256 },
		sources: [
			managedSource(workflow.seed.audio, 'audio', 'm'),
			managedSource(workflow.seed.video, 'video', 'v'),
		],
	});
	assert.deepEqual(validateDesktopProjectLibrarySourceBearingResult(published, publishPlan), published);

	const advancePlan = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id,
		stage: 'advance',
		previous: { project: published.project, sources: published.sources },
	});
	const advanced = resultFor(advancePlan, {
		project: { ...published.project, revision: 2, sha256: 'ef'.repeat(32) },
		sources: published.sources.map((source, index) => ({
			...source, bindingId: `${index === 0 ? 'm' : 'v'}${'12'.repeat(32)}`,
		})),
	});
	assert.deepEqual(validateDesktopProjectLibrarySourceBearingResult(advanced, advancePlan), advanced);

	const returnPlan = createDesktopProjectLibrarySourceBearingPlan({
		workflowId: workflow.id,
		stage: 'return',
		previous: { project: advanced.project, sources: advanced.sources },
	});
	const returned = resultFor(returnPlan, { project: advanced.project, sources: advanced.sources });
	assert.deepEqual(validateDesktopProjectLibrarySourceBearingResult(returned, returnPlan), returned);

	for (const candidate of [
		{ ...published, ui: { ...published.ui, playbackStarted: false } },
		{ ...published, ui: { ...published.ui, videoSha256: '00'.repeat(32) } },
		{ ...published, project: { ...published.project, revision: 2 } },
		{ ...advanced, ui: { ...advanced.ui, audioTrackName: 'not the fixed edit' } },
		{ ...returned, project: published.project },
	]) {
		const plan = candidate.stage === 'advance'
			? advancePlan
			: candidate.stage === 'return' ? returnPlan : publishPlan;
		assert.throws(
			() => validateDesktopProjectLibrarySourceBearingResult(candidate, plan),
			/result|playback|video|revision|track|project/iu,
		);
	}
});

function managedSource(source, kind, prefix) {
	return {
		bindingId: `${prefix}${'cd'.repeat(32)}`,
		byteLength: kind === 'audio' ? 4 + source.frameCount * Float32Array.BYTES_PER_ELEMENT : 1_024,
		encoding: kind === 'audio' ? 'audio-f32le-chunks-v1' : 'video-original-v1',
		kind,
		sha256: SHA256,
		sourceId: source.sourceId,
		storageKey: source.storageKey,
	};
}

function resultFor(plan, { project, sources }) {
	const stage = plan.stage;
	return {
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
		workflowId: plan.workflowId,
		stage,
		productId: plan.productId,
		project,
		sources,
		ui: {
			activeProjectId: plan.seed.projectId,
			audioTrackName: stage === 'publish' ? 'Packaged sound' : plan.seed.advanceTrackName,
			clipCount: 2,
			handoffInvoked: stage !== 'return',
			playbackStarted: true,
			playbackStopped: true,
			productId: plan.productId,
			projectBinSourceId: plan.seed.video.sourceId,
			trackCount: 2,
			videoSha256: sources[1].sha256,
		},
		host: {
			owner: { product: plan.productId },
			fencingToken: stage === 'publish' ? 1 : stage === 'advance' ? 2 : 3,
			tookOverStaleLease: false,
			recovery: { outcome: 'clean' },
		},
		catalogRevision: stage === 'publish' ? 1 : stage === 'advance' ? 2 : 3,
	};
}
