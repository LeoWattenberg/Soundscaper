/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { duplicateProjectWithLinkedOriginals, duplicateProjectWithLinkedVideoOriginals } from '../src/common/editor/storage/project-duplication.ts';
import type { ProjectDocument } from '../src/common/editor/storage/project-repository.ts';
import { createProjectCopyDocument } from '../src/common/editor/storage/project-copy-document.ts';

for (const duplicate of [duplicateProjectWithLinkedOriginals, duplicateProjectWithLinkedVideoOriginals]) {
	for (const grouped of [false, true]) {
		test(`${duplicate.name} copies ${grouped ? 'authored multicamera ownership' : 'ordinary native camera edits'}`, async () => {
			const source = fixture(grouped);
			const original = structuredClone(source);
			const copy = await duplicate({ aliases: null, loadProject: () => source,
				listProjects: () => [source], createProjectIfAbsent: (project: ProjectDocument) => project,
			}, { sourceProjectId: source.id, copyProjectId: 'copy', timestamp: '2026-10-09T13:00:00.000Z' });
			assert.equal(copy.id, 'copy');
			assert.doesNotThrow(() => validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, copy),
				'the ordinary duplicate must reopen in its selected product runtime');
			assert.deepEqual(source, original);
			assert.strictEqual(copy.sources, source.sources);
			assert.strictEqual(copy.clips, source.clips);
		});
	}
}

test('the shared portable-copy document retains independent, valid multicamera ownership', () => {
	const source = fixture(true);
	const original = structuredClone(source);
	const copy = createProjectCopyDocument(source, { id: 'portable-copy', timestamp: '2026-10-09T13:00:00.000Z' });
	assert.doesNotThrow(() => validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, copy));
	assert.deepEqual(source, original);
	assert.notStrictEqual(copy.multicameraGroups, source.multicameraGroups);
	assert.strictEqual(copy.sources, source.sources);
	assert.strictEqual(copy.clips, source.clips);
});

function fixture(grouped: boolean) {
	const id = 'programme';
	return createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id, title: 'Programme', now: '2026-10-09T12:00:00.000Z',
		sources: ['camera-a', 'camera-b'].map((sourceId, index) => createVideoSource({ id: sourceId,
			name: sourceId, storageKey: `${sourceId}.webm`, mimeType: 'video/webm', contentSha256: (index ? '34' : '12').repeat(32),
			sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180 })),
		clips: [{ kind: 'video', id: 'take', title: 'Take', sourceId: 'camera-a', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 }],
		tracks: [{ type: 'video', id: 'picture', name: 'Picture', clipIds: ['take'] }],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, trackIds: ['picture'] }],
		primarySequenceId: 'main',
		...(grouped ? { multicameraGroups: [{ id: 'group', projectId: id, sequenceId: 'main', outputClipId: 'take', activeMemberId: 'a',
			members: [{ id: 'a', groupId: 'group', sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'b', groupId: 'group', sourceId: 'camera-b', syncOffsetSamples: 0 }] }] } : {}),
	});
}
