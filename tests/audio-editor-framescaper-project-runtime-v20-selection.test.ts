/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSetVideoKeyframesCommand } from '../src/common/editor/commands.js';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	createEditorProjectRuntimeV20Selection,
} from '../src/framescaper/editor-project-runtime-v20-selection.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;
const NOW = '2026-08-13T12:00:00.000Z';

test('V20 runtime composition authenticates model authority before optional traversal', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(() => (
		createEditorProjectRuntimeV20Selection as (...args: unknown[]) => unknown
	)({}, options), /exact Framescaper V20/iu);
	assert.equal(reads, 0);
});

test('V20 qualification runtime composes exact projects, commands, histories, and projections', () => {
	const runtime = createEditorProjectRuntimeV20Selection(PROFILE);
	const project = projectFixture('selected-v20');
	assert.equal(runtime.validateProject(project), true);
	assert.deepEqual(runtime.cloneProject(project), project);
	assert.equal(runtime.migrateProject(project).project.schemaVersion, 20);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);

	const expectedKeyframes = project.clips[0]!.videoKeyframes;
	const keyframes = opacityKeyframes(30);
	const command = createSetVideoKeyframesCommand('video-clip', expectedKeyframes, keyframes);
	const applied = runtime.applyCommand(project, command, { now: '2026-08-13T12:01:00.000Z' });
	assert.deepEqual(applied.clips[0]?.videoKeyframes, keyframes);
	const commanded = runtime.executeCommand(runtime.createHistory(project), command, {
		now: '2026-08-13T12:01:00.000Z',
	});
	assert.equal(runtime.canUndo(commanded), true);
	assert.equal(runtime.canRedo(commanded), false);
	const undone = runtime.undo(commanded, { now: '2026-08-13T12:02:00.000Z' });
	assert.deepEqual(undone.present.clips[0]?.videoKeyframes, expectedKeyframes);
	assert.equal(runtime.canRedo(undone), true);
	assert.deepEqual(
		runtime.redo(undone, { now: '2026-08-13T12:03:00.000Z' }).present.clips[0]?.videoKeyframes,
		keyframes,
	);
});

test('V20 qualification session opens exact documents and future documents read-only', () => {
	const runtime = createEditorProjectRuntimeV20Selection(PROFILE);
	const session = runtime.createSessionController();
	const project = projectFixture('session-v20');
	assert.deepEqual(session.openProject(project), {
		projectId: project.id,
		opened: true,
		activated: true,
		releasedSourceIds: [],
	});
	assert.equal(session.getSnapshot().tabs[0]?.readOnly, false);
	assert.equal(session.getProject().schemaVersion, 20);
	session.openProject({
		schemaVersion: 21, id: 'future-v21', title: 'Future', sources: [], clips: [], tracks: [],
	});
	assert.equal(session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === 'future-v21'
	))?.readOnly, true);
});

test('V20 qualification runtime owns isolated store and lock profiles', async () => {
	const runtime = createEditorProjectRuntimeV20Selection(PROFILE);
	const store = runtime.createProjectStore({ indexedDB: null, preferOpfs: false }) as {
		databaseName: string;
		close(): Promise<void>;
	};
	assert.equal(store.databaseName, editorProjectStorageProfileNames(runtime.storageProfile).databaseName);
	await store.close();
	assert.throws(
		() => runtime.acquireProjectLock('project-v20', { navigator: {} }),
		/environment|callback authority override/iu,
	);
	for (const field of [
		'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
	]) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		assert.throws(() => runtime.createProjectStore(options), /authority override|V20 qualification/iu);
		assert.equal(reads, 0);
	}
	assert.throws(
		() => (runtime.createSessionController as (options: unknown) => unknown)({ currentSchemaVersion: 17 }),
		/session.*options|does not accept/iu,
	);
});

function projectFixture(id: string): ReturnType<typeof createFramescaperProjectV20> {
	const project = createFramescaperProjectV20(PROFILE, {
		id, title: 'Selected V20', now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	return project;
}
