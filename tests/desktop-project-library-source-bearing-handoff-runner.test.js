/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_AGGREGATE_PREFIX,
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX,
	createDesktopProjectLibrarySourceBearingAggregate,
	createDesktopProjectLibrarySourceBearingInvocation,
	formatDesktopProjectLibrarySourceBearingAggregate,
	parseDesktopProjectLibrarySourceBearingOutput,
} from '../scripts/lib/desktop-project-library-source-bearing-handoff.mjs';
import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	createDesktopProjectLibrarySourceBearingWorkflows,
} from '../desktop/project-library-source-bearing-smoke.js';

const SHA256 = 'ab'.repeat(32);

test('source-bearing invocations isolate each workflow while reusing only its origin profile', () => {
	for (const workflow of createDesktopProjectLibrarySourceBearingWorkflows()) {
		let previous = null;
		const invocations = workflow.stages.map(({ stage }) => {
			const invocation = createDesktopProjectLibrarySourceBearingInvocation({
				arch: 'x64',
				outputRoot: '/release/desktop-handoff',
				platform: 'linux',
				profileRoot: '/tmp/source-bearing-handoff',
				workflowId: workflow.id,
				stage,
				previous,
			});
			previous = previousFor(invocation.plan, stage === 'advance' ? 2 : 1);
			return invocation;
		});

		assert.equal(invocations[0].userDataPath, invocations[2].userDataPath);
		assert.notEqual(invocations[0].userDataPath, invocations[1].userDataPath);
		assert.equal(invocations[0].sharedAppDataPath, invocations[1].sharedAppDataPath);
		assert.equal(invocations[1].sharedAppDataPath, invocations[2].sharedAppDataPath);
		for (const invocation of invocations) {
			assert.equal(invocation.appArguments[0], `--user-data-dir=${invocation.userDataPath}`);
			assert.ok(invocation.appArguments.includes('--soundscaper-smoke'));
			assert.ok(invocation.appArguments.includes(
				`--soundscaper-smoke-mode=${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE}`,
			));
			assert.ok(invocation.appArguments.includes(`--soundscaper-smoke-plan=${invocation.encodedPlan}`));
			assert.ok(invocation.appArguments.includes(
				`--soundscaper-smoke-app-data=${invocation.sharedAppDataPath}`,
			));
			assert.ok(invocation.executableCandidates.every((candidate) => candidate.startsWith(resolve(
				'/release/desktop-handoff', invocation.productId,
			))));
		}
	}

	const [soundWorkflow, frameWorkflow] = createDesktopProjectLibrarySourceBearingWorkflows();
	const sound = createDesktopProjectLibrarySourceBearingInvocation({
		arch: 'x64', outputRoot: '/release/desktop-handoff', platform: 'linux',
		profileRoot: '/tmp/source-bearing-handoff', workflowId: soundWorkflow.id,
		stage: 'publish', previous: null,
	});
	const frame = createDesktopProjectLibrarySourceBearingInvocation({
		arch: 'x64', outputRoot: '/release/desktop-handoff', platform: 'linux',
		profileRoot: '/tmp/source-bearing-handoff', workflowId: frameWorkflow.id,
		stage: 'publish', previous: null,
	});
	assert.notEqual(sound.sharedAppDataPath, frame.sharedAppDataPath);
});

test('source-bearing output parsing and aggregate validation retain exact UI and media evidence', () => {
	const results = [];
	for (const workflow of createDesktopProjectLibrarySourceBearingWorkflows()) {
		let previous = null;
		for (const [index, { stage }] of workflow.stages.entries()) {
			const invocation = createDesktopProjectLibrarySourceBearingInvocation({
				arch: 'x64', outputRoot: '/release/desktop-handoff', platform: 'linux',
				profileRoot: '/tmp/source-bearing-handoff', workflowId: workflow.id,
				stage, previous,
			});
			const result = resultFor(invocation.plan, index + 1, 10 + index * 2);
			results.push(parseDesktopProjectLibrarySourceBearingOutput(
				`diagnostic\n${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX}${JSON.stringify(result)}\n`,
				invocation,
			));
			previous = { project: result.project, sources: result.sources };
		}
	}

	const aggregate = createDesktopProjectLibrarySourceBearingAggregate(results);
	assert.equal(aggregate.schemaVersion, 1);
	assert.equal(aggregate.mode, DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE);
	assert.equal(aggregate.workflows.length, 2);
	assert.deepEqual(aggregate.workflows.map(({ stages }) => stages.map(({ stage }) => stage)), [
		['publish', 'advance', 'return'],
		['publish', 'advance', 'return'],
	]);
	for (const workflow of aggregate.workflows) {
		assert.equal(workflow.project.revision, 2);
		assert.equal(workflow.sources.length, 2);
	}
	const line = formatDesktopProjectLibrarySourceBearingAggregate(aggregate);
	assert.ok(line.startsWith(DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_AGGREGATE_PREFIX));
	assert.doesNotMatch(line, /"document"/u);

	const first = results[0];
	assert.throws(
		() => createDesktopProjectLibrarySourceBearingAggregate([
			first,
			{ ...results[1], host: { ...results[1].host, fencingToken: first.host.fencingToken } },
			...results.slice(2),
		]),
		/fencing tokens.*increase/iu,
	);
	const duplicate = `${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX}${JSON.stringify(first)}`;
	assert.throws(
		() => parseDesktopProjectLibrarySourceBearingOutput(`${duplicate}\n${duplicate}`, {
			plan: createDesktopProjectLibrarySourceBearingInvocation({
				arch: 'x64', outputRoot: '/release/desktop-handoff', platform: 'linux',
				profileRoot: '/tmp/source-bearing-handoff',
				workflowId: first.workflowId, stage: 'publish', previous: null,
			}).plan,
		}),
		/exactly one/iu,
	);
});

function previousFor(plan, revision) {
	return {
		project: { id: plan.seed.projectId, title: plan.seed.title, revision, sha256: SHA256 },
		sources: sourcesFor(plan),
	};
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

function resultFor(plan, fencingToken, catalogRevision) {
	const previousRevision = plan.previous?.project.revision ?? 0;
	const revision = plan.stage === 'advance' ? previousRevision + 1
		: plan.stage === 'return' ? previousRevision : 1;
	const project = plan.stage === 'return'
		? plan.previous.project
		: { id: plan.seed.projectId, title: plan.seed.title, revision, sha256: `${revision === 1 ? 'ab' : '12'}`.repeat(32) };
	const sources = plan.stage === 'advance'
		? plan.previous.sources.map((source, index) => ({
			...source,
			bindingId: `${index === 0 ? 'm' : 'v'}${'34'.repeat(32)}`,
		}))
		: plan.previous?.sources ?? sourcesFor(plan);
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
			handoffInvoked: plan.stage !== 'return',
			playbackStarted: true,
			playbackStopped: true,
			productId: plan.productId,
			projectBinSourceId: plan.seed.video.sourceId,
			trackCount: 2,
			videoSha256: sources[1].sha256,
		},
		host: {
			owner: { product: plan.productId }, fencingToken,
			tookOverStaleLease: false, recovery: { outcome: 'clean' },
		},
		catalogRevision,
	};
}
