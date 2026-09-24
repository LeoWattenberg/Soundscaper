/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateClipFadeAt, evaluateClipTransitionGainAt } from '../src/common/editor/audio-clip-transition-gain.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createNativeClipEnvelope } from '../src/common/editor/aup4-export-envelopes.js';
import { prepareBoundedWaveformWindow } from '../src/common/editor/design-system-adapters/waveform.ts';
import { scheduleClipGain } from '../src/common/editor/engine/clip-gain.ts';

const EPSILON = 1e-3;
const near = (actual: number, expected: number): void => assert.ok(
	Math.abs(actual - expected) < EPSILON, `${String(actual)} differs from ${String(expected)}`,
);

test('fade shape gain uses equal-power trigonometric curves on both edges', () => {
	near(evaluateClipFadeAt(25, 100, 50, 'in', 1), Math.SQRT1_2);
	near(evaluateClipFadeAt(75, 100, 50, 'out', 1), Math.SQRT1_2);
	near(evaluateClipFadeAt(25, 100, 50, 'in', 2), 0.5);
	near(evaluateClipFadeAt(75, 100, 50, 'out', 0.5), Math.sqrt(Math.SQRT1_2));
	assert.equal(evaluateClipFadeAt(0, 100, 50, 'in'), 0);
	assert.equal(evaluateClipFadeAt(100, 100, 50, 'out'), 0);
	assert.equal(evaluateClipFadeAt(25, 100, 0, 'in', 6), 1);
	near(evaluateClipTransitionGainAt(50, 100, {
		fadeInFrames: 100, fadeOutFrames: 100,
		fadeInShape: 2, fadeOutShape: 2,
		crossfadeInRanges: [], crossfadeOutRanges: [],
	}), 0.25);
});

test('an absent shape keeps the gain of a saved linear fade', () => {
	near(evaluateClipFadeAt(25, 100, 50, 'in'), 0.5);
	near(evaluateClipFadeAt(75, 100, 50, 'out'), 0.5);
	const waveform = prepareBoundedWaveformWindow([Float32Array.of(1, 1, 1, 1)], {
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		fadeInFrames: 4,
	});
	near(waveform.channels[0]![2]!, 0.5);
	const exported = createNativeClipEnvelope({
		id: 'clip', timelineStartFrame: 0, durationFrames: 100,
		gain: 1, fadeInFrames: 100, fadeOutFrames: 0, envelope: [],
	}, { envelope: [] });
	assert.equal(exported.points[0]?.frame, 0);
	assert.equal(exported.points.at(-1)?.frame, 100);
	for (const point of exported.points) near(point.value, point.frame / 100);
});

test('clip shapes round-trip through project creation and updates, and reject invalid values', () => {
	const unshaped = createAudioClip({ id: 'plain', sourceId: 'source', durationFrames: 100 });
	assert.equal(Object.hasOwn(unshaped, 'fadeInShape'), false);
	assert.equal(Object.hasOwn(unshaped, 'fadeOutShape'), false);
	const original = createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100,
		fadeInFrames: 50, fadeOutFrames: 50, fadeInShape: 0.5, fadeOutShape: 2 });
	assert.equal(original.fadeInShape, 0.5);
	assert.equal(original.fadeOutShape, 2);
	const project = createCurrentAudioEditorProject({
		id: 'fade-shapes', now: '2026-09-24T00:00:00.000Z',
		sources: [{ id: 'source', storageKey: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 }],
		clips: [original],
		tracks: [{ id: 'track', name: 'Audio', clipIds: ['clip'] }],
	});
	assert.equal(validateCurrentAudioEditorProject(project), true);
	const changed = applyEditorCommand(project, {
		type: 'clip/update', clipId: 'clip', changes: { fadeInShape: 6, fadeOutShape: 0.15 },
	});
	assert.equal(changed.clips[0]?.fadeInShape, 6);
	assert.equal(changed.clips[0]?.fadeOutShape, 0.15);
	assert.equal(validateCurrentAudioEditorProject(changed), true);
	const restored = parseScapeProjectDocument(serializeScapeProjectDocument(changed)) as typeof changed;
	assert.equal(restored.clips[0]?.fadeInShape, 6);
	assert.equal(restored.clips[0]?.fadeOutShape, 0.15);
	const oldClip = structuredClone(project) as unknown as { clips: Record<string, unknown>[] };
	delete oldClip.clips[0]!.fadeInShape;
	delete oldClip.clips[0]!.fadeOutShape;
	assert.equal(validateCurrentAudioEditorProject(oldClip), true);
	assert.throws(() => createAudioClip({ sourceId: 'source', durationFrames: 100, fadeInShape: 0.14 }), /fadeInShape/u);
	assert.throws(() => createAudioClip({ sourceId: 'source', durationFrames: 100, fadeOutShape: 6.01 }), /fadeOutShape/u);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/update', clipId: 'clip', changes: { fadeOutShape: 6.01 },
	}), /fadeOutShape/u);
});

