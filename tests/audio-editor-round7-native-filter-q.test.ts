/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { applyEffect } from '../src/common/editor/engine/effect-rack.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { MockAudioContext, MockParam } from './helpers/mock-audio-context.js';

const sampleRate = 48_000;
type Direction = 'lowpass' | 'highpass';

function installedFilter(type: Direction, q: number, registry?: ScheduledParameterRegistry) {
	const context = new MockAudioContext({ sampleRate });
	const effect = createEffect(type, { id: 'resonant-filter', params: { frequency: 1000, q } });
	const filter = applyEffect(context as unknown as BaseAudioContext,
		context.createGain() as unknown as AudioNode, effect, [],
		{ scope: 'track', targetId: 'recording', parameterRegistry: registry }) as unknown as {
		readonly type: Direction;
		readonly Q: MockParam;
		readonly frequency: MockParam;
	};
	return filter;
}

/** Evaluate the public Web Audio low/high-pass coefficient equations, which
 * interpret the native Q AudioParam in dB, independently of the authored Q.
 */
function nativeCutoffGain(filter: ReturnType<typeof installedFilter>): number {
	const angle = 2 * Math.PI * filter.frequency.value / sampleRate;
	const cosine = Math.cos(angle);
	const alpha = Math.sin(angle) / (2 * 10 ** (filter.Q.value / 20));
	const b0 = filter.type === 'lowpass' ? (1 - cosine) / 2 : (1 + cosine) / 2;
	const b1 = filter.type === 'lowpass' ? 1 - cosine : -(1 + cosine);
	const numeratorReal = b0 + b1 * cosine + b0 * Math.cos(2 * angle);
	const numeratorImaginary = -b1 * Math.sin(angle) - b0 * Math.sin(2 * angle);
	const denominatorReal = 1 + alpha - 2 * cosine * cosine + (1 - alpha) * Math.cos(2 * angle);
	const denominatorImaginary = 2 * cosine * Math.sin(angle) - (1 - alpha) * Math.sin(2 * angle);
	return Math.hypot(numeratorReal, numeratorImaginary) / Math.hypot(denominatorReal, denominatorImaginary);
}

for (const type of ['lowpass', 'highpass'] as const) {
	for (const q of [.1, .707, 1, 10]) {
		test(`the native ${type} cutoff honors authored quality factor ${q}`, () => {
			const filter = installedFilter(type, q);
			assert.ok(Math.abs(nativeCutoffGain(filter) - q) < 1e-10,
				`authored Q ${q} must produce cutoff gain ${q}, received ${nativeCutoffGain(filter)}`);
		});
	}

	test(`the native ${type} automation target retains authored quality factor units`, () => {
		const registry = new ScheduledParameterRegistry();
		const filter = installedFilter(type, .707, registry);
		const target = registry.get({ kind: 'effect', strip: { kind: 'track', id: 'recording' },
			effectId: 'resonant-filter', parameterId: 'q' });
		assert.ok(target?.descriptor.automatable, 'ordinary Q automation must be available');
		Object.assign(filter.Q, { cancelScheduledValues: () => undefined });
		for (const q of [.1, .707, 1, 10, 30]) {
			target.schedule([{ kind: 'set', frame: 0, value: q }],
				{ fromFrame: 0, contextStartTime: 0, sampleRate, contextSampleRate: sampleRate });
			assert.ok(Math.abs(nativeCutoffGain(filter) - q) < 1e-9,
				`automated Q ${q} must retain the authored units`);
		}
	});
}
