/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddLabelTrackCommand } from '../src/common/editor/commands/factories.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createFramescaperPlaybackProjectServiceV32 } from '../src/framescaper/editor-project-playback-v32.ts';
import { createEditorProjectRuntimeV32Selection } from '../src/framescaper/editor-project-runtime-v32-selection.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import { migrateFramescaperProjectV32 } from '../src/framescaper/editor-project-v32-migration.ts';
import {
	framescaperProjectForCommandConsumersV32,
	framescaperProjectForRuntimeConsumersV32,
} from '../src/framescaper/editor-project-v32-runtime.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { addFramescaperV32BoundaryImage } from './helpers/framescaper-v32-boundary-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

test('V32 migration keeps exact image authority writable and older selected authority explicit', () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const image = addFramescaperV32BoundaryImage(base).project;
	const loaded = migrateFramescaperProjectV32(PROFILE, image);
	assert.equal(loaded.migrated, false);
	assert.equal(loaded.fromVersion, 32);
	assert.equal(records(record(loaded.project).sources).some(({ kind }) => kind === 'image'), true);
	assert.equal(loaded.intrinsicReadOnly, false);

	const v28 = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	assert.throws(() => migrateFramescaperProjectV32(PROFILE, v28), /reimport/iu);
	const future = migrateFramescaperProjectV32(PROFILE, {
		...structuredClone(v28), schemaVersion: 31, futureState: true,
	});
	assert.equal(future.intrinsicReadOnly, true);
	assert.equal(future.reason, 'newer-schema');
});

test('V32 runtime and command projections retain image identity, placement, and resolved timing', () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const fixture = addFramescaperV32BoundaryImage(base);
	for (const [project, schemaVersion] of [
		[framescaperProjectForRuntimeConsumersV32(PROFILE, fixture.project), 32],
		[framescaperProjectForCommandConsumersV32(PROFILE, fixture.project), 17],
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

test('V32 runtime and command projections preserve non-clip label tracks', () => {
	const runtime = createEditorProjectRuntimeV32Selection(PROFILE);
	const base = runtime.createProject(framescaperV20Options());
	const labeled = runtime.applyCommand(base, createAddLabelTrackCommand({
		id: 'transcript-labels', name: 'Transcript', labels: [{
			id: 'transcript-label-1', title: 'Exact caption', startFrame: 0, endFrame: 48_000,
		}],
	}) as never);

	for (const projected of [
		runtime.projectForCommandConsumers(labeled),
		runtime.projectForRuntimeConsumers(labeled),
	]) {
		const track = records(projected.tracks).find(({ id }) => id === 'transcript-labels');
		assert.equal(track?.type, 'label');
		assert.equal('clipIds' in (track ?? {}), false);
		assert.deepEqual(track?.labels, [{ id: 'transcript-label-1', title: 'Exact caption',
			startFrame: 0, endFrame: 48_000, color: 'auto', opaqueExtensions: {},
			anchor: 'sample', startBeat: null, endBeat: null }]);
	}
});

test('V32 playback admits exact images, projects them for playback, and keeps opaque custody inert', () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const fixture = addFramescaperV32BoundaryImage(base);
	const playback = createFramescaperPlaybackProjectServiceV32(PROFILE);
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
	assert.equal(record(opaque.project).schemaVersion, 32);
	assert.deepEqual(record(opaque.project).sources, []);
	assert.deepEqual(opaque.requiredAudioSourceIds, []);
	assert.deepEqual(opaque.requiredVideoSourceIds, []);
});

test('selected V32 runtime preserves image commands/history and refuses writes to opaque custody', () => {
	const runtime = createEditorProjectRuntimeV32Selection(PROFILE);
	const base = runtime.createProject(framescaperV20Options());
	const fixture = addFramescaperV32BoundaryImage(base);
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
	assert.equal(record(runtime.projectForCommandConsumers(future)).schemaVersion, 32);
});

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a record.');
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError('Expected an array.');
	return value.map(record);
}
