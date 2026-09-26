/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../src/common/editor/storage/project-repository.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import {
	reconcileFramescaperProjectFeatureRequirements,
} from '../src/framescaper/editor-project-feature-requirements.ts';
import { FramescaperProjectRepository } from '../src/framescaper/editor-project-repository.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import {
	cloneFramescaperProject,
	createFramescaperProject,
	type FramescaperProject,
} from '../src/framescaper/editor-project.ts';
import { createFramescaperBaselineImageFixture } from
	'./helpers/framescaper-baseline-image-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

type ProjectSnapshot = Readonly<{
	readonly current: ProjectDocument | null;
	readonly revisions: readonly ProjectRevision[];
}>;

const PROFILE = FRAMESCAPER_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-09-27T10:00:00.000Z';

test('ordinary create and save refuse new timeline-image and proxy bodies', async () => {
	const base = project();
	const imageProject = createFramescaperBaselineImageFixture().project;
	const proxyProject = withProxyAttachment(base);
	const delegate = new FakeProjectRepository([base]);
	const repository = new FramescaperProjectRepository(PROFILE, delegate);

	await assert.rejects(
		repository.createIfAbsent(imageProject),
		/timeline-image Framescaper create requires atomic timeline-image publication/iu,
	);
	await assert.rejects(
		repository.createIfAbsent(proxyProject),
		/proxy-attached Framescaper create requires atomic preservation publication/iu,
	);
	await assert.rejects(
		repository.save(imageProject),
		/new Framescaper image body requires atomic timeline-image publication/iu,
	);
	await assert.rejects(
		repository.save(proxyProject),
		/ordinary Framescaper save cannot introduce or change a proxy attachment/iu,
	);

	assert.deepEqual(delegate.created, []);
	assert.deepEqual(delegate.compareAndSwaps, []);
});

test('ordinary metadata save compares against the exact stored revision', async () => {
	const base = project();
	const renamed = applyFramescaperProjectCommand(
		PROFILE,
		base,
		{ type: 'project/rename', title: 'Renamed project' },
		{ now: '2026-09-27T10:00:01.000Z' },
	);
	const delegate = new FakeProjectRepository([base]);
	const repository = new FramescaperProjectRepository(PROFILE, delegate);
	let maintained = 0;

	const saved = await repository.save(renamed, async () => { maintained += 1; });

	assert.deepEqual(saved, renamed);
	assert.equal(delegate.ordinarySaveCalls, 0);
	assert.equal(delegate.compareAndSwaps.length, 1);
	assert.deepEqual(delegate.compareAndSwaps[0]?.expected, base);
	assert.deepEqual(delegate.compareAndSwaps[0]?.project, renamed);
	assert.equal(delegate.compareAndSwaps[0]?.expected.revision, base.revision);
	assert.equal(delegate.compareAndSwaps[0]?.project.revision, Number(base.revision) + 1);
	assert.equal(maintained, 1);
});

test('read and restore custody preserves foreign and future records without conversion', async () => {
	const projectId = 'opaque-project';
	const foreign = opaqueProject({
		id: projectId,
		revision: 4,
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		opaqueForeignState: Object.freeze({ routing: 'unknown' }),
	});
	const future = opaqueProject({
		id: projectId,
		revision: 5,
		schemaFamily: 'framescaper',
		schemaVersion: 2,
		opaqueFutureState: Object.freeze({ picture: 'unknown' }),
	});
	const delegate = new FakeProjectRepository([future]);
	delegate.listed = [foreign, future];
	delegate.revisions = [
		{ revision: foreign.revision as number, project: foreign },
		{ revision: future.revision as number, project: future },
	];
	const repository = new FramescaperProjectRepository(PROFILE, delegate);

	assert.equal(await repository.load(projectId), future);
	const listed = await repository.list();
	assert.equal(listed[0], foreign);
	assert.equal(listed[1], future);
	const revisions = await repository.listRevisions(projectId);
	assert.equal(revisions[0]?.project, foreign);
	assert.equal(revisions[1]?.project, future);

	const snapshot = Object.freeze({
		current: future,
		revisions: Object.freeze([
			Object.freeze({ revision: 4, project: foreign }),
			Object.freeze({ revision: 5, project: future }),
		]),
	});
	await repository.restore(projectId, snapshot);
	assert.equal(delegate.restored?.snapshot.current, future);
	assert.equal(delegate.restored?.snapshot.revisions[0]?.project, foreign);
	assert.equal(delegate.restored?.snapshot.revisions[1]?.project, future);

	const expected = project(projectId);
	assert.equal(
		await repository.restoreIfCurrentAndFenced(projectId, expected, snapshot, 'write-fence'),
		true,
	);
	assert.equal(delegate.fencedRestore?.snapshot.current, future);
	assert.equal(delegate.fencedRestore?.snapshot.revisions[0]?.project, foreign);
	assert.equal(delegate.fencedRestore?.snapshot.revisions[1]?.project, future);
});

