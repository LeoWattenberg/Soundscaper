/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
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
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 runtime owns exact creation, projection, storage, and explicit reimport', async () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = projectFixture('selected-v27');
	assert.equal(runtime.validateProject(project), true);
	assert.equal(runtime.migrateProject(project).readOnly, false);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);
	assert.equal(
		(runtime.projectForRuntimeConsumers(project).clips as readonly unknown[]).length,
		(project.clips as readonly unknown[]).length,
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
	assert.deepEqual(applied.tracks.slice(2).map(({ id, laneGroupId }) => ({ id, laneGroupId })), [{
		id: 'import-video-track', laneGroupId: 'import-media-lane',
	}, {
		id: 'import-audio-track', laneGroupId: 'import-media-lane',
	}]);
	assert.equal(Number(applied.revision), Number(project.revision) + 1);
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
