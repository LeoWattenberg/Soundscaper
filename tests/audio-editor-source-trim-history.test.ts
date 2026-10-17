/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createClipSourcePreviewService } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import type { ClipSourcePreviewProject } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-project.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipSourceTrim } from '../src/common/editor/ui/inspector/clip-source-view.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, redoSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

function fixture(sourceRate: number, reversed: boolean, repeated = false, warped = false) {
	const sampleRate = 48_000;
	const clip = { id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', timelineStartFrame: sampleRate,
		durationFrames: sampleRate, sourceStartFrame: 0, sourceDurationFrames: sourceRate, reversed,
		opaqueExtensions: { 'example.extension': { kept: true } } };
	const project = createSoundscaperProject({ id: 'source-trim-history', sampleRate,
		sources: [createAudioSource({ id: 'source', sampleRate: sourceRate, frameCount: sourceRate, channelCount: 1, storageKey: 'source' })],
		clips: [createAudioClip({ ...clip, ...(repeated ? clipLoopUpdateFields(clip, { periodFrames: sampleRate, durationFrames: sampleRate * 3 }) : {}),
			...(warped ? { warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 12_000, source: sourceRate / 2, mode: 'forward' },
				{ outer: sampleRate, source: sourceRate, mode: 'forward' },
			] } } : {}),
		})],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const source = project.sources[0];
	assert.ok(source?.kind === 'audio');
	let history = createSoundscaperProjectHistory(project);
	const lifetime = new EditorControllerLifetime();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const commit = (command: Parameters<typeof executeSoundscaperProjectCommand>[1]) => {
		history = executeSoundscaperProjectCommand(history, command);
		return history.present;
	};
	const timeline = createClipTransformService({ lifetime, copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Invalid frame' },
		getProject: () => resolveRuntimeProjectProjection(history.present) as unknown as ClipTransformProject,
		getSelectedClipId: () => 'clip', editingBlocked: () => false, createId: prefix => `${prefix}-new`,
		snapTimelineFrame: frame => Number(frame), activeSelection: () => null, commit,
	});
	const preview = createClipSourcePreviewService({ lifetime,
		getProject: () => resolveRuntimeProjectProjection(history.present) as unknown as ClipSourcePreviewProject,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		handleError: error => { throw error; }, commit,
	});
	return { timeline, preview, history: () => history,
		undo: () => { history = undoSoundscaperProjectCommand(history); },
		redo: () => { history = redoSoundscaperProjectCommand(history); },
		clip: () => {
			const clip = resolveRuntimeProjectProjection(history.present).clips[0];
			assert.ok(clip?.kind === 'audio');
			return clip;
		}, source,
	};
}

test('source editing after a warped timeline trim retains the source marker and native Undo', async context => {
	const editor = fixture(24_000, false, false, true);
	context.after(async () => { await editor.preview.dispose(); });
	editor.timeline.trimClips('clip', { timelineStartFrame: 57_600 });
	editor.timeline.trimClips('clip', { durationFrames: 28_800 });
	const before = editor.history();
	const clip = editor.clip();
	editor.preview.trim('clip', clipSourceTrim(clip, editor.source, 48_000, 'end', 24_000, before.present));
	const updated = editor.clip();
	assert.equal(updated.timelineStartFrame, clip.timelineStartFrame);
	assert.equal(updated.sourceStartFrame + updated.sourceDurationFrames, 24_000);
	assert.ok(normalizeAudioWarpMap(updated.warpMap).points.some(point => point.source.num === 12_000 && point.source.den === 1));
	assert.equal(updated.trimEndFrames, 0);
	assert.equal(validateSoundscaperProject(editor.history().present), true);
	editor.undo();
	assert.deepEqual(editor.history().present.clips, before.present.clips);
});

for (const reversed of [false, true]) test(`source extension restores a timeline-trimmed loop period (${reversed ? 'reversed' : 'forward'})`, async context => {
	const editor = fixture(24_000, reversed, true);
	context.after(async () => { await editor.preview.dispose(); });
	editor.timeline.trimClips('clip', { durationFrames: 134_400 });
	const before = editor.history();
	const clip = editor.clip();
	assert.equal(clip.durationFrames, 144_000, 'timeline loop trim retains the repeated extent');
	assert.deepEqual(readClipLoop(clip), { periodFrames: 38_400, offsetFrames: 0 });
	const edge = reversed ? 'start' : 'end';
	editor.preview.trim('clip', clipSourceTrim(clip, editor.source, 48_000, edge, reversed ? 0 : 24_000));
	const updated = editor.clip();
	assert.deepEqual([updated.sourceStartFrame, updated.sourceDurationFrames, updated.trimStartFrames, updated.trimEndFrames], [0, 24_000, 0, 0]);
	assert.deepEqual(readClipLoop(updated), { periodFrames: 48_000, offsetFrames: 0 });
	assert.equal(updated.durationFrames, 144_000);
	assert.equal(updated.timelineStartFrame, clip.timelineStartFrame);
	assert.equal(validateSoundscaperProject(editor.history().present), true);
	assert.equal(editor.history().undoStack.length, before.undoStack.length + 1);
	editor.undo();
	assert.deepEqual(editor.history().present.clips, before.present.clips);
});

for (const sourceRate of [24_000, 48_000]) for (const reversed of [false, true]) for (const edge of ['start', 'end'] as const) {
	test(`timeline trim then source ${edge} extension keeps native trim history (${sourceRate} Hz, ${reversed ? 'reversed' : 'forward'})`, async context => {
		const editor = fixture(sourceRate, reversed);
		context.after(async () => { await editor.preview.dispose(); });
		editor.timeline.trimClips('clip', { timelineStartFrame: 57_600 });
		editor.timeline.trimClips('clip', { durationFrames: 28_800 });
		const trimmed = editor.history();
		const clip = editor.clip();
		assert.deepEqual([clip.sourceStartFrame, clip.sourceDurationFrames, clip.trimStartFrames, clip.trimEndFrames],
			[sourceRate / 5, sourceRate * 3 / 5, sourceRate / 5, sourceRate / 5]);
		const fields = clipSourceTrim(clip, editor.source, 48_000, edge, edge === 'start' ? 0 : sourceRate);
		editor.preview.trim('clip', fields);
		const extended = editor.history();
		const updated = editor.clip();
		assert.equal(updated.timelineStartFrame, clip.timelineStartFrame, 'source edits preserve project placement');
		assert.equal(updated.durationFrames, 38_400, 'duration retains the source/project clock ratio');
		assert.deepEqual([updated.trimStartFrames, updated.trimEndFrames],
			edge === 'start' ? [0, sourceRate / 5] : [sourceRate / 5, 0]);
		assert.equal(updated.reversed, reversed);
		assert.deepEqual(updated.opaqueExtensions, clip.opaqueExtensions);
		assert.equal(validateSoundscaperProject(extended.present), true);
		assert.equal(extended.undoStack.length, trimmed.undoStack.length + 1);
		editor.undo();
		assert.deepEqual(editor.history().present.clips, trimmed.present.clips);
		editor.redo();
		assert.deepEqual(editor.history().present.clips, extended.present.clips);
		const inner = clipSourceTrim(updated, editor.source, 48_000, edge, edge === 'start' ? sourceRate / 10 : sourceRate * 9 / 10);
		editor.preview.trim('clip', inner);
		assert.deepEqual([editor.clip().trimStartFrames, editor.clip().trimEndFrames],
			edge === 'start' ? [sourceRate / 10, sourceRate / 5] : [sourceRate / 5, sourceRate / 10]);
	});
}