test('nullish fade shapes stay absent through factory normalization and trimming', () => {
	const clip = createAudioClip({
		id: 'clip', sourceId: 'source', durationFrames: 100,
		fadeInShape: undefined, fadeOutShape: null,
	});
	assert.equal(Object.hasOwn(clip, 'fadeInShape'), false);
	assert.equal(Object.hasOwn(clip, 'fadeOutShape'), false);
	const project = createCurrentAudioEditorProject({
		id: 'fade-shape-trim', now: '2026-09-24T00:00:00.000Z',
		sources: [createAudioSource({ id: 'source', storageKey: 'source',
			frameCount: 100, channelCount: 1, sampleRate: 48_000 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const trimmed = applyEditorCommand(project, { type: 'clip/trim', clipId: 'clip', durationFrames: 80 });
	assert.equal(Object.hasOwn(trimmed.clips[0], 'fadeInShape'), false);
	assert.equal(Object.hasOwn(trimmed.clips[0], 'fadeOutShape'), false);
	assert.doesNotThrow(() => serializeScapeProjectDocument(trimmed));
});

test('editing a legacy fade keeps it linear, while creating a new fade records shape one', () => {
	const project = createCurrentAudioEditorProject({
		id: 'fade-shape-legacy', now: '2026-09-24T00:00:00.000Z',
		sources: [createAudioSource({ id: 'source', storageKey: 'source',
			frameCount: 100, channelCount: 1, sampleRate: 48_000 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100, fadeInFrames: 50 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const edited = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: { title: 'Renamed' } });
	assert.equal(Object.hasOwn(edited.clips[0]!, 'fadeInShape'), false);
	const changed = applyEditorCommand(edited, { type: 'clip/update', clipId: 'clip', changes: { fadeInFrames: 60 } });
	assert.equal(Object.hasOwn(changed.clips[0]!, 'fadeInShape'), false);
	const fresh = applyEditorCommand(changed, { type: 'clip/update', clipId: 'clip', changes: { fadeOutFrames: 50 } });
	assert.equal(fresh.clips[0]?.fadeOutShape, 1);
	const restored = parseScapeProjectDocument(serializeScapeProjectDocument(fresh)) as typeof fresh;
	assert.equal(Object.hasOwn(restored.clips[0]!, 'fadeInShape'), false);
	assert.equal(restored.clips[0]?.fadeOutShape, 1);
});

test('rendered replacement clears baked fade shapes along with fade durations', () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source',
		frameCount: 100, channelCount: 1, sampleRate: 48_000 });
	const project = createCurrentAudioEditorProject({
		id: 'fade-shape-render', now: '2026-09-24T00:00:00.000Z', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 100,
			fadeInFrames: 20, fadeOutFrames: 20, fadeInShape: 2, fadeOutShape: 3 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const rendered = applyEditorCommand(project, { type: 'clip/render-replace-many', entries: [{
		clipId: 'clip', source: { id: 'rendered', storageKey: 'rendered',
			frameCount: 100, channelCount: 1, sampleRate: 48_000 },
	}] });
	assert.equal(rendered.clips[0]?.fadeInFrames, 0);
	assert.equal(rendered.clips[0]?.fadeOutFrames, 0);
	assert.equal(Object.hasOwn(rendered.clips[0], 'fadeInShape'), false);
	assert.equal(Object.hasOwn(rendered.clips[0], 'fadeOutShape'), false);
});

test('joining clips takes the outgoing shape from the last clip even when it uses the default', () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 100, channelCount: 1, sampleRate: 48_000 });
	const project = createCurrentAudioEditorProject({
		id: 'fade-shape-join', now: '2026-09-24T00:00:00.000Z', sources: [source],
		clips: [
			createAudioClip({ id: 'left', sourceId: source.id, timelineStartFrame: 0,
				durationFrames: 50, sourceStartFrame: 0, sourceDurationFrames: 50,
				fadeInFrames: 10, fadeInShape: 2, fadeOutFrames: 10, fadeOutShape: 2 }),
			createAudioClip({ id: 'right', sourceId: source.id, timelineStartFrame: 50,
				durationFrames: 50, sourceStartFrame: 50, sourceDurationFrames: 50,
				fadeOutFrames: 10 }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['left', 'right'] })],
	});
	const joined = applyEditorCommand(project, { type: 'clip/join', clipIds: ['left', 'right'] });
	assert.equal(joined.clips[0]?.fadeInShape, 2);
	assert.equal(Object.hasOwn(joined.clips[0]!, 'fadeOutShape'), false);
});

test('waveform samples and native Audacity export follow the authored shape', () => {
	const waveform = prepareBoundedWaveformWindow([Float32Array.of(1, 1, 1, 1)], {
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		fadeInFrames: 4, fadeInShape: 2,
	});
	near(waveform.channels[0]![2]!, 0.5);
	const exported = createNativeClipEnvelope({
		id: 'clip', timelineStartFrame: 0, durationFrames: 100,
		gain: 1, fadeInFrames: 100, fadeOutFrames: 0, fadeInShape: 2,
		envelope: [],
	}, { envelope: [] });
	const middle = exported.points.find((point: { frame: number; value: number }) => point.frame === 50);
	assert.ok(middle, 'adaptive export must include the shape midpoint');
	near(middle.value, 0.5);
});

test('realtime gain automation traces a curved fade between its endpoints', () => {
	const inParam = new RecordingAudioParam();
	const outParam = new RecordingAudioParam();
	const clipParam = new RecordingAudioParam();
	scheduleClipGain(inParam.param, outParam.param, clipParam.param,
		{ durationFrames: 100, fadeInFrames: 100, fadeInShape: 1 }, 0, 100, 100, 0, 1);
	near(inParam.at(50), Math.SQRT1_2);
	assert.ok(inParam.events.length > 2, 'curved fade needs intermediate automation events');
});

test('realtime automation reaches the first audible sample of shallow shaped fades', () => {
	const inParam = new RecordingAudioParam();
	const outParam = new RecordingAudioParam();
	const clipParam = new RecordingAudioParam();
	const duration = 48_000;
	scheduleClipGain(inParam.param, outParam.param, clipParam.param, {
		durationFrames: duration, fadeInFrames: duration, fadeOutFrames: duration,
		fadeInShape: 0.15, fadeOutShape: 0.15,
	}, 0, duration, duration, 0, duration);
	for (const frame of [1, 2, 3, 5, 10]) {
		near(inParam.at(frame / duration), evaluateClipFadeAt(frame, duration, duration, 'in', 0.15));
		near(outParam.at((duration - frame) / duration),
			evaluateClipFadeAt(duration - frame, duration, duration, 'out', 0.15));
	}
});

type ParamEvent = readonly ['set' | 'ramp', number, number];

class RecordingAudioParam {
	readonly events: ParamEvent[] = [];
	get param(): AudioParam { return this as unknown as AudioParam; }
	setValueAtTime(value: number, time: number): AudioParam {
		this.events.push(['set', value, time]);
		return this.param;
	}
	linearRampToValueAtTime(value: number, time: number): AudioParam {
		this.events.push(['ramp', value, time]);
		return this.param;
	}
	at(time: number): number {
		let previous = this.events[0]!;
		for (const event of this.events.slice(1)) {
			if (event[2] < time) { previous = event; continue; }
			if (event[0] === 'set') return previous[1];
			const progress = (time - previous[2]) / (event[2] - previous[2]);
			return previous[1] + (event[1] - previous[1]) * progress;
		}
		return previous[1];
	}
}
