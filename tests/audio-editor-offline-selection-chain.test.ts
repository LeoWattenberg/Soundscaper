/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runOfflineSelectionSegment } from '../src/common/editor/controller/effects/internal/macro/offline-selection-chain.ts';
import { runSelectionEffectChain } from '../src/common/editor/selection-effect-chain.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { matchAudacitySelectionChannels } from '../src/common/editor/audacity-selection.js';

const effect = (type: string) => ({ type, params: {} });
test('private offline segments use bounded packets and retain every context-dependent execution barrier', async () => {
	const packets: string[][] = []; const individual: string[] = [];
	const steps = [...Array.from({ length: 35 }, () => effect('audacity-reverse')), effect('audacity-repair'), effect('audacity-amplify'), effect('audacity-normalize')];
	const initial = [Float32Array.of(1, 2)];
	const result = await runOfflineSelectionSegment(steps, initial, async (step, channels) => {
		individual.push(step.type); return channels;
	}, 48000, () => undefined, async (request) => {
		packets.push(request.steps.map((step) => step.effectType)); return { channels: request.channels };
	});
	assert.equal(result, initial); assert.deepEqual(packets.map((packet) => packet.length), [32, 3, 2]);
	assert.deepEqual(individual, ['audacity-repair']);
});

test('admitted packets match actual original serial offline DSP and public ports retain serial per-step matching', async () => {
	const steps = [effect('audacity-fade-in'), { type: 'audacity-repeat', params: { count: 1 } }, effect('audacity-reverse'), effect('audacity-amplify')];
	const input = [Float32Array.of(-0, 1e-40, .4, -.25, -.8), Float32Array.of(.6, -.2, -0, -1e-40, .3)];
	let serial = 0; let packet = 0;
	const applyOne = async (step: typeof steps[number], channels: readonly Float32Array[]) => {
		serial++; return matchAudacitySelectionChannels(await applyAudioSelectionEffectAsync(step.type, [...channels], 48000, step.params), channels.length);
	};
	const expected = await runOfflineSelectionSegment(steps, input, applyOne, 48000, () => undefined);
	assert.equal(serial, steps.length); serial = 0;
	const actual = await runOfflineSelectionSegment(steps, input, applyOne, 48000, () => undefined, async (request) => {
		packet++; return { channels: await runSelectionEffectChain(request.steps, [...request.channels], request.sampleRate, applyAudioSelectionEffectAsync) };
	});
	assert.equal(serial, 0); assert.equal(packet, 1); assert.deepEqual(actual, expected);
	for (const [index, channel] of actual.entries()) assert.deepEqual(new Uint8Array(channel.buffer), new Uint8Array(expected[index]!.buffer));
});

test('stale authority prevents packets and prevents a completed packet reaching its next step', async () => {
	const reason = new Error('stale project'); let current = true; let dispatches = 0;
	await assert.rejects(runOfflineSelectionSegment([effect('audacity-reverse'), effect('audacity-amplify'), effect('audacity-repair')], [Float32Array.of(1)],
		async () => { throw new Error('later step must not execute'); }, 48000, () => { if (!current) throw reason; },
		async (request) => { dispatches++; current = false; return { channels: request.channels }; }), (error: unknown) => error === reason);
	assert.equal(dispatches, 1);
});
