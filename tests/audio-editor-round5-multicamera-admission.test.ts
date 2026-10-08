/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperMulticameraMenuItems } from '../src/common/editor/ui/framescaper-multicamera-menu.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as profile } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import { planFramescaperMulticameraCommandSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const copy = { multicamera: 'Multicamera', createMulticamera: 'Create from video sources', switchMulticamera: 'Switch camera',
	nudgeMulticameraEarlier: 'Earlier', nudgeMulticameraLater: 'Later', removeMulticamera: 'Remove group' };

for (const mismatch of [false, true]) test(`multicamera menu admits only the existing one-to-one output: mismatch=${String(mismatch)}`, () => {
	const options = framescaperV20Options();
	const sources = options.sources as readonly Readonly<Record<string, unknown>>[];
	const video = sources.find(source => source.kind === 'video'); assert.ok(video);
	const clips = options.clips as readonly Readonly<Record<string, unknown>>[];
	const input = createFramescaperProjectSequence(profile, {
		...options, sources: [...sources, { ...video, id: 'other-camera', storageKey: 'other-camera', contentSha256: '34'.repeat(32) }],
		clips: clips.map(clip => clip.id === 'video-clip' && mismatch ? { ...clip, sequenceFrameCount: 12 } : clip),
		selection: { clipIds: ['video-clip'], startFrame: 0, endFrame: 48_000 },
	});
	const project = input;
	let executions = 0;
	const menu = createFramescaperMulticameraMenuItems({ productId: 'framescaper', project, editingBlocked: false, copy }, {
		execute(command) {
			executions += 1;
			assert.equal(planFramescaperMulticameraCommandSequence(profile, project, [], command).after.length, 1);
		},
	});
	assert.equal(menu?.items[0]?.disabled, mismatch);
	menu?.items[0]?.onClick();
	assert.equal(executions, mismatch ? 0 : 1);
});
