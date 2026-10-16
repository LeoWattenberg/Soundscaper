/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperVideoRetimeFreezeCommandRetime, createFramescaperVideoRetimeReverseCommandRetime,
	createFramescaperVideoRetimeRampCommandRetime } from '../src/framescaper/editor-project-retime-retime-command.ts';
import { exportProjectEdl } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { projectBinVideoPreviewModel } from '../src/common/editor/ui/workspace/project-bin-video-preview-model.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';

for (const mode of ['continuous', 'frozen', 'reversed', 'ramped'] as const) test(`EDL discloses the time authority of an ordinary ${mode} native camera`, async () => {
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'camera.mp4', mimeType: 'video/mp4',
		contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 192, height: 144 });
	const original = createFramescaperProject(PROFILE, { id: 'retime-edl', sampleRate: 48_000, sources: [source],
		clips: [{ kind: 'video', id: 'camera-clip', title: 'Camera', sourceId: source.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'video', type: 'video', name: 'Video', clipIds: ['camera-clip'] }],
	});
	const base = { clipId: 'camera-clip', expectedRetimeMap: null };
	const command = mode === 'frozen' ? createFramescaperVideoRetimeFreezeCommandRetime({ ...base, sourceFrame: { num: 2, den: 1 } })
		: mode === 'reversed' ? createFramescaperVideoRetimeReverseCommandRetime(base)
			: mode === 'ramped' ? createFramescaperVideoRetimeRampCommandRetime({ ...base, direction: 'forward',
				startVelocity: { num: 0, den: 1 }, endVelocity: { num: 1, den: 1 }, sourceStartFrame: { num: 0, den: 1 } }) : null;
	const project = command ? applyFramescaperProjectCommand(PROFILE, original, command) : original;
	const before = structuredClone(project);
	if (mode === 'frozen') {
		const preview = projectBinVideoPreviewModel(project, project.clips[0]!, source);
		assert.equal(preview?.sourceTimeAtFrame?.(0), 2 / 30);
		assert.equal(preview?.sourceTimeAtFrame?.(47_999), 2 / 30);
	}
	const result = await exportProjectEdl({ getProject: () => project, state: {}, fileService: { saveFile: () => true } });
	assert.ok(result);
	assert.match(result.text, /00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00/u);
	const warnings = result.report.items.filter(item => item.code === 'edl.speed-change-omitted');
	assert.equal(warnings.length, command ? 1 : 0);
	const warning = warnings[0];
	if (command) {
		assert.equal(warning?.data.kind, 'video-retime');
		assert.equal(warning?.data.retimePoints, 2);
		assert.equal(warning?.disposition, 'omitted');
		assert.equal(warning?.severity, 'warning');
		assert.ok(Object.isFrozen(warning?.data));
	}
	assert.deepEqual(project, before);
});
