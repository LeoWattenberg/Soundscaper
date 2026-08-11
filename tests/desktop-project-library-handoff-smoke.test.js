/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_HANDOFF_AGGREGATE_PREFIX,
	DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE,
	DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX,
	DESKTOP_PROJECT_LIBRARY_HANDOFF_PROJECT_ID,
	MAX_DESKTOP_PROJECT_LIBRARY_HANDOFF_PLAN_BYTES,
	createDesktopProjectLibraryHandoffInvocations,
	createDesktopProjectLibraryHandoffStages,
	createDesktopProjectLibraryHandoffAggregate,
	decodeDesktopProjectLibraryHandoffPlan,
	encodeDesktopProjectLibraryHandoffPlan,
	formatDesktopProjectLibraryHandoffAggregate,
	parseDesktopProjectLibraryHandoffOutput,
	validateDesktopProjectLibraryHandoffResults,
} from '../scripts/lib/desktop-project-library-handoff-smoke.mjs';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';

test('packaged handoff fixtures are canonical source-free exact-schema-16 revisions', () => {
	const stages = createDesktopProjectLibraryHandoffStages();
	assert.deepEqual(stages.map(({ stage, productId, profileId, target }) => ({
		stage,
		productId,
		profileId,
		revision: target.revision,
		title: target.title,
	})), [
		{
			stage: 'publish',
			productId: 'soundscaper',
			profileId: 'soundscaper',
			revision: 1,
			title: 'Packaged handoff published in Soundscaper',
		},
		{
			stage: 'advance',
			productId: 'framescaper',
			profileId: 'framescaper',
			revision: 2,
			title: 'Packaged handoff advanced in Framescaper',
		},
		{
			stage: 'return',
			productId: 'soundscaper',
			profileId: 'soundscaper',
			revision: 3,
			title: 'Packaged handoff returned to Soundscaper',
		},
	]);

	for (const [index, fixture] of stages.entries()) {
		const project = parseScapeProjectDocument(fixture.target.document);
		assert.equal(validateCurrentAudioEditorProject(project), true);
		assert.equal(serializeScapeProjectDocument(project), fixture.target.document);
		assert.equal(project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
		assert.equal(project.id, DESKTOP_PROJECT_LIBRARY_HANDOFF_PROJECT_ID);
		assert.equal(project.title, fixture.target.title);
		assert.equal(project.revision, index + 1);
		assert.equal(project.createdAt, '2026-07-30T12:00:01.000Z');
		assert.equal(project.updatedAt, `2026-07-30T12:00:0${String(index + 1)}.000Z`);
		assert.deepEqual(project.sources, []);
		assert.deepEqual(project.clips, []);
		assert.deepEqual(project.tracks, []);
		assert.deepEqual(project.timelineAnnotations, [
			{
				id: 'packaged-handoff-marker',
				sequenceId: 'main-sequence',
				name: 'Shared marker',
				color: 'violet',
				batchId: 'packaged-handoff-batch',
				opaqueExtensions: {},
				kind: 'marker',
				anchor: 'sample',
				positionFrame: 24_000,
			},
			{
				id: 'packaged-handoff-region',
				sequenceId: 'main-sequence',
				name: 'Shared region',
				color: 'violet',
				batchId: 'packaged-handoff-batch',
				opaqueExtensions: {},
				kind: 'region',
				anchor: 'musical',
				startBeat: { num: 2, den: 1 },
				endBeat: { num: 4, den: 1 },
			},
		]);
		assert.deepEqual(project.projectBin.clips, []);
		assert.deepEqual(project.featureRequirements, { schemaVersion: 2, requirements: [{
			id: 'soundscaper.timeline-annotations',
			featureId: 'org.soundscaper.capability.timeline-annotations',
			displayName: 'Timeline markers and regions',
			disposition: 'bypass',
			fallback: null,
		}] });
		assert.equal(
			createHash('sha256').update(fixture.target.document).digest('hex'),
			fixture.target.sha256,
		);
		assert.deepEqual(fixture.previous, index === 0 ? null : withoutDocument(stages[index - 1].target));
		assert.equal(Object.isFrozen(fixture), true);
		assert.equal(Object.isFrozen(fixture.target), true);
	}
});

test('handoff plans use bounded canonical base64url JSON', () => {
	const [publish, advance] = createDesktopProjectLibraryHandoffStages();
	const encoded = encodeDesktopProjectLibraryHandoffPlan(advance.plan);
	assert.match(encoded, /^[A-Za-z0-9_-]+$/u);
	assert.ok(Buffer.byteLength(encoded) <= MAX_DESKTOP_PROJECT_LIBRARY_HANDOFF_PLAN_BYTES);
	assert.deepEqual(decodeDesktopProjectLibraryHandoffPlan(encoded), advance.plan);
	assert.equal(
		encodeDesktopProjectLibraryHandoffPlan({ z: 1, nested: { z: 2, a: 1 }, a: 2 }),
		encodeDesktopProjectLibraryHandoffPlan({ a: 2, nested: { a: 1, z: 2 }, z: 1 }),
	);
	assert.throws(() => decodeDesktopProjectLibraryHandoffPlan('not+base64'), /base64url/iu);
	assert.throws(
		() => encodeDesktopProjectLibraryHandoffPlan({ document: 'x'.repeat(64 * 1024) }),
		/64 KiB/iu,
	);
	assert.equal(publish.plan.previous, null);
	assert.deepEqual(advance.plan.previous, withoutDocument(publish.target));
});

test('handoff invocations reuse only the Soundscaper profile and pin isolated arguments', () => {
	const invocations = createDesktopProjectLibraryHandoffInvocations({
		arch: 'x64',
		outputRoot: '/release/desktop-handoff',
		platform: 'linux',
		profileRoot: '/tmp/packaged-handoff',
	});
	assert.deepEqual(invocations.map(({ stage, productId }) => ({ stage, productId })), [
		{ stage: 'publish', productId: 'soundscaper' },
		{ stage: 'advance', productId: 'framescaper' },
		{ stage: 'return', productId: 'soundscaper' },
	]);
	assert.equal(invocations[0].userDataPath, invocations[2].userDataPath);
	assert.notEqual(invocations[0].userDataPath, invocations[1].userDataPath);
	assert.equal(invocations[0].sharedAppDataPath, invocations[1].sharedAppDataPath);
	assert.equal(invocations[1].sharedAppDataPath, invocations[2].sharedAppDataPath);
	for (const invocation of invocations) {
		assert.equal(invocation.appArguments[0], `--user-data-dir=${invocation.userDataPath}`);
		assert.ok(invocation.appArguments.includes('--soundscaper-smoke'));
		assert.ok(invocation.appArguments.includes(
			`--soundscaper-smoke-mode=${DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE}`,
		));
		assert.ok(invocation.appArguments.includes(`--soundscaper-smoke-plan=${invocation.encodedPlan}`));
		assert.ok(invocation.appArguments.includes(
			`--soundscaper-smoke-app-data=${invocation.sharedAppDataPath}`,
		));
		assert.deepEqual(decodeDesktopProjectLibraryHandoffPlan(invocation.encodedPlan), invocation.plan);
		assert.deepEqual(
			parseDesktopSmokeConfiguration(['/packaged/application', ...invocation.appArguments]).plan,
			invocation.plan,
		);
		assert.ok(invocation.executableCandidates.every((candidate) => candidate.startsWith(resolve(
			'/release/desktop-handoff',
			invocation.productId,
		))));
	}
	assert.equal(DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX, 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_SMOKE ');
	assert.equal(DESKTOP_PROJECT_LIBRARY_HANDOFF_AGGREGATE_PREFIX, 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_HANDOFF ');
});

test('handoff output validation requires exact project, summary, host, and product claims', () => {
	const invocations = createDesktopProjectLibraryHandoffInvocations({
		arch: 'arm64',
		outputRoot: '/release/desktop-handoff',
		platform: 'darwin',
		profileRoot: '/tmp/packaged-handoff',
	});
	const payloads = invocations.map((invocation, index) => validPayload(
		invocation,
		index + 11,
		20 + index * 3,
	));
	const results = payloads.map((payload, index) => parseDesktopProjectLibraryHandoffOutput(
		`ordinary diagnostic\n${DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX}${JSON.stringify(payload)}\n`,
		invocations[index],
	));
	assert.deepEqual(validateDesktopProjectLibraryHandoffResults(results), results);
	const aggregate = createDesktopProjectLibraryHandoffAggregate(results);
	assert.equal(aggregate.catalogRevision, results[2].catalogRevision);
	assert.equal(aggregate.project.revision, 3);
	assert.deepEqual(aggregate.stages.map(({ catalogRevision }) => catalogRevision), [20, 23, 26]);
	const aggregateLine = formatDesktopProjectLibraryHandoffAggregate(aggregate);
	assert.ok(aggregateLine.startsWith(DESKTOP_PROJECT_LIBRARY_HANDOFF_AGGREGATE_PREFIX));
	assert.ok(Buffer.byteLength(aggregateLine) <= 64 * 1024);
	assert.doesNotMatch(aggregateLine, /"document"/u);

	const line = `${DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX}${JSON.stringify(payloads[0])}`;
	assert.throws(
		() => parseDesktopProjectLibraryHandoffOutput(`${line}\n${line}\n`, invocations[0]),
		/exactly one/iu,
	);
	for (const [mutate, pattern] of [
		[(payload) => ({ ...payload, productId: 'framescaper' }), /product/iu],
		[(payload) => ({ ...payload, stage: 'return' }), /stage/iu],
		[(payload) => ({ ...payload, project: { ...payload.project, revision: 9 } }), /project/iu],
		[(payload) => ({ ...payload, summary: { ...payload.summary, title: 'wrong' } }), /summary/iu],
		[(payload) => ({ ...payload, host: { ...payload.host, owner: { product: 'framescaper' } } }), /owner/iu],
		[(payload) => ({ ...payload, host: { ...payload.host, tookOverStaleLease: true } }), /stale takeover/iu],
		[(payload) => ({ ...payload, host: { ...payload.host, recovery: { outcome: 'restored' } } }), /recovery/iu],
		[(payload) => ({ ...payload, preferredProduct: 'framescaper' }), /preferred product/iu],
		[(payload) => ({ ...payload, catalogRevision: -1 }), /catalog revision/iu],
	]) {
		const changed = mutate(payloads[0]);
		assert.throws(
			() => parseDesktopProjectLibraryHandoffOutput(
				`${DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX}${JSON.stringify(changed)}`,
				invocations[0],
			),
			pattern,
		);
	}
	assert.throws(
		() => validateDesktopProjectLibraryHandoffResults([
			results[0],
			{ ...results[1], host: { ...results[1].host, fencingToken: results[0].host.fencingToken } },
			results[2],
		]),
		/strictly increase/iu,
	);
	assert.throws(
		() => validateDesktopProjectLibraryHandoffResults([
			results[0],
			{ ...results[1], catalogRevision: results[0].catalogRevision },
			results[2],
		]),
		/catalog revisions.*strictly increase/iu,
	);
});

function withoutDocument(target) {
	const { document: _document, ...descriptor } = target;
	return descriptor;
}

function validPayload(invocation, fencingToken, catalogRevision) {
	const project = withoutDocument(invocation.plan.target);
	return {
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE,
		stage: invocation.stage,
		productId: invocation.productId,
		project,
		summary: {
			id: project.id,
			title: project.title,
			revision: project.revision,
		},
		host: {
			owner: { product: invocation.productId },
			fencingToken,
			tookOverStaleLease: false,
			recovery: { outcome: 'clean' },
		},
		preferredProduct: invocation.productId,
		catalogRevision,
	};
}
