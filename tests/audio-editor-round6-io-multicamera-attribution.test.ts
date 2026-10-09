/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { planFramescaperMulticameraCommandSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createImportedSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createProjectAttributionReport } from '../src/common/editor/project-attribution-report.ts';

for (const mode of ['ordinary', 'initial', 'switched'] as const) test(`attribution resolves the ${mode} ordinary camera output`, () => {
	const original = fixture(mode !== 'ordinary');
	const prior = structuredClone(original);
	const plan = mode === 'switched' ? planFramescaperMulticameraCommandSequence(PROFILE, original,
		original.multicameraGroups, { type: 'multicamera/switch', projectId: original.id,
			expectedProjectRevision: original.revision, groupId: 'group', expectedActiveMemberId: 'a', memberId: 'b' }) : null;
	const project = plan ? { ...original, multicameraGroups: plan.after } : original;
	assert.equal(validateFramescaperProject(PROFILE, project), true);
	const report = createProjectAttributionReport(project as unknown as Readonly<Record<string, unknown>>);
	const output = report.sources.find((source) => source.uses.some((use) => use.id === 'take'));
	assert.equal(output?.sourceName, mode === 'switched' ? 'camera-b.mp4' : 'camera-a.mp4');
	assert.equal(output?.contributions[0]?.origin.originalFileName, mode === 'switched' ? 'camera-b.mp4' : 'camera-a.mp4');
	assert.deepEqual(output?.uses.find((use) => use.id === 'take'), {
		kind: 'clip', id: 'take', title: 'Camera output', sequenceId: 'main', sequenceName: 'Main',
		trackId: 'picture', trackName: 'Picture', startFrame: 0, endFrame: 48_000,
	});
	assert.deepEqual(original, prior);
});

function fixture(grouped: boolean) {
	return createFramescaperProject(PROFILE, {
		id: 'programme', title: 'Programme', now: '2026-10-09T12:00:00.000Z',
		sources: ['camera-a', 'camera-b'].map((id, index) => createVideoSource({ id,
			name: `${id}.mp4`, storageKey: id, mimeType: 'video/mp4', contentSha256: (index ? '34' : '12').repeat(32),
			sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180,
			provenance: createImportedSourceProvenance({ id: `credit-${id}`, origin: {
				kind: 'local-file', originalFileName: `${id}.mp4`, mimeType: 'video/mp4', byteLength: 4096,
			} }),
		})),
		clips: [{ kind: 'video', id: 'take', title: 'Camera output', sourceId: 'camera-a', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 }],
		tracks: [{ type: 'video', id: 'picture', name: 'Picture', clipIds: ['take'] }],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, trackIds: ['picture'] }],
		primarySequenceId: 'main',
		...(grouped ? { multicameraGroups: [{ id: 'group', projectId: 'programme', sequenceId: 'main', outputClipId: 'take', activeMemberId: 'a',
			members: [{ id: 'a', groupId: 'group', sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'b', groupId: 'group', sourceId: 'camera-b', syncOffsetSamples: 0 }] }] } : {}),
	});
}
