/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperVideoRetimeFreezeCommandRetime, createFramescaperVideoRetimeReverseCommandRetime,
	createFramescaperVideoRetimeRampCommandRetime, type FramescaperVideoRetimeCommandRetime } from '../src/framescaper/editor-project-retime-retime-command.ts';
import { createVideoClip, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { projectBinVideoPreviewModel } from '../src/common/editor/ui/workspace/project-bin-video-preview-model.ts';
import { framescaperModelOptions } from './helpers/framescaper-model-fixture-common.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { conformFramescaperVideoRetimeReplacementSnapshots } from '../src/framescaper/editor-project-retime-retime-replacement.ts';

for (const frozen of [false, true]) for (const mode of ['keep-spacing', 'contract-gaps'] as const) {
	test(`ordinary ${frozen ? 'frozen' : 'continuous'} video survives a shorter replacement with ${mode}`, () => {
		const { project, replaced, source } = replace(mode, frozen ? createFramescaperVideoRetimeFreezeCommandRetime({
			clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: { num: 2, den: 1 },
		}) : null);
		const video = replaced.clips.find(clip => clip.id === 'video-clip')!;
		assert.equal(video.sourceId, source.id);
		assert.equal(video.sourceFrameCount, 4);
		assert.equal(video.sequenceFrameCount, 3);
		assert.equal(project.clips.find(clip => clip.id === 'video-clip')!.sourceId, 'video-source');
		if (frozen) {
			const preview = projectBinVideoPreviewModel(replaced, video, replaced.sources.find(candidate => candidate.id === source.id)!);
			assert.equal(preview?.sourceTimeAtFrame?.(0), 0.2);
			assert.equal(preview?.sourceTimeAtFrame?.(14_399), 0.2);
		} else assert.equal(video.retimeMap, null);
	});
}

for (const curve of ['reverse', 'ramp', 'bin-freeze'] as const) test(`ordinary replacement retains ${curve} curve authority`, () => {
	const base = { clipId: curve === 'bin-freeze' ? 'bin-video' : 'video-clip', expectedRetimeMap: null };
	const command = curve === 'reverse' ? createFramescaperVideoRetimeReverseCommandRetime(base)
		: curve === 'ramp' ? createFramescaperVideoRetimeRampCommandRetime({ ...base, direction: 'forward',
			sourceStartFrame: { num: 0, den: 1 }, startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 } })
			: createFramescaperVideoRetimeFreezeCommandRetime({ ...base, scope: 'project-bin', sourceFrame: { num: 2, den: 1 } });
	const { replaced, source } = replace('keep-spacing', command);
	const video = curve === 'bin-freeze' ? replaced.projectBin.clips[0]! : replaced.clips.find(clip => clip.id === 'video-clip')!;
	const preview = projectBinVideoPreviewModel(replaced, video, replaced.sources.find(candidate => candidate.id === source.id)!);
	assert.ok(preview?.sourceTimeAtFrame);
	assert.equal(preview.sourceTimeAtFrame(0), curve === 'ramp' ? 0 : 0.2);
	assert.equal(preview.sourceTimeAtFrame(14_399), curve === 'bin-freeze' ? 0.2 : 1 / 15);
});

function replace(mode: 'keep-spacing' | 'contract-gaps', command: FramescaperVideoRetimeCommandRetime | null) {
	let project = createFramescaperProject(PROFILE, framescaperModelOptions({ id: 'bin-replace', title: 'Bin replace', now: '2026-10-10T00:00:00Z' }));
	if (command) project = applyFramescaperProjectCommand(PROFILE, project, command);
	const source = createVideoSource({ id: 'replacement', name: 'Short camera', storageKey: 'replacement',
		contentSha256: '34'.repeat(32), sampleFrameCount: 12_800, sourceFrameCount: 4, frameRate: { num: 15, den: 1 }, width: 96, height: 54 });
	const template = createVideoClip({ id: 'template', sourceId: source.id, title: 'Short camera', binItemId: 'replacement',
		sequenceStartFrame: 0, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 4 },
	{ projectSampleRate: project.sampleRate, sequence: project.sequences[0]!, source });
	const replaced = applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
		{ type: 'source/add', source },
		{ type: 'project-bin/replace-media', clipId: 'bin-video', replacements: [{ oldSourceId: 'video-source', newSourceId: source.id }],
			templates: [template], shortfallMode: mode },
	] });
	return { project, replaced, source };
}

test('replacement carries an authored freeze through the authenticated irregular source presentation clocks', () => {
	const oldPublication = createVideoTimingAssetPublication('12'.repeat(32), { timescale: 1_000,
		presentationTicks: [0n, 100n, 195n, 300n, 400n, 500n, 600n, 700n, 800n, 900n], finalFrameDurationTicks: 100n });
	const newPublication = createVideoTimingAssetPublication('34'.repeat(32), { timescale: 1_000,
		presentationTicks: [0n, 40n, 130n, 200n], finalFrameDurationTicks: 70n });
	const oldSource = { id: 'old', contentSha256: '12'.repeat(32), timingAsset: oldPublication.reference };
	const newSource = { id: 'new', contentSha256: '34'.repeat(32), timingAsset: newPublication.reference };
	registerVideoTimingIndex(oldSource, validateVideoTimingAssetBytes(oldPublication.reference, oldPublication.bytes));
	registerVideoTimingIndex(newSource, validateVideoTimingAssetBytes(newPublication.reference, newPublication.bytes));
	try {
		const retimeMap = { feature: 'video-retime' as const, version: 2 as const,
			points: [{ outerFrame: 0, sourceFrame: { num: 2, den: 1 } }, { outerFrame: 30, sourceFrame: { num: 2, den: 1 } }],
			segments: [{ mode: 'freeze' as const }] };
		const before = { sources: [oldSource], clips: [{ id: 'clip', sourceId: 'old', sequenceFrameCount: 30 }], projectBin: { clips: [] } };
		const commanded = { sources: [newSource], clips: [{ id: 'clip', sourceId: 'new', sequenceFrameCount: 8, sourceInFrame: 0, sourceFrameCount: 4 }], projectBin: { clips: [] } };
		const command = { type: 'project-bin/replace-media', replacements: [{ oldSourceId: 'old', newSourceId: 'new' }] };
		const [snapshot] = conformFramescaperVideoRetimeReplacementSnapshots(before, commanded, command, [{ id: 'clip', retimeMap }]);
		assert.deepEqual(snapshot?.retimeMap.points, [{ outerFrame: 0, sourceFrame: { num: 41, den: 14 } }, { outerFrame: 8, sourceFrame: { num: 41, den: 14 } }]);
		assert.deepEqual(retimeMap.points.at(-1), { outerFrame: 30, sourceFrame: { num: 2, den: 1 } });
		assert.equal(conformFramescaperVideoRetimeReplacementSnapshots(before, commanded, { type: 'project/rename' }, [snapshot!])[0], snapshot);
	} finally { unregisterVideoTimingIndex(oldSource); unregisterVideoTimingIndex(newSource); }
});
