/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, effectTailFrames, projectEffectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';
import { applyEffect } from '../src/common/editor/engine/effect-rack.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { createAudioTrack, createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { mixRenderTailFrames } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import { stereoTrackRenderRange } from '../src/common/editor/controller/track-audio/internal/stereo-track-render-range.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { evaluateAutomationLaneAtFrameV21, normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

const RATE = 48_000;
type Direction = 'lowpass' | 'highpass';

for (const type of ['lowpass', 'highpass'] as const) {
	for (const channelCount of [1, 2, 6]) {
		test(`native ${type} retains its ${channelCount}-channel state when the recording ends`, () => {
			const context = new MockAudioContext({ sampleRate: RATE });
			const native = applyEffect(context as unknown as BaseAudioContext,
				context.createGain() as unknown as AudioNode,
				createEffect(type, { params: { frequency: 10, q: .707 } }), [],
				{ effectChannelCount: channelCount }) as BiquadFilterNode;
			// A disconnected native source narrows max-mode input to mono; changing
			// Biquad input width reinitializes its channel histories instead of releasing them.
			assert.equal(native.channelCountMode, 'explicit', 'Source silence must retain charged filter channels.');
			assert.equal(native.channelCount, channelCount, 'The native filter must preserve the authored strip width.');
		});
	}
}

/** Independent reference for the browser's installed low/high-pass biquad. */
function chargedFilter(type: Direction, frequency: number, q: number): (sample: number) => number {
	const context = new MockAudioContext({ sampleRate: RATE });
	const effect = createEffect(type, { params: { frequency, q } });
	const native = applyEffect(context as unknown as BaseAudioContext,
		context.createGain() as unknown as AudioNode, effect, []) as unknown as {
		readonly frequency: { readonly value: number };
		readonly Q: { readonly value: number };
	};
	const angle = 2 * Math.PI * native.frequency.value / RATE;
	const cosine = Math.cos(angle);
	const alpha = Math.sin(angle) / (2 * 10 ** (native.Q.value / 20));
	const a0 = 1 + alpha;
	const b0 = (type === 'lowpass' ? 1 - cosine : 1 + cosine) / (2 * a0);
	const b1 = (type === 'lowpass' ? 1 - cosine : -(1 + cosine)) / a0;
	const a1 = -2 * cosine / a0;
	const a2 = (1 - alpha) / a0;
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	const process = (sample: number): number => {
		const result = b0 * sample + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
		x2 = x1; x1 = sample; y2 = y1; y1 = result;
		return result;
	};
	for (let frame = 0; frame < RATE; frame++) process(.5 * Math.sin(angle * frame));
	return process;
}

for (const type of ['lowpass', 'highpass'] as const) {
	for (const [frequency, q] of [[10, .1], [10, .707], [1000, 30]] as const) {
		test(`native ${type} reserves its audible ${frequency} Hz, Q ${q} release`, () => {
			const process = chargedFilter(type, frequency, q);
			assert.ok(Math.abs(process(0)) > .001, 'The ordinary recording must charge an audible release.');
			const declared = effectTailFrames(createEffect(type, { params: { frequency, q } }), RATE);
			assert.ok(declared > 128, `Export must reserve the native ${type} release, received ${declared}.`);
			for (let frame = 0; frame < declared; frame++) process(0);
			for (let frame = 0; frame < 128; frame++) {
				assert.ok(Math.abs(process(0)) < .0001, 'The reserved native release must settle below -80 dB.');
			}
		});
	}
}

for (const operation of ['mix-render', 'make-stereo'] as const) {
	test(`${operation} retains native release authored through parameter automation`, () => {
		const effect = createEffect('lowpass', { id: 'filter', params: { frequency: 1000, q: .707 } });
		const project = createSoundscaperProject({ id: 'native-release', title: 'Native release',
			now: '2026-10-10T00:00:00.000Z',
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'], effects: [effect] })],
			sources: [createAudioSource({ id: 'source', name: 'Recording', storageKey: 'source',
				sampleRate: RATE, channelCount: 1, frameCount: RATE })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: RATE,
				sourceDurationFrames: RATE, timelineStartFrame: 0 })] });
		const lanes = [{ id: 'filter-curve', address: { kind: 'effect',
			strip: { kind: 'track', id: 'voice' }, effectId: 'filter', parameterId: 'frequency' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 10 }], segments: [] }];
		const snapshot = { ...project, automationLanes: lanes } as unknown as ControllerProject;
		const tracks = snapshot.tracks.filter(track => track.type === 'audio') as ControllerTrack[];
		const expected = effectTailFrames(createEffect('lowpass', { params: { frequency: 10, q: .707 } }), RATE);
		const actual = operation === 'mix-render'
			? mixRenderTailFrames(tracks, snapshot, RATE, rackTailFrames, { includeBuses: false })
			: stereoTrackRenderRange(tracks, snapshot.clips, RATE, lanes).endFrame - RATE;
		assert.ok(actual >= expected, `${operation} must capture the ${expected}-frame authored release, received ${actual}.`);
	});
}

