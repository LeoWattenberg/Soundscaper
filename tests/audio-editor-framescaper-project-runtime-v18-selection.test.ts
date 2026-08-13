/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { createEditorProjectRuntimeV18Selection } from '../src/framescaper/editor-project-runtime-v18-selection.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('selection authenticates exact V18 before observing any options', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(() => (
		createEditorProjectRuntimeV18Selection as (...args: unknown[]) => unknown
	)({}, options), /exact Framescaper V18/iu);
	assert.equal(reads, 0);
});

test('selected runtime creates, migrates, projects, commands, and histories exact V18', () => {
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE);
	const project = runtime.createProject({ title: 'Selected V18', now: '2026-08-13T12:00:00.000Z' });
	assert.equal(project.schemaVersion, 18);
	assert.equal(runtime.validateProject(project), true);
	assert.deepEqual(runtime.cloneProject(project), project);
	assert.equal(runtime.migrateProject(project).project.schemaVersion, 18);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 18);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);
	assert.equal(runtime.applyCommand(project, {
		type: 'project/rename',
		title: 'Applied V18',
	}, { now: '2026-08-13T12:00:30.000Z' }).title, 'Applied V18');

	const history = runtime.createHistory(project);
	const commanded = runtime.executeCommand(history, {
		type: 'project/rename',
		title: 'Commanded V18',
	}, { now: '2026-08-13T12:01:00.000Z' });
	assert.equal(commanded.present.schemaVersion, 18);
	assert.equal(commanded.present.title, 'Commanded V18');
	assert.equal(runtime.canUndo(commanded), true);
	assert.equal(runtime.canRedo(commanded), false);
	assert.equal(runtime.undo(commanded, { now: '2026-08-13T12:02:00.000Z' }).present.title, 'Selected V18');
});

test('selected session derives writable, proxy-read-only, reimport, and future states from V18', () => {
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE);
	const session = runtime.createSessionController();
	const project = runtime.createProject({ title: 'Session V18', now: '2026-08-13T12:00:00.000Z' });
	assert.deepEqual(session.openProject(project), {
		projectId: project.id,
		opened: true,
		activated: true,
		releasedSourceIds: [],
	});
	assert.equal(session.getSnapshot().tabs[0]?.readOnly, false);
	assert.equal(session.getProject().schemaVersion, 18);

	const attached = attachedProject();
	assert.equal(runtime.compatibility.evaluate(attached)?.compatible, false);
	session.openProject(attached);
	assert.equal(session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === attached.id
	))?.readOnly, true);

	let nestedReads = 0;
	assert.throws(() => runtime.migrateProject({
		schemaVersion: 17,
		sources: new Proxy([], { get() { nestedReads += 1; throw new Error('nested read'); } }),
	}), /re-import/iu);
	assert.equal(nestedReads, 0);
	session.openProject({ schemaVersion: 19, id: 'future-v19', title: 'Future', sources: [], clips: [], tracks: [] });
	assert.equal(session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === 'future-v19'
	))?.readOnly, true);
});

function attachedProject(): ReturnType<typeof createFramescaperProjectV18> {
	const originalSha = '12'.repeat(32);
	const proxySha = '34'.repeat(32);
	const timingSha = '56'.repeat(32);
	const project = createFramescaperProjectV18(PROFILE, {
		id: 'attached-v18', title: 'Attached', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: originalSha, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
	const attached = structuredClone(project) as unknown as Record<string, unknown>;
	((attached.sources as Record<string, unknown>[])[0]!).proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha}`, mimeType: 'video/mp4', byteLength: 4096,
		sha256: proxySha, originalSha256: originalSha, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha}`,
			sha256: timingSha, sourceSha256: proxySha, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	const manifest = attached.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
	attached.featureRequirements = {
		schemaVersion: 2,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return attached as ReturnType<typeof createFramescaperProjectV18>;
}

test('selected runtime derives exact storage and lock profiles without callback overrides', async () => {
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE);
	const store = runtime.createProjectStore({ indexedDB: null, preferOpfs: false }) as {
		databaseName: string;
		close(): Promise<void>;
	};
	assert.equal(store.databaseName, editorProjectStorageProfileNames(runtime.storageProfile).databaseName);
	await store.close();

	assert.throws(
		() => runtime.acquireProjectLock('project-v18', { navigator: {} }),
		/environment|callback authority override/iu,
	);
});

test('selected runtime exposes no store, desktop, repository, schema, or session authority override', () => {
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE);
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
			/authority override|selected V18 store/iu,
		);
		assert.equal(reads, 0);
	}
	assert.throws(
		() => (runtime.createSessionController as (options: unknown) => unknown)({
			currentSchemaVersion: 17,
		}),
		/session options|does not accept/iu,
	);
	assert.throws(
		() => runtime.acquireProjectLock('project-v18', {
			projectStorageProfile: runtime.storageProfile,
		}),
		/lock profile.*internal|authority override/iu,
	);
});