class FakeProjectRepository implements ProjectRepositoryPort {
	readonly current = new Map<string, ProjectDocument>();
	readonly created: ProjectDocument[] = [];
	readonly compareAndSwaps: Array<Readonly<{
		expected: ProjectDocument;
		project: ProjectDocument;
	}>> = [];
	ordinarySaveCalls = 0;
	listed: ProjectDocument[] = [];
	revisions: ProjectRevision[] = [];
	restored: Readonly<{ projectId: string; snapshot: ProjectSnapshot }> | null = null;
	fencedRestore: Readonly<{
		projectId: string;
		expected: ProjectDocument;
		snapshot: ProjectSnapshot;
		writeFence: string;
	}> | null = null;

	constructor(projects: readonly ProjectDocument[] = []) {
		for (const value of projects) this.current.set(value.id, value);
	}

	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		this.created.push(project);
		return Promise.resolve(project);
	}

	createForScapeImportIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		this.created.push(project);
		return Promise.resolve(project);
	}

	save(project: ProjectDocument): Promise<ProjectDocument> {
		this.ordinarySaveCalls += 1;
		return Promise.resolve(project);
	}

	async saveIfCurrent(
		expected: ProjectDocument,
		project: ProjectDocument,
		maintenance?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		this.compareAndSwaps.push({ expected, project });
		if (!this.current.has(expected.id)) return null;
		this.current.set(project.id, project);
		await maintenance?.();
		return project;
	}

	claimWriteFence(): Promise<string> {
		return Promise.resolve('write-fence');
	}

	saveIfCurrentAndFenced(
		_expected: ProjectDocument,
		project: ProjectDocument,
		_writeFence: string,
	): Promise<ProjectDocument | null> {
		return Promise.resolve(project);
	}

	load(projectId: string, _options?: ProjectLoadOptions): Promise<ProjectDocument | null> {
		return Promise.resolve(this.current.get(projectId) ?? null);
	}

	list(): Promise<ProjectDocument[]> {
		return Promise.resolve(this.listed);
	}

	listRevisions(): Promise<ProjectRevision[]> {
		return Promise.resolve(this.revisions);
	}

	restore(projectId: string, snapshot: ProjectSnapshot): Promise<void> {
		this.restored = { projectId, snapshot };
		return Promise.resolve();
	}

	restoreIfCurrentAndFenced(
		projectId: string,
		expected: ProjectDocument,
		snapshot: ProjectSnapshot,
		writeFence: string,
	): Promise<boolean> {
		this.fencedRestore = { projectId, expected, snapshot, writeFence };
		return Promise.resolve(true);
	}

	delete(): Promise<void> {
		return Promise.resolve();
	}
}

function project(id = 'framescaper-baseline'): FramescaperProject {
	return createFramescaperProject(PROFILE, {
		...framescaperBaselineOptions(),
		id,
		title: 'Repository contract',
		now: NOW,
	} as never);
}

function withProxyAttachment(base: FramescaperProject): FramescaperProject {
	const draft = structuredClone(base) as unknown as Record<string, unknown>;
	const source = (draft.sources as Array<Record<string, unknown>>)
		.find(({ id }) => id === 'video-source');
	if (!source) throw new Error('The repository contract fixture requires a video source.');
	const proxySha256 = '34'.repeat(32);
	const timingSha256 = '56'.repeat(32);
	source.proxyAttachment = {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha256}`,
		mimeType: 'video/mp4',
		byteLength: 1_024,
		sha256: proxySha256,
		originalSha256: source.contentSha256,
		originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg',
		generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1',
		recipeVersion: 1,
		timingBackendId: 'ffprobe',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: source.sourceFrameCount,
		boundaryCount: Number(source.sourceFrameCount) + 1,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256,
			sourceSha256: proxySha256,
			byteLength: 112,
			frameCount: source.sourceFrameCount,
			timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	draft.revision = Number(base.revision) + 1;
	draft.updatedAt = '2026-09-27T10:00:01.000Z';
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirements(PROFILE, draft);
	return cloneFramescaperProject(PROFILE, draft);
}

function opaqueProject(value: Readonly<Record<string, unknown>>): ProjectDocument {
	return Object.freeze(value) as ProjectDocument;
}
