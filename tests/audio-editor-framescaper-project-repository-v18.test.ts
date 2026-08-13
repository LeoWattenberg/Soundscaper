/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../src/common/editor/storage/project-repository.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FramescaperProjectRepositoryV18,
} from '../src/framescaper/editor-project-repository-v18.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('repository authenticates exact V18 before observing its delegate', () => {
	let reads = 0;
	const delegate = new Proxy({}, {
		get() { reads += 1; throw new Error('delegate get'); },
		getPrototypeOf() { reads += 1; throw new Error('delegate prototype'); },
	});
	assert.throws(() => new FramescaperProjectRepositoryV18({}, delegate), /exact Framescaper V18/iu);
	assert.equal(reads, 0);
});

test('ordinary create admits all-null V18 and rejects every attached introduction', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV18(PROFILE, delegate);
	const project = baseProject('create-null');
	assert.deepEqual(await repository.createIfAbsent(project), project);
	assert.equal(delegate.created, 1);
	await assert.rejects(repository.createIfAbsent(attachedProject(baseProject('create-attached'))), /preservation plan|proxy attachment/iu);
	assert.equal(delegate.created, 1);
});

test('ordinary save and CAS reject attachment introduction or change before delegate mutation', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV18(PROFILE, delegate);
	const base = baseProject('save-firewall');
	delegate.seed(base);
	await assert.rejects(repository.save(attachedProject(nextProject(base))), /introduce|change.*proxy|preservation plan/iu);
	assert.deepEqual(await delegate.load(base.id), base);
	assert.equal(delegate.saved, 0);

	const attached = attachedProject(baseProject('cas-firewall'));
	delegate.seed(attached);
	const changed = structuredClone(attached) as unknown as Record<string, unknown>;
	const source = (changed.sources as Record<string, unknown>[])[0]!;
	const attachment = source.proxyAttachment as Record<string, unknown>;
	attachment.recipeVersion = 2;
	await assert.rejects(repository.saveIfCurrent(attached, changed as ProjectDocument), /introduce|change.*proxy|preservation plan/iu);
	assert.equal(delegate.casSaved, 0);
});

test('ordinary save preserves exact attachment bytes without promoting a new pointer', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV18(PROFILE, delegate);
	const attached = attachedProject(baseProject('preserve-identical'));
	delegate.seed(attached);
	const renamed = nextProject(attached);
	(renamed as unknown as Record<string, unknown>).title = 'Renamed without pointer change';
	assert.deepEqual(await repository.save(renamed), renamed);
	assert.equal(delegate.saved, 0);
	assert.equal(delegate.casSaved, 1);
	const next = nextProject(renamed);
	assert.deepEqual(await repository.saveIfCurrent(renamed, next), next);
	assert.equal(delegate.casSaved, 2);
});

test('read, maintenance, and deletion remain delegated without V17 reinterpretation', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV18(PROFILE, delegate);
	const future = { id: 'future', title: 'Future', schemaVersion: 19, revision: 0 };
	delegate.seed(future);
	assert.deepEqual(await repository.load('future'), future);
	assert.deepEqual(await repository.list(), [future]);
	assert.deepEqual(await repository.listRevisions('future'), [{ revision: 0, project: future }]);
	let maintained = false;
	await repository.maintainCurrentProject('future', () => { maintained = true; });
	assert.equal(maintained, true);
	assert.equal(await repository.deleteIfCurrent(future), true);
	assert.equal(await repository.load('future'), null);
});

class MemoryProjectRepository implements ProjectRepositoryPort {
	readonly values = new Map<string, ProjectDocument>();
	created = 0;
	saved = 0;
	casSaved = 0;

	seed(project: ProjectDocument): void { this.values.set(project.id, structuredClone(project)); }
	async createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		if (this.values.has(project.id)) return null;
		this.created += 1;
		this.seed(project);
		return structuredClone(project);
	}
	async save(project: ProjectDocument, maintenance?: ProjectPostCommitMaintenance): Promise<ProjectDocument> {
		this.saved += 1;
		this.seed(project);
		await maintenance?.();
		return structuredClone(project);
	}
	async saveIfCurrent(
		expected: ProjectDocument,
		project: ProjectDocument,
		maintenance?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		if (JSON.stringify(this.values.get(expected.id)) !== JSON.stringify(expected)) return null;
		this.casSaved += 1;
		this.seed(project);
		await maintenance?.();
		return structuredClone(project);
	}
	async maintainCurrentProject(_projectId: string, maintenance: ProjectPostCommitMaintenance): Promise<void> {
		await maintenance();
	}
	async load(projectId: string, _options?: ProjectLoadOptions): Promise<ProjectDocument | null> {
		return this.values.has(projectId) ? structuredClone(this.values.get(projectId)!) : null;
	}
	async list(): Promise<ProjectDocument[]> { return [...this.values.values()].map((value) => structuredClone(value)); }
	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		const project = this.values.get(projectId);
		return project ? [{ revision: Number(project.revision), project: structuredClone(project) }] : [];
	}
	async deleteIfCurrent(project: ProjectDocument): Promise<boolean> {
		if (JSON.stringify(this.values.get(project.id)) !== JSON.stringify(project)) return false;
		return this.values.delete(project.id);
	}
	async delete(projectId: string): Promise<void> { this.values.delete(projectId); }
}

function baseProject(id: string): ReturnType<typeof createFramescaperProjectV18> {
	const originalSha = '12'.repeat(32);
	return createFramescaperProjectV18(PROFILE, {
		id, title: 'V18', now: '2026-08-13T12:00:00.000Z',
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
}

function attachedProject(
	project: ReturnType<typeof createFramescaperProjectV18>,
): ReturnType<typeof createFramescaperProjectV18> {
	const originalSha = '12'.repeat(32);
	const proxySha = '34'.repeat(32);
	const timingSha = '56'.repeat(32);
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
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${timingSha}`,
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

function nextProject<Project extends ProjectDocument>(project: Project): Project {
	const next = structuredClone(project);
	(next as Record<string, unknown>).revision = Number(project.revision) + 1;
	(next as Record<string, unknown>).updatedAt = '2026-08-13T12:01:00.000Z';
	return next;
}
