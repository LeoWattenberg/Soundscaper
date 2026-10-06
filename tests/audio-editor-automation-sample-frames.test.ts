/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { projectTrackAutomationOverlayV21 } from '../src/common/editor/ui/timeline/track-automation-overlay-projection.ts';
import { evaluateAutomationLaneAtFrameV21, type AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'track' }, parameterId: 'pan' as const };
const descriptor = stripParameterDescriptor(address);
const options = { descriptor, currentValue: 0, clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 100_000 }],
	viewportStartFrame: 0, viewportEndFrame: 100_000, pixelsPerSecond: 1_000, sampleRate: 100_000, width: 1_012, height: 100 };
const base: AutomationLaneV21 = { id: 'lane', address, timebase: 'absolute-samples',
	points: [{ id: 'a', position: 0, value: -1 }, { id: 'b', position: 100_000, value: 1 }], segments: [{ kind: 'linear' }] };

void test('constant and absolute linear overlays emit endpoints instead of a dense pixel grid', () => {
	assert.equal(projectTrackAutomationOverlayV21({ ...options, lane: null }).spans[0]!.samples.length, 2);
	assert.equal(projectTrackAutomationOverlayV21({ ...options, lane: base }).spans[0]!.samples.length, 2);
});

void test('adaptive eased and asymmetric bezier curves stay within a quarter pixel of dense evaluation', () => {
	const curves: AutomationLaneV21[] = [{ ...base, segments: [{ kind: 'eased' }] },
		{ ...base, segments: [{ kind: 'bezier', control1: { position: { num: 5_000, den: 1 }, value: 1 },
			control2: { position: { num: 80_000, den: 1 }, value: -1 } }] }];
	for (const lane of curves) {
		const samples = projectTrackAutomationOverlayV21({ ...options, lane }).spans[0]!.samples;
		assert.ok(samples.length < 150, `Expected fewer than 150 samples, got ${samples.length}`);
		let interval = 1;
		for (let frame = 0; frame < 100_000; frame += 200) {
			while (samples[interval]!.frame < frame) interval += 1;
			const left = samples[interval - 1]!, right = samples[interval]!;
			const projectedY = left.y + (right.y - left.y) * (frame - left.frame) / (right.frame - left.frame);
			const expectedY = 20 + (1 - (evaluateAutomationLaneAtFrameV21(lane, frame, { sampleRate: 100_000 }) + 1) / 2) * 80;
			assert.ok(Math.abs(projectedY - expectedY) <= 0.25, `frame ${frame} differs by ${Math.abs(projectedY - expectedY)}`);
		}
	}
});
