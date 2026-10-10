/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperVideoRetimeFreezeCommandRetime, createFramescaperVideoRetimeReverseCommandRetime,
	createFramescaperVideoRetimeRampCommandRetime, type FramescaperVideoRetimeCommandRetime,
	resolveFramescaperVideoRetimeMapRetime,
} from '../src/framescaper/editor-project-retime-retime-command.ts';
import { projectBinVideoPreviewModel } from '../src/common/editor/ui/workspace/project-bin-video-preview-model.ts';
import { createProjectBinRetimePlayback, type ProjectBinRetimeMedia } from '../src/common/editor/controller/import/project-bin-video-playback.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { framescaperModelOptions } from './helpers/framescaper-model-fixture-common.ts';

test('normal frozen video retains its authored source picture after moving to Project bin', () => {
	let project = createFramescaperProject(PROFILE, framescaperModelOptions({ id: 'bin-freeze', title: 'Bin freeze', now: '2026-10-10T00:00:00Z' }));
	const source = project.sources.find(candidate => candidate.id === 'video-source')!;
	const normal = projectBinVideoPreviewModel(project, project.projectBin.clips[0]!, source);
	assert.equal(normal?.startSeconds, 0);
	assert.equal(normal?.endSeconds, 1);
	assert.equal(normal?.playbackRate, 1);
	project = applyFramescaperProjectCommand(PROFILE, project, createFramescaperVideoRetimeFreezeCommandRetime({
		clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: { num: 2, den: 1 },
	}));
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'project-bin/move-from-timeline', clipIds: ['video-clip'] });
	const clip = project.projectBin.clips.find(candidate => candidate.id === 'video-clip')!;
	assert.ok(clip.retimeMap, 'the ordinary move preserves the authored retime curve');
	const preview = projectBinVideoPreviewModel(project, clip, source);
	assert.equal(preview?.startSeconds, 0.2);
	assert.equal(preview?.sourceTimeAtFrame?.(47_999), 0.2);
});

function retimedPreview(command: FramescaperVideoRetimeCommandRetime) {
	let project = createFramescaperProject(PROFILE, framescaperModelOptions({ id: 'bin-curves', title: 'Bin curves', now: '2026-10-10T00:00:00Z' }));
	project = applyFramescaperProjectCommand(PROFILE, project, command);
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'project-bin/move-from-timeline', clipIds: ['video-clip'] });
	const preview = projectBinVideoPreviewModel(project, project.projectBin.clips.find(clip => clip.id === 'video-clip')!, project.sources.find(source => source.id === 'video-source')!);
	assert.ok(preview?.sourceTimeAtFrame);
	return preview as typeof preview & { readonly sourceTimeAtFrame: (frame: number) => number };
}

test('normal moved reverse and ramp curves retain drawable source frame ownership', () => {
	const reverse = retimedPreview(createFramescaperVideoRetimeReverseCommandRetime({ clipId: 'video-clip', expectedRetimeMap: null }));
	assert.equal(reverse.sourceTimeAtFrame(0), 0.9);
	assert.equal(reverse.sourceTimeAtFrame(4_800), 0.8);
	assert.equal(reverse.sourceTimeAtFrame(47_999), 0);
	const ramp = retimedPreview(createFramescaperVideoRetimeRampCommandRetime({ clipId: 'video-clip', expectedRetimeMap: null,
		direction: 'forward', sourceStartFrame: { num: 0, den: 1 }, startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 } }));
	assert.equal(ramp.sourceTimeAtFrame(0), 0);
	assert.equal(ramp.sourceTimeAtFrame(24_000), 0.2);
	assert.equal(ramp.sourceTimeAtFrame(47_999), 0.8);
});

test('a retimed bin occurrence uses its rounded absolute sequence origin', () => {
	const options = framescaperModelOptions({ id: 'bin-grid', title: 'Bin grid', now: '2026-10-10T00:00:00Z' });
	options.sequences = [{ id: 'main-sequence', rate: { num: 30_000, den: 1_001 }, trackIds: ['video-track', 'audio-track'] }];
	options.projectBin = { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source', title: 'Bin video',
		sequenceId: 'main-sequence', sequenceStartFrame: 1, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null, binItemId: 'bin-video' }] };
	const project = applyFramescaperProjectCommand(PROFILE, createFramescaperProject(PROFILE, options),
		createFramescaperVideoRetimeReverseCommandRetime({ scope: 'project-bin', clipId: 'bin-video', expectedRetimeMap: null }));
	const preview = projectBinVideoPreviewModel(project, project.projectBin.clips[0]!, project.sources.find(source => source.id === 'video-source')!);
	assert.equal(preview?.sourceTimeAtFrame?.(1_600), 0.9);
	assert.equal(preview?.sourceTimeAtFrame?.(1_601), 0.8);
});

