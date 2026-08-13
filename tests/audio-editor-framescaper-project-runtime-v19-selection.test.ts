/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from '../src/framescaper/editor-project-feature-requirements-v19.ts';
import {
	createEditorProjectRuntimeV19Selection,
} from '../src/framescaper/editor-project-runtime-v19-selection.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;

test('V19 selection authenticates exact runtime before any optional argument traversal', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(() => (
		createEditorProjectRuntimeV19Selection as (...args: unknown[]) => unknown
	)({}, options), /exact Framescaper V19/iu);
	assert.equal(reads, 0);
});

test('selected V19 runtime creates, projects, commands, and histories exact composition', () => {
	const runtime = createEditorProjectRuntimeV19Selection(PROFILE);
	const project = projectFixture('selected-v19');
	assert.equal(runtime.validateProject(project), true);
	assert.deepEqual(runtime.cloneProject(project), project);
	assert.equal(runtime.migrateProject(project).project.schemaVersion, 19);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);
	const commandProjection = runtime.projectForCommandConsumers(project);
	assert.deepEqual(
		(commandProjection.clips as Readonly<Record<string, unknown>>[])[0]?.videoComposition,
		DEFAULT_VIDEO_CLIP_COMPOSITION,
	);

	const composition = authoredComposition();
	const command = {
		type: 'video-composition/set' as const,
		clipId: 'video-clip',
		expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		composition,
	};
	const applied = runtime.applyCommand(project, command, { now: '2026-08-13T12:01:00.000Z' });
	assert.deepEqual(applied.clips[0]?.videoComposition, composition);
	const commanded = runtime.executeCommand(runtime.createHistory(project), command, {
		now: '2026-08-13T12:01:00.000Z',
	});
	assert.equal(runtime.canUndo(commanded), true);
	assert.equal(runtime.canRedo(commanded), false);
	const undone = runtime.undo(commanded, { now: '2026-08-13T12:02:00.000Z' });
	assert.deepEqual(undone.present.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(runtime.canRedo(undone), true);
	assert.deepEqual(
		runtime.redo(undone, { now: '2026-08-13T12:03:00.000Z' }).present.clips[0]?.videoComposition,
		composition,
	);
});

test('selected V19 session derives writable, proxy read-only, reimport, and future states', () => {
	const runtime = createEditorProjectRuntimeV19Selection(PROFILE);
	const session = runtime.createSessionController();
	const project = projectFixture('session-v19');
	assert.deepEqual(session.openProject(project), {
		projectId: project.id,
		opened: true,
		activated: true,
		releasedSourceIds: [],
	});
	assert.equal(session.getSnapshot().tabs[0]?.readOnly, false);
	assert.equal(session.getProject().schemaVersion, 19);

	const attached = attachedProject(projectFixture('attached-v19'));
	session.openProject(attached);
	assert.equal(session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === attached.id
	))?.readOnly, true);
	let nestedReads = 0;
	assert.throws(() => runtime.migrateProject({
		schemaVersion: 18,
		sources: new Proxy([], { get() { nestedReads += 1; throw new Error('nested read'); } }),
	}), /re-import/iu);
	assert.equal(nestedReads, 0);
	session.openProject({ schemaVersion: 20, id: 'future-v20', title: 'Future', sources: [], clips: [], tracks: [] });
	assert.equal(session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === 'future-v20'
	))?.readOnly, true);
});

test('selected V19 runtime owns exact store and lock profiles without overrides', async () => {
	const runtime = createEditorProjectRuntimeV19Selection(PROFILE);
	const store = runtime.createProjectStore({ indexedDB: null, preferOpfs: false }) as {
		databaseName: string;
		close(): Promise<void>;
	};
	assert.equal(store.databaseName, editorProjectStorageProfileNames(runtime.storageProfile).databaseName);
	await store.close();
	assert.throws(
		() => runtime.acquireProjectLock('project-v19', { navigator: {} }),
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
		assert.throws(
			() => runtime.createProjectStore(options),
			/authority override|selected V19 store/iu,
		);
		assert.equal(reads, 0);
	}
	assert.throws(
		() => (runtime.createSessionController as (options: unknown) => unknown)({ currentSchemaVersion: 17 }),
		/session options|does not accept/iu,
	);
});

function projectFixture(id: string): ReturnType<typeof createFramescaperProjectV19> {
	return createFramescaperProjectV19(PROFILE, {
		id, title: 'Selected V19', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function authoredComposition() {
	return normalizeVideoClipComposition({
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		opacity: 0.5,
		blendMode: 'multiply',
	});
}

function attachedProject(
	project: ReturnType<typeof createFramescaperProjectV19>,
): ReturnType<typeof createFramescaperProjectV19> {
	const attached = structuredClone(project) as unknown as Record<string, unknown>;
	((attached.sources as Record<string, unknown>[])[0]!).proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${'34'.repeat(32)}`, mimeType: 'video/mp4', byteLength: 4_096,
		sha256: '34'.repeat(32), originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${'56'.repeat(32)}`,
			sha256: '56'.repeat(32), sourceSha256: '34'.repeat(32), byteLength: 112,
			frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	attached.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(PROFILE, attached);
	return attached as ReturnType<typeof createFramescaperProjectV19>;
}
