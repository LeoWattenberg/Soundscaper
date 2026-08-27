/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import {
	createAddLabelTrackCommand,
	createAddTrackCommand,
} from '../src/common/editor/commands/factories.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	applyFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-commands.ts';
import {
	createFramescaperProjectHistoryV27,
	executeFramescaperProjectCommandV27,
	redoFramescaperProjectCommandV27,
	undoFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-history.ts';
import {
	createEditorProjectRuntimeV27Selection,
} from '../src/framescaper/editor-project-runtime-v27-selection.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	createFramescaperProjectStoreV27,
	framescaperProjectStoreAuthorityV27,
} from '../src/framescaper/editor-project-store-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import { prepareFramescaperSelectedAuthoringV27 } from '../src/framescaper/editor-selected-v27-authoring-workflows.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 runtime owns exact creation, projection, storage, and explicit reimport', async () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = projectFixture('selected-v27');
	assert.equal(runtime.validateProject(project), true);
	assert.equal(runtime.migrateProject(project).readOnly, false);
	const commandProject = runtime.projectForCommandConsumers(project);
	assert.equal(commandProject.schemaVersion, 17);
	assert.equal(isRuntimeProjectProjection(commandProject), true);
	assert.equal(planFrameCanonicalEdgeTrim(commandProject, {
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: 4_800,
	}).kind, 'transform');
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 27);
	assert.equal(
		(runtime.projectForRuntimeConsumers(project).clips as readonly unknown[]).length,
		(project.clips as readonly unknown[]).length,
	);
	const authored = await prepareFramescaperSelectedAuthoringV27(
		'video-solid', project, {} as never,
	);
	assert.ok(authored);
	const withSolid = runtime.applyCommand(project, authored.command as never);
	const solidCommandProject = runtime.projectForCommandConsumers(withSolid);
	const solidClip = (solidCommandProject.clips as readonly Readonly<Record<string, unknown>>[])
		.find(({ kind }) => kind === 'generator');
	assert.ok(solidClip);
	assert.equal(solidCommandProject.schemaVersion, 17);
	assert.equal(isRuntimeProjectProjection(solidCommandProject), true);
	assert.equal(solidClip.coordinateDomain, 'resolved-samples');
	assert.equal(Number.isSafeInteger(solidClip.timelineStartFrame), true);
	assert.equal(Number.isSafeInteger(solidClip.timelineEndFrame), true);
	assert.equal(Number(solidClip.durationFrames) > 0, true);
	const selectedSolid = runtime.applyCommand(withSolid, {
		type: 'selection/set', startFrame: 0, endFrame: 0,
		trackIds: ['video-track'], clipIds: [String(solidClip.id)], frequencyRange: null,
	} as never);
	assert.deepEqual(
		(selectedSolid.selection as Readonly<{ clipIds: unknown }>).clipIds,
		[solidClip.id],
	);
	assert.deepEqual(
		(runtime.projectForCommandConsumers(selectedSolid).selection as Readonly<{ clipIds: unknown }>).clipIds,
		[solidClip.id],
	);
	assert.deepEqual(
		(runtime.projectForRuntimeConsumers(selectedSolid).selection as Readonly<{ clipIds: unknown }>).clipIds,
		[solidClip.id],
	);
	assert.deepEqual(editorProjectStorageProfileNames(runtime.storageProfile), {
		databaseName: 'kw-media-framescaper-editor-v27',
		opfsDirectoryName: 'framescaper-editor-v27-sources',
		opfsWorkerName: 'framescaper-editor-v27-opfs-storage',
		projectLockPrefix: 'kw-media-framescaper-editor-v27-lock:',
	});
	const v24 = createFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, {
		...framescaperV20Options(), id: 'prior-v24', videoTransitionsByTrackId: { 'video-track': [] },
	});
	assert.throws(() => runtime.migrateProject(v24), /explicit.*reimport|re-import/iu);
	assert.equal(runtime.reimportProject(v24).schemaVersion, 27);

	const store = createFramescaperProjectStoreV27(PROFILE, { indexedDB: null, preferOpfs: false });
	const created = await store.projectRepository.createIfAbsent!(project as never);
	assert.deepEqual(created, project);
	const authority = framescaperProjectStoreAuthorityV27(PROFILE, store);
	authority.port.memory.projects.set('custody-v26', {
		id: 'custody-v26', title: 'Custody', revision: 0, schemaVersion: 26,
		ofxEffects: [{ opaque: true }],
	});
	assert.deepEqual(await store.projectRepository.load('custody-v26'), {
		id: 'custody-v26', title: 'Custody', revision: 0, schemaVersion: 26,
		ofxEffects: [{ opaque: true }],
	});
	await store.close();
});

