/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createFramescaperTimelineImageCurrentProjectPublicationTimelineImage as createPublication } from '../src/framescaper/editor-timeline-image-current-project-publication-timeline-image.ts';
import { FramescaperTimelineImagePublicationRepositoryTimelineImage as Repository } from '../src/framescaper/editor-timeline-image-publication-timeline-image.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { createFramescaperProjectHistoryTimelineImage, executeFramescaperProjectCommandTimelineImage as execute,
	undoFramescaperProjectCommandTimelineImage as undo } from '../src/framescaper/editor-project-timeline-image-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperTimelineImagePublicationRequestTimelineImage } from '../src/framescaper/editor-image-import-coordinator-timeline-image.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

function harness(mode: 'dirty' | 'saved' | 'save-fails' | 'history-changes', publicationTime = '2026-09-05T11:02:00.000Z') {
	const base = createFramescaperProjectTimelineImage(PROFILE, framescaperV20Options());
	let history = createFramescaperProjectHistoryTimelineImage(PROFILE, base);
	history = execute(PROFILE, history, { type: 'sequence/update', sequenceId: 'main-sequence', changes: { rate: { num: 25, den: 1 } } }, { now: '2026-09-05T11:00:00.000Z' });
	history = undo(PROFILE, history, { now: '2026-09-05T11:01:00.000Z' });
	const expected = history.present;
	const memory = getMemoryDatabase(`image-history-${mode}-${publicationTime}`);
	const save = () => {
		memory.projects.set(expected.id, structuredClone(expected));
		const key = `${expected.id}:${String(expected.revision).padStart(12, '0')}`;
		memory.revisions.set(key, { key, projectId: expected.id, revision: expected.revision, project: structuredClone(expected) });
	};
	memory.projects.set(base.id, structuredClone(base));
	if (mode === 'saved') save();
	const { source, bytes } = createFramescaperBaselineImageFixture({ sourceId: 'imported-image', imageOnly: true });
	const clip = { schemaVersion: 1 as const, kind: 'image' as const, id: 'imported-clip', sourceId: source.id,
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceStartTicks: '0' };
	memory.mediaAssets.set(source.storageKey, { sourceId: source.storageKey, kind: 'timeline-image', encoding: 'framescaper-image-asset-v1',
		mimeType: source.mimeType, sha256: source.contentSha256, size: source.assetByteLength,
		committedAt: '2026-09-05T11:00:00.000Z', pendingProjectUntil: '2026-09-05T11:30:00.000Z',
		mediaContentDigestVersion: 1, mediaContentToken: 'media-content-0123456789abcdef', path: 'bodies/imported-image' });
	const repository = new Repository(PROFILE, { memory, database: async () => null });
	let publications = 0;
	let token: object = {};
	const controller = { project: expected, actions: { project: {
		flush: async () => {
			if (mode === 'save-fails') throw new Error('Ordinary project save failed.');
			if (mode === 'history-changes') token = {};
			save();
		},
		openById: () => { controller.project = history.present; },
	} } };
	const publication = createPublication({ controller, now: () => publicationTime,
		session: { captureProjectHistory: () => ({ token, history }),
			assertProjectHistoryToken: (_id, captured) => { if (captured !== token) throw new Error('History changed.'); },
			updateProjectHistory: (_id, next) => { history = next; }, markProjectSaved: () => undefined,
			getProjectHistory: () => history },
		executeCommand: (current, command, options) => execute(PROFILE, current, command, options),
		publishIfCurrent: async ({ expected: current, project }) => { publications += 1; return repository.publishIfCurrent({ expected: current, project }); },
	});
	const request: FramescaperTimelineImagePublicationRequestTimelineImage = { project: expected, source, clip,
		body: new Blob([Uint8Array.from(bytes)]), command: { type: 'batch', commands: [
			{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
			{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip,
				placement: { scope: 'timeline', trackId: 'video-track' } },
		] } };
	return { publication, request, memory, controller, publications: () => publications };
}

for (const mode of ['dirty', 'saved'] as const) test(`image publication preserves the actual ${mode} Undo revision`, async () => {
	const state = harness(mode);
	const result = await state.publication.publish(state.request);
	assert.equal(result.clips.filter(({ id }) => id === 'imported-clip').length, 1);
	assert.deepEqual(state.memory.projects.get(result.id), result);
	assert.deepEqual(state.controller.project, result);
	assert.equal(state.publications(), 1);
});

for (const mode of ['save-fails', 'history-changes'] as const) test(`image publication stops before storage if ${mode}`, async () => {
	const state = harness(mode);
	await assert.rejects(() => state.publication.publish(state.request), mode === 'save-fails' ? /save failed/u : /History changed/u);
	assert.equal(state.publications(), 0);
	assert.equal(state.controller.project.clips.filter(({ id }) => id === 'imported-clip').length, 0);
});

for (const publicationTime of ['2026-09-05T11:01:00.000Z', '2026-09-05T11:00:59.999Z']) {
	test(`image publication advances the Undo timestamp when the clock reads ${publicationTime}`, async () => {
		const state = harness('dirty', publicationTime);
		const result = await state.publication.publish(state.request);
		assert.equal(result.updatedAt, '2026-09-05T11:01:00.001Z');
		assert.equal(result.clips.filter(({ id }) => id === 'imported-clip').length, 1);
		assert.deepEqual(state.memory.projects.get(result.id), result);
		assert.deepEqual(state.controller.project, result);
	});
}