test('an exact retimed bin picture waits for and follows its verified irregular source clock', () => {
	const publication = createVideoTimingAssetPublication('8'.repeat(64), {
		timescale: 1_000, presentationTicks: [0n, 100n, 300n, 700n], finalFrameDurationTicks: 100n,
	});
	const project = { schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000,
		primarySequenceId: 'sequence', sequences: [{ id: 'sequence', rate: { num: 10, den: 1 } }] };
	const source = { id: 'source', kind: 'video', frameRate: { num: 5, den: 1 }, sourceFrameCount: 4,
		contentSha256: '8'.repeat(64), timingAsset: publication.reference, timingDecision: { mode: 'exact', rate: { num: 5, den: 1 } } };
	const clip = { id: 'video', kind: 'video', sourceId: 'source', sequenceId: 'sequence', sequenceStartFrame: 0,
		sequenceFrameCount: 8, sourceInFrame: 0, sourceFrameCount: 4,
		retimeMap: resolveFramescaperVideoRetimeMapRetime(createFramescaperVideoRetimeFreezeCommandRetime({
			clipId: 'video', expectedRetimeMap: null, sourceFrame: { num: 2, den: 1 },
		}), { sequenceFrameCount: 8, sourceInFrame: 0, sourceFrameCount: 4 }) };
	assert.equal(projectBinVideoPreviewModel(project, clip, source), null);
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	try {
		const preview = projectBinVideoPreviewModel(project, clip, source);
		assert.equal(preview?.sourceTimeAtFrame?.(0), 0.3);
		assert.equal(preview?.sourceTimeAtFrame?.(38_399), 0.3);
	} finally { unregisterVideoTimingIndex(source); }
});

function playbackHarness(sourceTimeAtFrame: (frame: number) => number) {
	let now = 0;
	let nextId = 0;
	let completions = 0;
	let ready = true;
	let currentTime = 0;
	const frames = new Map<number, () => void>();
	const listeners = new Map<string, Set<() => void>>();
	const media: ProjectBinRetimeMedia & { seeking: boolean; pauses: number } = {
		get currentTime() { return currentTime; },
		set currentTime(value: number) { if (!ready) throw new Error('Metadata pending'); currentTime = value; },
		seeking: false, pauses: 0,
		pause() { this.pauses += 1; },
		addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
		removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
	};
	return {
		media, frames, listeners,
		get completions() { return completions; },
		setReady(value: boolean) { ready = value; },
		emit(type: string) { for (const listener of listeners.get(type) ?? []) listener(); },
		advance(milliseconds: number) {
			now += milliseconds;
			const pending = [...frames.values()]; frames.clear();
			for (const callback of pending) callback();
		},
		create() { return createProjectBinRetimePlayback({ media, sampleRate: 48_000, durationFrames: 48_000, sourceTimeAtFrame,
			now: () => now, requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
			cancelFrame(id) { frames.delete(id); }, onComplete() { completions += 1; } }); },
	};
}

test('retimed bin clock pauses, resumes, naturally rewinds and replays without native playback', () => {
	const preview = retimedPreview(createFramescaperVideoRetimeReverseCommandRetime({ clipId: 'video-clip', expectedRetimeMap: null }));
	const harness = playbackHarness(preview.sourceTimeAtFrame);
	const playback = harness.create();
	assert.equal(harness.media.currentTime, 0.9);
	playback.play(); playback.play();
	assert.equal(harness.frames.size, 1);
	harness.advance(400);
	assert.equal(harness.media.currentTime, 0.5);
	playback.pause(); harness.advance(2_000);
	assert.equal(harness.media.currentTime, 0.5);
	assert.equal(harness.frames.size, 0);
	playback.play(); harness.advance(100);
	assert.equal(harness.media.currentTime, 0.4);
	harness.advance(500);
	assert.equal(harness.completions, 1);
	assert.equal(harness.media.currentTime, 0.9);
	assert.equal(harness.frames.size, 0);
	playback.play(); harness.advance(100);
	assert.equal(harness.media.currentTime, 0.8);
	assert.ok(harness.media.pauses > 0);
	playback.dispose(); playback.dispose();
	assert.equal(harness.frames.size, 0);
	assert.ok([...harness.listeners.values()].every(set => set.size === 0));
	playback.play(); harness.advance(1_000);
	assert.equal(harness.completions, 1);
});

test('frozen bin clock retries metadata, settles pending seeks, and releases all callbacks', () => {
	const harness = playbackHarness(() => 0.2);
	harness.setReady(false);
	const playback = harness.create();
	playback.play(); harness.advance(100);
	assert.equal(harness.media.currentTime, 0);
	harness.setReady(true); harness.media.seeking = true; harness.emit('loadedmetadata');
	assert.equal(harness.media.currentTime, 0);
	harness.media.seeking = false; harness.emit('seeked');
	assert.equal(harness.media.currentTime, 0.2);
	harness.advance(700);
	assert.equal(harness.media.currentTime, 0.2);
	const staleTick = [...harness.frames.values()][0]!;
	playback.dispose(); playback.dispose();
	staleTick(); harness.emit('loadedmetadata');
	assert.equal(harness.completions, 0);
	assert.equal(harness.frames.size, 0);
});
