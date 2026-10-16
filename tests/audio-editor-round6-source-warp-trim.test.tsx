/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { evaluateAudioWarpMap, normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { clipSourceTrim } from '../src/common/editor/ui/inspector/clip-source-view.ts';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000,
	frameCount: 48_000, channelCount: 1 });
const document = createSoundscaperProject({ id: 'source-trim', now: '2026-10-09T12:00:00.000Z', sampleRate: 48_000,
	sources: [source], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 1200,
		durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 24_000, source: 36_000, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } })],
});
const clip = resolveRuntimeClipProjection(document, document.clips[0]!);

test('Source extension restores a hidden marker and its original output timing', () => {
	const shortened = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: clip.id,
		sourceRange: true, ...clipSourceTrim(clip, source, document.sampleRate, 'end', 33_600, document) });
	const shortClip = resolveRuntimeClipProjection(shortened, shortened.clips[0]!);
	const changes = clipSourceTrim(shortClip, source, document.sampleRate, 'end', source.frameCount, shortened);
	assert.equal(changes.durationFrames, 48_000);
	const restored = applySoundscaperProjectCommand(shortened, { type: 'clip/trim', clipId: clip.id,
		sourceRange: true, ...changes });
	const map = normalizeAudioWarpMap(restored.clips[0]!.warpMap);
	for (const point of normalizeAudioWarpMap(clip.warpMap).points) assert.ok(map.points.some(candidate =>
		candidate.outer.num === point.outer.num && candidate.outer.den === point.outer.den
		&& candidate.source.num === point.source.num && candidate.source.den === point.source.den));
	for (const outer of [0, 12_000, 22_400, 24_000, 40_000, 48_000]) {
		assert.deepEqual(evaluateAudioWarpMap(map, outer), evaluateAudioWarpMap(normalizeAudioWarpMap(clip.warpMap), outer));
	}
});

test('Source trimming resolves a musical warp through the project tempo authority', () => {
	const musical = createSoundscaperProject({ id: 'musical-source', now: '2026-10-09T12:00:00.000Z',
		sampleRate: document.sampleRate, sources: [source], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0,
			durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
			anchor: 'musical', musicalStartBeat: { num: 0, den: 1 }, musicalExtent: 'beat',
			musicalDurationBeats: { num: 2, den: 1 }, warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 1, source: 36_000, mode: 'forward' },
				{ outer: 2, source: 48_000, mode: 'forward' },
			] } })],
	});
	const runtime = resolveRuntimeClipProjection(musical, musical.clips[0]!);
	const changes = clipSourceTrim(runtime, source, musical.sampleRate, 'end', 43_200, musical);
	assert.equal(changes.durationFrames, 38_400);
	const edited = applySoundscaperProjectCommand(musical, { type: 'clip/trim', clipId: runtime.id,
		sourceRange: true, ...changes });
	assert.deepEqual(edited.clips[0]!.musicalDurationBeats, { num: 8, den: 5 });
	assert.deepEqual(edited.clips[0]!.musicalStartBeat, { num: 0, den: 1 });
});

for (const [edge, frame, expectedDuration, outputOffset] of [
	['end', 43_200, 38_400, 0], ['end', 33_600, 22_400, 0],
	['start', 4800, 44_800, 3200], ['start', 36_000, 24_000, 24_000],
] as const) test(`Source ${edge} trim at ${frame} preserves authored warp timing`, () => {
	const original = structuredClone(document);
	const changes = clipSourceTrim(clip, source, document.sampleRate, edge, frame, document);
	assert.equal(changes.durationFrames, expectedDuration);
	const edited = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: clip.id,
		sourceRange: true, ...changes });
	const result = resolveRuntimeClipProjection(edited, edited.clips[0]!);
	assert.equal(result.timelineStartFrame, clip.timelineStartFrame);
	assert.equal(result.durationFrames, expectedDuration);
	for (const outer of [0, 1200, 4800, 19_200]) {
		assert.deepEqual(evaluateAudioWarpMap(normalizeAudioWarpMap(result.warpMap), outer),
			evaluateAudioWarpMap(normalizeAudioWarpMap(clip.warpMap), outer + outputOffset));
	}
	assert.deepEqual(edited.sources, document.sources);
	assert.deepEqual(document, original, 'Undo retains the complete original document');
});

for (const warped of [false, true]) test(`Source keyboard trim forwards ${warped ? 'nonlinear' : 'ordinary'} timing authority`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const current = warped ? clip : { ...clip, warpMap: null };
	const project: ClipSourceProject = { id: document.id, sampleRate: document.sampleRate,
		tempoMap: document.tempoMap, sources: [source], clips: [current] };
	const trims: Readonly<Record<string, number>>[] = [];
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update() {} }, timeline: {}, effects: { setSourceSelection() {} },
		audioWarp: { addSourceMarker() {}, moveSourceMarker() {}, deleteSourceMarker() {} },
		clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
			setLoop() {}, setLoopRange() {}, setSelection() {}, trim(_id, changes) { trims.push(changes); },
			subscribe: () => () => {}, snapshot: () => ({ clipId: null, focused: false,
				state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) },
	} };
	try {
		await act(async () => root.render(<ClipSourceEditor controller={controller} project={project}
			clipId={clip.id} copy={{ clipSourceTrimEnd: 'Trim source end' }} blocked={false} />));
		const handle = dom.one('.audio-editor-source-trim--end');
		await act(async () => reactProps(handle).onKeyDown({ key: 'ArrowLeft', shiftKey: true,
			preventDefault() {}, stopPropagation() {} }));
		assert.deepEqual(trims, [{ sourceStartFrame: 0, sourceDurationFrames: 43_200,
			durationFrames: warped ? 38_400 : 43_200 }]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
