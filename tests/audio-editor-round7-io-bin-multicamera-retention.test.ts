/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { planFramescaperMulticameraCommandSequence, validateFramescaperMulticameraGroupsSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperMulticameraMenuItems, type FramescaperMulticameraMenuCommand } from '../src/common/editor/ui/framescaper-multicamera-menu.ts';

for (const grouped of [true, false]) for (const operation of ['remove', 'replace'] as const) {
	test(`${operation} an inactive camera bin entry retains only its existing group ownership (${String(grouped)})`, () => {
		let project = createFramescaperProject(PROFILE, { id: 'programme', sampleRate: 48_000,
			sources: ['camera-a', 'camera-b'].map((id, index) => createVideoSource({ id,
				name: `${id}.mp4`, storageKey: `media/${id}.mp4`, mimeType: 'video/mp4', contentSha256: (index ? '34' : '12').repeat(32),
				sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180,
			})),
			clips: ['a', 'b'].map(id => ({ kind: 'video', id, title: `Camera ${id}`, sourceId: `camera-${id}`, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 })),
			tracks: ['a', 'b'].map(id => ({ type: 'video', id: `picture-${id}`, name: `Picture ${id}`, clipIds: [id] })),
			sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, trackIds: ['picture-a', 'picture-b'] }], primarySequenceId: 'main',
			selection: { startFrame: 0, endFrame: 48_000, clipIds: ['a'] },
		});
		if (grouped) {
			let captured: FramescaperMulticameraMenuCommand | null = null;
			const menu = createFramescaperMulticameraMenuItems({ productId: 'framescaper', project, editingBlocked: false,
				copy: { multicamera: 'Multicamera', createMulticamera: 'Create from video sources', switchMulticamera: 'Switch camera',
					nudgeMulticameraEarlier: 'Earlier', nudgeMulticameraLater: 'Later', removeMulticamera: 'Remove group' },
			}, { execute: command => { captured = command; } });
			assert.equal(menu?.items[0]?.disabled, false);
			menu?.items[0]?.onClick();
			assert.ok(captured);
			const plan = planFramescaperMulticameraCommandSequence(PROFILE, project, project.multicameraGroups, captured);
			assert.ok(plan);
			project = applyFramescaperProjectCommand(PROFILE, project, captured);
		}
		project = applyFramescaperProjectCommand(PROFILE, project, { type: 'project-bin/move-from-timeline', clipIds: ['b'] });
		assert.equal(project.projectBin.clips.length, 1);
		const original = project.sources.find(source => source.id === 'camera-b')!;
		if (operation === 'remove') {
			project = applyFramescaperProjectCommand(PROFILE, project, { type: 'project-bin/remove-from-project', clipId: 'b' });
			assert.equal(project.projectBin.clips.length, 0);
		} else {
			const source = createVideoSource({ ...original, id: 'camera-replacement', name: 'Replacement.mp4', storageKey: 'media/replacement.mp4', contentSha256: '56'.repeat(32) });
			project = applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
				{ type: 'source/add', source },
				{ type: 'project-bin/replace-media', clipId: 'b', replacements: [{ oldSourceId: 'camera-b', newSourceId: source.id }],
					templates: [{ ...project.projectBin.clips[0]!, id: 'replacement-bin', sourceId: source.id }], shortfallMode: 'keep-spacing' },
			] });
			assert.equal(project.projectBin.clips[0]?.sourceId, source.id);
		}
		assert.equal(project.sources.some(source => source.id === 'camera-b'), grouped);
		assert.equal(validateFramescaperProject(PROFILE, project), true);
		if (grouped) {
			const retained = project.sources.find(source => source.id === 'camera-b');
			assert.deepEqual(retained, original);
			assert.notStrictEqual(retained, original);
			const group = validateFramescaperMulticameraGroupsSequence(PROFILE, project, project.multicameraGroups)[0]!;
			const plan = planFramescaperMulticameraCommandSequence(PROFILE, project, project.multicameraGroups, {
				type: 'multicamera/switch', projectId: project.id, expectedProjectRevision: project.revision,
				groupId: group.id, expectedActiveMemberId: group.activeMemberId, memberId: group.members[1]!.id,
			});
			assert.equal(plan?.after[0]?.activeMemberId, group.members[1]!.id);
		}
	});
}
