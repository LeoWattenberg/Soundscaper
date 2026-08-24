/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { applyFramescaperProjectCommandV28 } from '../src/framescaper/editor-project-v28-commands.ts';
import { framescaperProjectV27FoundationShapeV28 } from '../src/framescaper/editor-project-v28-foundation.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createEditorProjectRuntimeV28Selection } from '../src/framescaper/editor-project-runtime-v28-selection.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

type FoundationView = Readonly<{
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<{ readonly clips: readonly Readonly<Record<string, unknown>>[] }>;
}>;

test('selected V28 retains foundation schemas for inherited command and clipboard consumers', () => {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const runtime = createEditorProjectRuntimeV28Selection(profile);
	const commandProject = runtime.projectForCommandConsumers(project);
	assert.equal(commandProject.schemaVersion, 17);
	assert.equal(isRuntimeProjectProjection(commandProject), true);
	assert.equal(planFrameCanonicalEdgeTrim(commandProject, {
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: 4_800,
	}).kind, 'transform');
	assert.equal(runtime.projectForEditClipboardConsumers(project).schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 28);
});

test('selected V28 upgrades an inherited browser video source add to professional authority', () => {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const foundation = framescaperProjectV27FoundationShapeV28(project) as unknown as FoundationView;
	const source = structuredClone(foundation.sources.find(({ kind }) => kind === 'video')) as
		Record<string, unknown>;
	assert.ok(source);
	Object.assign(source, {
		id: 'browser-imported-video', storageKey: 'browser-imported-video',
		contentSha256: '31'.repeat(32), name: 'browser-imported.mp4',
	});
	const updated = applyFramescaperProjectCommandV28(profile, project, {
		type: 'source/add', source,
	});
	const imported = updated.sources.find(({ id }) => id === 'browser-imported-video');
	assert.ok(imported?.kind === 'video');
	assert.equal(imported.imageSequence, null);
	assert.deepEqual(imported.characteristics, normalizeVideoSourceCharacteristicsV25(
		source.characteristics,
		{ rate: source.frameRate as Readonly<{ num: number; den: number }> },
	));
	assert.equal(updated.videoSourceColorInterpretations.some(
		({ sourceId }) => sourceId === 'browser-imported-video',
	), true);
});

test('selected V28 preflights inherited batch children against prior children', () => {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const foundation = framescaperProjectV27FoundationShapeV28(project) as unknown as FoundationView;
	const source = structuredClone(foundation.sources.find(({ kind }) => kind === 'video')) as
		Record<string, unknown>;
	const clip = structuredClone(foundation.projectBin.clips[0]) as Record<string, unknown>;
	assert.ok(source);
	assert.ok(clip);
	Object.assign(source, {
		id: 'browser-batch-video', storageKey: 'browser-batch-video',
		contentSha256: '32'.repeat(32), name: 'browser-batch-video.mp4',
		imageSequence: null,
	});
	Object.assign(clip, {
		id: 'browser-batch-bin-clip', binItemId: 'browser-batch-bin-clip',
		sourceId: 'browser-batch-video', title: 'Browser batch video',
	});
	const updated = createEditorProjectRuntimeV28Selection(profile).applyCommand(project, {
		type: 'batch',
		commands: [
			{ type: 'source/add', source },
			{ type: 'project-bin/add', clip },
		],
	});
	const imported = updated.sources.find(({ id }) => id === 'browser-batch-video');
	assert.equal(imported?.kind, 'video');
	assert.equal(imported?.imageSequence, null);
	const projectBin = updated.projectBin as Readonly<{
		readonly clips: readonly Readonly<{ readonly id: string }>[];
	}>;
	assert.equal(projectBin.clips.some(({ id }) => id === 'browser-batch-bin-clip'), true);
});

test('selected V28 applies an inherited audio/video lane pair atomically', () => {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const updated = createEditorProjectRuntimeV28Selection(profile).applyCommand(project, {
		type: 'batch',
		commands: [{
			...createAddTrackCommand({
				type: 'video', id: 'browser-import-video-track', name: 'Imported video',
				laneGroupId: 'browser-import-media-lane',
			}),
			index: 2,
		}, {
			...createAddTrackCommand({
				type: 'audio', id: 'browser-import-audio-track', name: 'Imported audio',
				laneGroupId: 'browser-import-media-lane', armed: false,
			}),
			index: 3,
		}],
	});
	const tracks = updated.tracks as readonly Readonly<{
		readonly id: string;
		readonly laneGroupId: string | null;
	}>[];
	assert.deepEqual(tracks.slice(2).map(({ id, laneGroupId }) => ({ id, laneGroupId })), [{
		id: 'browser-import-video-track', laneGroupId: 'browser-import-media-lane',
	}, {
		id: 'browser-import-audio-track', laneGroupId: 'browser-import-media-lane',
	}]);
	assert.equal(Number(updated.revision), Number(project.revision) + 1);
});