test('selected V27 projections preserve non-clip label tracks', () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = projectFixture('label-track-v27');
	const labeled = runtime.applyCommand(project, createAddLabelTrackCommand({
		id: 'transcript-labels', name: 'Transcript', labels: [{
			id: 'transcript-label-1', title: 'Exact caption', startFrame: 0, endFrame: 48_000,
		}],
	}) as never);

	for (const projected of [
		runtime.projectForCommandConsumers(labeled),
		runtime.projectForRuntimeConsumers(labeled),
	]) {
		const track = (projected.tracks as readonly Readonly<Record<string, unknown>>[])
			.find(({ id }) => id === 'transcript-labels');
		assert.equal(track?.type, 'label');
		assert.equal('clipIds' in (track ?? {}), false);
		assert.deepEqual(track?.labels, [{ id: 'transcript-label-1', title: 'Exact caption',
			startFrame: 0, endFrame: 48_000, color: 'auto', opaqueExtensions: {},
			anchor: 'sample', startBeat: null, endBeat: null }]);
	}
});

test('inherited V24 commands and history preserve all V27 finishing authority', () => {
	const project = projectFixture('history-v27');
	const finishing = finishingSnapshot(project);
	const command = { type: 'project/rename' as const, title: 'Renamed V27' };
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, command, {
		now: '2026-08-23T12:01:00.000Z',
	});
	assert.equal(applied.title, 'Renamed V27');
	assert.deepEqual(finishingSnapshot(applied), finishing);
	const executed = executeFramescaperProjectCommandV27(
		PROFILE, createFramescaperProjectHistoryV27(PROFILE, project), command,
		{ now: '2026-08-23T12:01:00.000Z' },
	);
	const undone = undoFramescaperProjectCommandV27(PROFILE, executed, {
		now: '2026-08-23T12:02:00.000Z',
	});
	assert.equal(undone.present.title, project.title);
	assert.deepEqual(finishingSnapshot(undone.present), finishing);
	const redone = redoFramescaperProjectCommandV27(PROFILE, undone, {
		now: '2026-08-23T12:03:00.000Z',
	});
	assert.equal(redone.present.title, 'Renamed V27');
	assert.deepEqual(finishingSnapshot(redone.present), finishing);
});

test('inherited media commands create the required managed-color interpretation', () => {
	const project = projectFixture('source-command-v27');
	const source = structuredClone((project.sources as readonly Record<string, unknown>[])[0]!);
	source.id = 'second-video';
	source.storageKey = 'second-video';
	source.contentSha256 = '34'.repeat(32);
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'source/add', source,
	});
	assert.deepEqual(applied.videoSourceColorInterpretations.map(({ sourceId, provenance }) => ({
		sourceId, provenance,
	})), [{
		sourceId: 'video-source', provenance: 'default-video-bt709-limited',
	}, {
		sourceId: 'second-video', provenance: 'default-video-bt709-limited',
	}]);
});

test('inherited source admission derives reported identity and retains explicit user overrides', () => {
	const project = projectFixture('metadata-source-command-v27');
	const source = structuredClone((project.sources as readonly Record<string, unknown>[])[0]!);
	source.id = 'hdr-video';
	source.storageKey = 'hdr-video';
	source.contentSha256 = '56'.repeat(32);
	const characteristics = source.characteristics as Record<string, unknown>;
	characteristics.colour = {
		primaries: 'bt2020', transfer: 'arib-std-b67', matrix: 'bt2020nc', range: 'limited',
	};
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'source/add', source,
	});
	assert.deepEqual(applied.videoSourceColorInterpretations.find(({ sourceId }) => (
		sourceId === 'hdr-video'
	)), {
		schemaVersion: 1, sourceId: 'hdr-video', sourceKind: 'video',
		primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', range: 'limited',
		provenance: 'metadata',
	});

	const overriddenValue = structuredClone(applied) as unknown as Record<string, unknown>;
	const interpretation = (overriddenValue.videoSourceColorInterpretations as Array<Record<string, unknown>>)
		.find(({ sourceId }) => sourceId === 'hdr-video')!;
	Object.assign(interpretation, {
		primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
		provenance: 'user-override',
	});
	const renamed = applyFramescaperProjectCommandV27(PROFILE, overriddenValue, {
		type: 'project/rename', title: 'Override retained',
	});
	assert.equal(renamed.videoSourceColorInterpretations.find(({ sourceId }) => (
		sourceId === 'hdr-video'
	))?.provenance, 'user-override');
});

test('inherited media import batches admit an adjacent A/V lane pair atomically', () => {
	const project = projectFixture('import-batch-v27');
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'batch',
		commands: [{
			...createAddTrackCommand({
				type: 'video', id: 'import-video-track', name: 'Imported video',
				laneGroupId: 'import-media-lane',
			}),
			index: 2,
		}, {
			...createAddTrackCommand({
				type: 'audio', id: 'import-audio-track', name: 'Imported audio',
				laneGroupId: 'import-media-lane', armed: false,
			}),
			index: 3,
		}],
	});
	const tracks = applied.tracks as readonly Readonly<{
		readonly id: string;
		readonly laneGroupId: string | null;
	}>[];
	assert.deepEqual(tracks.slice(2).map(({ id, laneGroupId }) => ({ id, laneGroupId })), [{
		id: 'import-video-track', laneGroupId: 'import-media-lane',
	}, {
		id: 'import-audio-track', laneGroupId: 'import-media-lane',
	}]);
	assert.equal(Number(applied.revision), Number(project.revision) + 1);
});

