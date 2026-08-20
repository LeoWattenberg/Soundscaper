/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../src/common/editor/storage/project-repository.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from '../src/framescaper/editor-project-feature-requirements-v19.ts';
import {
	FramescaperProjectRepositoryV19,
} from '../src/framescaper/editor-project-repository-v19.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;

test('V19 repository authenticates its profile before observing the delegate', () => {
	let reads = 0;
	const delegate = new Proxy({}, {
		get() { reads += 1; throw new Error('delegate get'); },
		getPrototypeOf() { reads += 1; throw new Error('delegate prototype'); },
	});
	assert.throws(() => new FramescaperProjectRepositoryV19({}, delegate), /exact Framescaper V19/iu);
	assert.equal(reads, 0);
});

test('ordinary V19 create admits unattached composition and rejects attached introduction', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV19(PROFILE, delegate);
	const project = baseProject('create-unattached');
	assert.deepEqual(await repository.createIfAbsent(project), project);
	assert.equal(delegate.created, 1);
	await assert.rejects(
		repository.createIfAbsent(attachedProject(baseProject('create-attached'))),
		/preservation plan|proxy attachment/iu,
	);
	assert.equal(delegate.created, 1);
});

test('ordinary V19 save and CAS reject proxy pointer mutation before delegate writes', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV19(PROFILE, delegate);
	const base = baseProject('save-firewall');
	delegate.seed(base);
	await assert.rejects(
		repository.save(attachedProject(nextProject(base))),
		/introduce|change.*proxy|preservation plan/iu,
	);
	assert.deepEqual(await delegate.load(base.id), base);
	assert.equal(delegate.casSaved, 0);

	const attached = attachedProject(baseProject('cas-firewall'));
	delegate.seed(attached);
	const changed = nextProject(attached) as unknown as Record<string, unknown>;
	const source = (changed.sources as Record<string, unknown>[])[0]!;
	(source.proxyAttachment as Record<string, unknown>).recipeVersion = 2;
	await assert.rejects(
		repository.saveIfCurrent(attached, changed as ProjectDocument),
		/introduce|change.*proxy|preservation plan/iu,
	);
	assert.equal(delegate.casSaved, 0);
});

test('ordinary V19 persistence preserves exact V18 attachment authority and composition bytes', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV19(PROFILE, delegate);
	const attached = attachedProject(baseProject('preserve-identical'));
	delegate.seed(attached);
	const edited = nextProject(attached) as unknown as Record<string, unknown>;
	edited.title = 'Composition edit';
	const clip = (edited.clips as Record<string, unknown>[])[0]!;
	const composition = structuredClone(clip.videoComposition) as Record<string, unknown>;
	composition.opacity = 0.5;
	clip.videoComposition = composition;
	edited.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(PROFILE, edited);

	assert.deepEqual(await repository.save(edited as ProjectDocument), edited);
	assert.equal(delegate.casSaved, 1);
	const saved = await delegate.load(attached.id) as Record<string, unknown>;
	assert.deepEqual(
		((saved.sources as Record<string, unknown>[])[0]!).proxyAttachment,
		((attached.sources as Record<string, unknown>[])[0]!).proxyAttachment,
	);
	assert.equal(
		(((saved.clips as Record<string, unknown>[])[0]!).videoComposition as Record<string, unknown>).opacity,
		0.5,
	);
});

test('V19 repository delegates opaque reads, maintenance, and deletion', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV19(PROFILE, delegate);
	const future = { id: 'future', title: 'Future', schemaVersion: 20, revision: 0 };
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
	casSaved = 0;

	seed(project: ProjectDocument): void { this.values.set(project.id, structuredClone(project)); }
	async createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		if (this.values.has(project.id)) return null;
		this.created += 1;
		this.seed(project);
		return structuredClone(project);
	}
	createForScapeImportIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		return this.createIfAbsent(project);
	}
	async save(project: ProjectDocument, maintenance?: ProjectPostCommitMaintenance): Promise<ProjectDocument> {
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

function baseProject(id: string): ReturnType<typeof createFramescaperProjectV19> {
	return createFramescaperProjectV19(PROFILE, {
		id, title: 'V19', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function attachedProject(
	project: ReturnType<typeof createFramescaperProjectV19>,
): ReturnType<typeof createFramescaperProjectV19> {
	const attached = structuredClone(project) as unknown as Record<string, unknown>;
	((attached.sources as Record<string, unknown>[])[0]!).proxyAttachment = attachment();
	attached.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(PROFILE, attached);
	return attached as ReturnType<typeof createFramescaperProjectV19>;
}

function attachment(): Record<string, unknown> {
	return {
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
}

function nextProject<Project extends ProjectDocument>(project: Project): Project {
	const next = structuredClone(project);
	(next as Record<string, unknown>).revision = Number(project.revision) + 1;
	(next as Record<string, unknown>).updatedAt = '2026-08-13T12:01:00.000Z';
	return next;
}