test('native filter release retains bypass and rack duration policies', () => {
	const effect = createEffect('lowpass', { params: { frequency: 10, q: 30 } });
	assert.equal(effectTailFrames({ ...effect, enabled: false }, RATE), 0);
	assert.ok(effectTailFrames(effect, RATE) > 10 * RATE);
	assert.equal(rackTailFrames([effect], RATE), 10 * RATE);
	assert.equal(effectTailFrames(createEffect('lowpass', { params: { frequency: 24_000 } }), RATE), 0);
	assert.equal(effectTailFrames(createEffect('highpass', { params: { frequency: 20_000 } }), 8_000), 0);
});

for (const [parameterId, value] of [['frequency', 10], ['q', 30]] as const) {
	test(`native filter release includes authored ${parameterId} automation`, () => {
		const effect = createEffect('lowpass', { id: 'filter', params: { frequency: 1000, q: .707 } });
		const project = { sampleRate: RATE, tracks: [{ id: 'voice', type: 'audio', effects: [effect] }],
			automationLanes: [{ id: 'filter-curve', address: { kind: 'effect',
				strip: { kind: 'track', id: 'voice' }, effectId: 'filter', parameterId },
				timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value }], segments: [] }] };
		const expected = effectTailFrames(createEffect('lowpass', { params: { ...effect.params, [parameterId]: value } }), RATE);
		const actual = projectEffectTailFrames(project);
		assert.ok(actual > 128 && actual >= expected, `The authored ${parameterId} release must survive Export: ${actual} versus ${expected}.`);
	});
}

test('native filter release bounds audible Q inside an authored Bézier curve', () => {
	const effect = createEffect('lowpass', { id: 'filter', params: { frequency: 1000, q: .707 } });
	const lane = normalizeAutomationLaneV21({ id: 'quality-curve', address: { kind: 'effect',
		strip: { kind: 'track', id: 'voice' }, effectId: 'filter', parameterId: 'q' },
		timebase: 'absolute-samples', points: [
			{ id: 'start', position: 0, value: .1 }, { id: 'end', position: RATE, value: .1 }],
		segments: [{ kind: 'bezier', control1: { position: { num: RATE / 3, den: 1 }, value: 30 },
			control2: { position: { num: 2 * RATE / 3, den: 1 }, value: 30 } }] });
	const middleQuality = evaluateAutomationLaneAtFrameV21(lane, RATE / 2, { sampleRate: RATE });
	assert.ok(middleQuality > 20, 'The public Q curve must have an audible interior resonance.');
	const expected = effectTailFrames(createEffect('lowpass', { params: { frequency: 1000, q: middleQuality } }), RATE);
	const actual = projectEffectTailFrames({ sampleRate: RATE,
		tracks: [{ id: 'voice', type: 'audio', effects: [effect] }], automationLanes: [lane] });
	assert.ok(actual >= expected, `The interior resonance must retain its ${expected}-frame release, received ${actual}.`);
});
