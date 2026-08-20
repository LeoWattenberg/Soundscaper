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
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	FramescaperProjectRepositoryV20,
} from '../src/framescaper/editor-project-repository-v20.ts';
import {
	createFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V20 repository authenticates its model authority before observing the delegate', () => {
	let reads = 0;
	const delegate = new Proxy({}, {
		get() { reads += 1; throw new Error('delegate get'); },
		getPrototypeOf() { reads += 1; throw new Error('delegate prototype'); },
	});
	assert.throws(() => new FramescaperProjectRepositoryV20({}, delegate), /exact Framescaper V20/iu);
	assert.equal(reads, 0);
});

test('ordinary V20 persistence keeps exact detached keyframes and proxy authority', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV20(PROFILE, delegate);
	const base = attachedProject(baseProject('persist-v20'));
	delegate.seed(base);
	const edited = nextProject(base) as unknown as Record<string, unknown>;
	edited.title = 'Keyframed edit';
	const clip = (edited.clips as Record<string, unknown>[])[0]!;
	clip.videoKeyframes = opacityKeyframes(30);
	edited.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, edited);

	const saved = await repository.save(edited as ProjectDocument) as unknown as Record<string, unknown>;
	assert.deepEqual(((saved.clips as Record<string, unknown>[])[0]!).videoKeyframes, opacityKeyframes(30));
	assert.notStrictEqual(
		((saved.clips as Record<string, unknown>[])[0]!).videoKeyframes,
		clip.videoKeyframes,
	);
	assert.deepEqual(
		((saved.sources as Record<string, unknown>[])[0]!).proxyAttachment,
		((base.sources as unknown as Record<string, unknown>[])[0]!).proxyAttachment,
	);
	assert.equal(delegate.casSaved, 1);
});

test('ordinary V20 create and save reject proxy attachment mutation before writes', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV20(PROFILE, delegate);
	await assert.rejects(
		repository.createIfAbsent(attachedProject(baseProject('attached-create'))),
		/preservation plan|proxy attachment/iu,
	);
	const attached = attachedProject(baseProject('attached-save'));
	delegate.seed(attached);
	const changed = nextProject(attached) as unknown as Record<string, unknown>;
	const source = (changed.sources as Record<string, unknown>[])[0]!;
	(source.proxyAttachment as Record<string, unknown>).recipeVersion = 2;
	await assert.rejects(repository.save(changed as ProjectDocument), /proxy attachment|preservation plan/iu);
	assert.equal(delegate.casSaved, 0);
});

test('V20 repository delegates opaque future reads without claiming them writable', async () => {
	const delegate = new MemoryProjectRepository();
	const repository = new FramescaperProjectRepositoryV20(PROFILE, delegate);
	const future = { id: 'future-v21', title: 'Future', schemaVersion: 21, revision: 0 };
	delegate.seed(future);
	assert.deepEqual(await repository.load(future.id), future);
	assert.deepEqual(await repository.list(), [future]);
	assert.deepEqual(await repository.listRevisions(future.id), [{ revision: 0, project: future }]);
});

class MemoryProjectRepository implements ProjectRepositoryPort {
	readonly values = new Map<string, ProjectDocument>();
	casSaved = 0;

	seed(project: ProjectDocument): void { this.values.set(project.id, structuredClone(project)); }
	async createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		if (this.values.has(project.id)) return null;
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
	async load(projectId: string, _options?: ProjectLoadOptions): Promise<ProjectDocument | null> {
		return this.values.has(projectId) ? structuredClone(this.values.get(projectId)!) : null;
	}
	async list(): Promise<ProjectDocument[]> { return [...this.values.values()].map((value) => structuredClone(value)); }
	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		const project = this.values.get(projectId);
		return project ? [{ revision: Number(project.revision), project: structuredClone(project) }] : [];
	}
	async delete(projectId: string): Promise<void> { this.values.delete(projectId); }
}

function baseProject(id: string): FramescaperProjectV20 {
	return createFramescaperProjectV20(PROFILE, {
		id, title: 'V20', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function attachedProject(project: FramescaperProjectV20): FramescaperProjectV20 {
	const attached = structuredClone(project) as unknown as Record<string, unknown>;
	((attached.sources as Record<string, unknown>[])[0]!).proxyAttachment = attachment();
	attached.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, attached);
	return attached as unknown as FramescaperProjectV20;
}

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${'34'.repeat(32)}`, mimeType: 'video/mp4', byteLength: 4_096,
		sha256: '34'.repeat(32), originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 30, boundaryCount: 31,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${'56'.repeat(32)}`,
			sha256: '56'.repeat(32), sourceSha256: '34'.repeat(32), byteLength: 272,
			frameCount: 30, timescale: 30, finalFrameDurationTicks: '1',
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