test('selected V27 prepares an exact transition allocation for a generic cross-track clip move', () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = overlapProjectFixture('automatic-transition-v27');
	const commandProject = runtime.projectForCommandConsumers(project);
	const command = prepareTransformClipsCommand(commandProject as never, [{
		clipId: 'incoming-video-clip', trackId: 'video-track',
		changes: { timelineStartFrame: 24_000 },
	}], {}, (prefix = 'item') => `${prefix}-automatic`);
	assert.throws(
		() => applyFramescaperProjectCommandV27(PROFILE, project, command as never),
		/requires videoTransitionAllocations/iu,
	);
	const executed = runtime.executeCommand(runtime.createHistory(project), command as never, {
		now: '2026-08-23T12:04:00.000Z',
	});
	const videoTrack = (executed.present.tracks as unknown as readonly Readonly<{
		readonly id: string;
		readonly type: string;
		readonly videoTransitions: readonly Readonly<{
			readonly id: string;
			readonly outgoingClipId: string;
			readonly incomingClipId: string;
			readonly durationFrames: number;
		}>[];
	}>[]).find(({ id }) => id === 'video-track');
	assert.equal(videoTrack?.type, 'video');
	const transition = videoTrack?.type === 'video' ? videoTrack.videoTransitions[0] : undefined;
	assert.ok(transition);
	assert.match(transition.id, /^transition-/u);
	assert.deepEqual(videoTrack?.type === 'video' ? videoTrack.videoTransitions.map((transition) => ({
		outgoingClipId: transition.outgoingClipId,
		incomingClipId: transition.incomingClipId,
		durationFrames: transition.durationFrames,
	})) : [], [{
		outgoingClipId: 'video-clip',
		incomingClipId: 'incoming-video-clip',
		durationFrames: 5,
	}]);
	assert.deepEqual(
		(executed.undoStack[0]?.command as Readonly<Record<string, unknown>>).videoTransitionAllocations,
		[{
			trackId: 'video-track', outgoingClipId: 'video-clip',
			incomingClipId: 'incoming-video-clip', transitionId: transition.id,
		}],
	);
});

test('selected V27 session refuses implicit prior conversion and preserves dormant custody', () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const session = runtime.createSessionController();
	const project = projectFixture('session-v27');
	session.openProject(project);
	assert.equal(session.getProject().schemaVersion, 27);
	assert.equal(session.getSnapshot().tabs[0]?.readOnly, false);
	assert.throws(() => session.openProject({
		...project, id: 'prior-v24', schemaVersion: 24,
	}), /explicit.*reimport|re-import/iu);
	session.openProject({
		id: 'custody-v25', title: 'Custody', revision: 0, schemaVersion: 25,
		nativeVideoSources: [{ retained: true }], sources: [], clips: [], tracks: [],
	});
	const custody = session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === 'custody-v25'
	));
	assert.equal(custody?.readOnly, true);
	assert.equal(custody?.readOnlyReason, 'known-dormant-custody');
});

function projectFixture(id: string) {
	return createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), id, videoTransitionsByTrackId: { 'video-track': [] },
	});
}

function overlapProjectFixture(id: string) {
	const options = structuredClone(framescaperV20Options());
	options.id = id;
	const source = {
		...(options.sources as readonly Readonly<Record<string, unknown>>[])[0],
		id: 'incoming-video-source', name: 'Incoming video', storageKey: 'incoming-video-source',
		contentSha256: '34'.repeat(32),
	};
	const clip = {
		...(options.clips as readonly Readonly<Record<string, unknown>>[])[0],
		id: 'incoming-video-clip', sourceId: source.id, title: 'Incoming video',
	};
	const track = {
		...(options.tracks as readonly Readonly<Record<string, unknown>>[])[0],
		id: 'incoming-video-track', name: 'Incoming video', clipIds: [clip.id],
	};
	(options.sources as Record<string, unknown>[]).push(source);
	(options.clips as Record<string, unknown>[]).push(clip);
	(options.tracks as Record<string, unknown>[]).splice(1, 0, track);
	((options.sequences as Array<Record<string, unknown>>)[0]!.trackIds as string[])
		.splice(1, 0, String(track.id));
	return createFramescaperProjectV27(PROFILE, {
		...options,
		videoTransitionsByTrackId: {
			'video-track': [],
			'incoming-video-track': [],
		},
	});
}

function finishingSnapshot(project: ReturnType<typeof projectFixture>) {
	return structuredClone({
		videoColorContexts: project.videoColorContexts,
		videoSourceColorInterpretations: project.videoSourceColorInterpretations,
		videoVisualPresentations: project.videoVisualPresentations,
		videoProcessorStacks: project.videoProcessorStacks,
		videoMotionAnalyses: project.videoMotionAnalyses,
		videoFinishingPresets: project.videoFinishingPresets,
		videoCaptionTracks: project.videoCaptionTracks,
		automationLanes: project.automationLanes,
		mixer: project.mixer,
	});
}
