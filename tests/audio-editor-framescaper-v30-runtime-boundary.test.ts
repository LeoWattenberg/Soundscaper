/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createFramescaperPlaybackProjectServiceV30 } from '../src/framescaper/editor-project-playback-v30.ts';
import { createEditorProjectRuntimeV30Selection } from '../src/framescaper/editor-project-runtime-v30-selection.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { migrateFramescaperProjectV30 } from '../src/framescaper/editor-project-v30-migration.ts';
import {
	framescaperProjectForCommandConsumersV30,
	framescaperProjectForRuntimeConsumersV30,
} from '../src/framescaper/editor-project-v30-runtime.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { addFramescaperV30BoundaryImage } from './helpers/framescaper-v30-boundary-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;

test('V30 migration keeps exact image authority writable and older selected authority explicit', () => {
	const base = createFramescaperProjectV30(PROFILE, framescaperV20Options());
	const image = addFramescaperV30BoundaryImage(base).project;
	const loaded = migrateFramescaperProjectV30(PROFILE, image);
	assert.equal(loaded.migrated, false);
	assert.equal(loaded.fromVersion, 30);
	assert.equal(records(record(loaded.project).sources).some(({ kind }) => kind === 'image'), true);
	assert.equal(loaded.intrinsicReadOnly, false);

	const v28 = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	assert.throws(() => migrateFramescaperProjectV30(PROFILE, v28), /reimport/iu);
	const future = migrateFramescaperProjectV30(PROFILE, {
		...structuredClone(v28), schemaVersion: 31, futureState: true,
	});
	assert.equal(future.intrinsicReadOnly, true);
	assert.equal(future.reason, 'newer-schema');
});

test('V30 runtime and command projections retain image identity, placement, and resolved timing', () => {
	const base = createFramescaperProjectV30(PROFILE, framescaperV20Options());
	const fixture = addFramescaperV30BoundaryImage(base);
	for (const [project, schemaVersion] of [
		[framescaperProjectForRuntimeConsumersV30(PROFILE, fixture.project), 30],
		[framescaperProjectForCommandConsumersV30(PROFILE, fixture.project), 17],
	] as const) {
		assert.equal(isRuntimeProjectProjection(project), true);
		assert.equal(project.schemaVersion, schemaVersion);
		const sources = records(project.sources);
		const clips = records(project.clips);
		const source = sources.find(({ id }) => id === fixture.source.id);
		const clip = clips.find(({ id }) => id === fixture.clip.id);
		assert.equal(source?.kind, 'image');
		assert.equal(source?.contentSha256, fixture.source.contentSha256);
		assert.equal(clip?.kind, 'image');
		assert.equal(clip?.sourceStartTicks, '0');
		assert.equal(clip?.coordinateDomain, 'resolved-samples');
		assert.equal(Number(clip?.durationFrames) > 0, true);
		assert.equal(
			records(project.tracks).some(({ clipIds }) => (
				Array.isArray(clipIds) && clipIds.includes(fixture.clip.id)
			)),
			true,
		);
	}
});

test('V30 playback admits exact images, projects them for playback, and keeps opaque custody inert', () => {
	const base = createFramescaperProjectV30(PROFILE, framescaperV20Options());
	const fixture = addFramescaperV30BoundaryImage(base);
	const playback = createFramescaperPlaybackProjectServiceV30(PROFILE);
	assert.ok(playback.projectForActivationAdmission);
	const admission = playback.projectForActivationAdmission(fixture.project);
	assert.equal(records(admission.project.sources).some(({ kind }) => kind === 'image'), true);
	assert.equal(admission.featureRequirementsReport?.compatible, true);
	const projected = playback.projectForPlayback(fixture.project);
	assert.equal(isRuntimeProjectProjection(projected.project), true);
	assert.equal(records(projected.project.clips).some(({ kind }) => kind === 'image'), true);

	const opaque = playback.projectForPlayback({
		...structuredClone(fixture.project), schemaVersion: 31, futureState: true,
	});
	assert.equal(record(opaque.project).schemaVersion, 30);
	assert.deepEqual(record(opaque.project).sources, []);
	assert.deepEqual(opaque.requiredAudioSourceIds, []);
	assert.deepEqual(opaque.requiredVideoSourceIds, []);
});

test('selected V30 runtime preserves image commands/history and refuses writes to opaque custody', () => {
	const runtime = createEditorProjectRuntimeV30Selection(PROFILE);
	const base = runtime.createProject(framescaperV20Options());
	const fixture = addFramescaperV30BoundaryImage(base);
	const history = runtime.createHistory(base);
	const executed = runtime.executeCommand(history, {
		type: 'batch',
		commands: [{
			type: 'image-source/set', sourceId: fixture.source.id,
			expectedSource: null, source: fixture.source,
		}, {
			type: 'image-clip/set', clipId: fixture.clip.id,
			expectedClip: null, expectedPlacement: null, clip: fixture.clip,
			placement: {
				scope: 'timeline',
				trackId: String(base.tracks.find(({ type, locked }) => type === 'video' && !locked)?.id),
			},
		}],
	}, { now: '2026-08-25T12:00:00.000Z' });
	assert.equal(executed.present.sources.some(({ kind }) => kind === 'image'), true);
	assert.equal(runtime.undo(executed).present.sources.some(({ kind }) => kind === 'image'), false);
	assert.equal(records(runtime.projectForRuntimeConsumers(executed.present).clips)
		.some(({ kind }) => kind === 'image'), true);

	const future = { ...structuredClone(fixture.project), schemaVersion: 31 };
	const custody = runtime.createHistory(future);
	assert.equal(custody.present.schemaVersion, 31);
	assert.throws(() => runtime.executeCommand(custody, {
		type: 'project/rename', title: 'Forbidden',
	}), /read-only/iu);
	assert.equal(record(runtime.projectForCommandConsumers(future)).schemaVersion, 30);
});

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a record.');
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError('Expected an array.');
	return value.map(record);
}
