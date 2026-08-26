/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ProjectDocument,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../src/common/editor/storage/project-repository.ts';
import { FramescaperProjectRepositoryV32 } from '../src/framescaper/editor-project-repository-v32.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { addFramescaperV32BoundaryImage } from './helpers/framescaper-v32-boundary-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

/** A delegate that keeps every saved document as a revision, like the real store. */
function revisioningDelegate(initial: ProjectDocument) {
	let current = structuredClone(initial);
	const revisions: ProjectRevision[] = [{ revision: Number(initial.revision), project: structuredClone(initial) }];
	const port: ProjectRepositoryPort = {
		async createIfAbsent(project) { current = structuredClone(project); return structuredClone(project); },
		async createForScapeImportIfAbsent(project) {
			current = structuredClone(project);
			return structuredClone(project);
		},
		async save(project) {
			current = structuredClone(project);
			revisions.push({ revision: Number(project.revision), project: structuredClone(project) });
			return structuredClone(project);
		},
		async saveIfCurrent(expected, project) {
			if (JSON.stringify(current) !== JSON.stringify(expected)) return null;
			current = structuredClone(project);
			revisions.push({ revision: Number(project.revision), project: structuredClone(project) });
			return structuredClone(project);
		},
		async load() { return structuredClone(current); },
		async list() { return [structuredClone(current)]; },
		async listRevisions() { return revisions.map((entry) => structuredClone(entry)); },
		async delete() { /* no-op test delegate */ },
	};
	return { port };
}

function bumped(project: object, revision: number, updatedAt: string): ProjectDocument {
	const next = structuredClone(project) as unknown as Record<string, unknown>;
	next.revision = revision;
	next.updatedAt = updatedAt;
	return next as ProjectDocument;
}

/**
 * An image body is published atomically with the revision that introduces it.
 * Undo drops the source and autosaves that, so redo re-references a body that is
 * still committed in the store — not a new attachment. Refusing it wedges every
 * later autosave with the save state stuck dirty.
 */
test('redo after undoing an image import saves against the already published body', async () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const withImage = addFramescaperV32BoundaryImage(base).project;
	// The publication itself installed the image revision as the stored document.
	const delegate = revisioningDelegate(withImage as unknown as ProjectDocument);
	const repository = new FramescaperProjectRepositoryV32(PROFILE, delegate.port);

	const undone = bumped(base, Number(withImage.revision) + 1, '2026-08-25T12:01:00.000Z');
	assert.ok(
		await repository.saveIfCurrent(withImage as unknown as ProjectDocument, undone),
		'undoing the import removes the image source and saves',
	);

	const redone = bumped(withImage, Number(undone.revision) + 1, '2026-08-25T12:02:00.000Z');
	const saved = await repository.saveIfCurrent(undone, redone);
	assert.ok(saved, 'redo re-references the published body and saves');
	assert.equal(
		(saved.sources as readonly { kind: string }[]).filter(({ kind }) => kind === 'image').length,
		1,
	);
});

test('an image body this project never published is still refused', async () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const delegate = revisioningDelegate(base as unknown as ProjectDocument);
	const repository = new FramescaperProjectRepositoryV32(PROFILE, delegate.port);
	const withImage = addFramescaperV32BoundaryImage(base).project;

	await assert.rejects(
		repository.saveIfCurrent(
			base as unknown as ProjectDocument,
			bumped(withImage, Number(withImage.revision) + 1, '2026-08-25T12:01:00.000Z'),
		),
		/atomic timeline-image publication/iu,
	);
});
