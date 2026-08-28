import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-identity.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	M3_LONGFORM_EDITORIAL_SPECIFICATION,
	applyM3LongformEditorialEditPlan,
	createM3LongformEditorialBaseProject,
	createM3LongformEditorialEditPlan,
	createM3LongformEditorialWorkload,
	resolveM3LongformEditorialPositionChecks,
} from '../src/common/editor/quality/m3-longform-editorial-workload.ts';
import { loadSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

test('the milestone 3 long-form fixture has the exact two-hour editorial shape', () => {
	const project = createM3LongformEditorialBaseProject();
	validateSoundscaperProject(project);

	assert.equal(project.schemaVersion, PROJECT_SCHEMA_VERSION);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.tracks.filter(({ type }) => type === 'audio').length, 24);
	assert.equal(project.tracks.filter(({ type }) => type === 'video').length, 2);
	assert.equal(project.clips.length, 26);
	assert.equal(project.sources.length, 26);
	assert.equal(Math.max(...project.clips.map((clip) => {
		const projection = resolveRuntimeClipProjection(project, clip);
		return projection.timelineEndFrame;
	})), 48_000 * 7_200);
});

test('the seeded edit plan contains exactly 10,000 production commands in a frozen mix', () => {
	const first = createM3LongformEditorialEditPlan();
	const second = createM3LongformEditorialEditPlan();

	assert.deepEqual(second, first);
	assert.equal(first.commands.length, 10_000);
	assert.deepEqual(first.operationCounts, {
		audioClipMoves: 2_500,
		proxyVideoClipMoves: 2_500,
		selectionChanges: 2_500,
		trackMixChanges: 2_500,
	});
	assert.deepEqual(
		Object.fromEntries([...new Set(first.commands.map(({ type }) => type))]
			.map((type) => [type, first.commands.filter((command) => command.type === type).length])),
		{
			'clip/move': 5_000,
			'selection/set': 2_500,
			'track/update': 2_500,
		},
	);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.commands), true);
});

test('the edit workload replays deterministically with exact audio and video positions', () => {
	const plan = createM3LongformEditorialEditPlan();
	const first = applyM3LongformEditorialEditPlan(createM3LongformEditorialBaseProject(), plan);
	const second = applyM3LongformEditorialEditPlan(createM3LongformEditorialBaseProject(), plan);
	validateSoundscaperProject(first);

	assert.deepEqual(second, first);
	assert.equal(first.revision, 40, '250 edits are committed in each deterministic transaction');
	const checks = resolveM3LongformEditorialPositionChecks(first, plan);
	assert.equal(checks.length, 26);
	assert.ok(checks.every(({ audioPositionErrorSamples }) => audioPositionErrorSamples === 0));
	assert.ok(checks.every(({ videoPositionErrorFrames }) => videoPositionErrorFrames === 0));
	assert.equal(Math.max(...checks.map(({ audioPositionErrorSamples }) => audioPositionErrorSamples)), 0);
	assert.equal(Math.max(...checks.map(({ videoPositionErrorFrames }) => videoPositionErrorFrames)), 0);
});

test('the complete generated workload remains byte deterministic and specification-bound', () => {
	const first = createM3LongformEditorialWorkload();
	const second = createM3LongformEditorialWorkload();
	const projectBytes = JSON.stringify(first.project);
	const planBytes = JSON.stringify(first.editPlan.commands);

	assert.deepEqual(second, first);
	assert.equal(first.specification, M3_LONGFORM_EDITORIAL_SPECIFICATION);
	assert.equal(first.editPlan.commands.length, first.specification.editCount);
	assert.equal(
		createHash('sha256').update(projectBytes).digest('hex'),
		first.specification.expectedProjectSha256,
	);
	assert.equal(
		createHash('sha256').update(planBytes).digest('hex'),
		first.specification.expectedEditPlanSha256,
	);
});

// The fixture kind is `deterministic-current-schema-project-generator`, and the
// browser harness seeds it straight into the project store rather than through
// an import that could migrate it. A fixture generated one schema behind the
// maintained product is therefore unopenable, which is how this workload sat
// broken while nothing ran the benchmark: keep it pinned to the newest declared
// Soundscaper schema so the next schema bump fails here instead of in a nightly.
test('the long-form fixture is generated at the newest declared Soundscaper schema', () => {
	const project = createM3LongformEditorialBaseProject();
	assert.equal(project.schemaFamily, 'soundscaper');
	assert.equal(project.schemaVersion, PROJECT_SCHEMA_VERSION);
});

test('the maintained Soundscaper loader opens the long-form fixture without migration', () => {
	const loaded = loadSoundscaperProject(createM3LongformEditorialWorkload().project);
	assert.equal(loaded.readOnly, false);
	assert.equal(loaded.intrinsicReadOnly, false);
	assert.equal(loaded.reason, null);
});
