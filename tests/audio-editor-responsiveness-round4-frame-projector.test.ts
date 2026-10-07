/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { createScheduledParameterContextFrameProjector } from '../src/common/editor/engine/scheduled-parameter-frame-projector.ts';
import {
	roundScheduledParameterContextFrameOffset,
	ScheduledParameterRegistry,
	type ScheduledParameterMessage,
} from '../src/common/editor/engine/scheduled-parameter-registry.ts';

function observe(operation: () => number): number | { error: { name: string; message: string } } {
	try { return operation(); } catch (error) {
		assert.ok(error instanceof Error);
		return { error: { name: error.name, message: error.message } };
	}
}

const receipt = JSON.parse(readFileSync(new URL('./fixtures/responsiveness-round4-frame-parity.json', import.meta.url), 'utf8')) as {
	cases: readonly { inputs: [number, number, number, number, number, number]; result: ReturnType<typeof observe> }[];
};

test('public parameter offsets match 157 frozen original conversions and refusals', () => {
	assert.equal(receipt.cases.length, 157);
	for (const { inputs, result } of receipt.cases) {
		assert.deepEqual(observe(() => roundScheduledParameterContextFrameOffset(...inputs)), result);
	}
});

test('prepared parameter offsets retain exact decimal ratios, half ties and overflow refusals', () => {
	for (const rate of [1, 2, .1, 1.2, 2.001, Number.MIN_VALUE, Number.MAX_VALUE]) {
		for (const sampleRate of [32_000, 44_100, 48_000, 96_000]) {
			const project = createScheduledParameterContextFrameProjector(37, sampleRate, 48_000, rate, 19);
			for (const frame of [37, 38, 40, 82_411_206, Number.MAX_SAFE_INTEGER]) {
				assert.deepEqual(observe(() => project(frame)), observe(() => roundScheduledParameterContextFrameOffset(frame, 37, sampleRate, 48_000, rate, 19)));
			}
		}
	}
	assert.equal(createScheduledParameterContextFrameProjector(0, 2, 1, 1, 0)(1), 1);
	assert.throws(() => createScheduledParameterContextFrameProjector(100, 48_000, 48_000, 1, 0)(99), /unsafe/u);
});

test('a message-window projector prepares its decimal transport ratio once', () => {
	const original = Number.prototype.toString;
	let conversions = 0;
	Number.prototype.toString = function(radix?: number): string {
		if (Number(this) === 1.2) conversions += 1;
		return original.call(this, radix);
	};
	try {
		const project = createScheduledParameterContextFrameProjector(0, 44_100, 48_000, 1.2, 32);
		for (let frame = 0; frame < 1000; frame += 1) assert.ok(Number.isSafeInteger(project(frame)));
		assert.equal(conversions, 1);
	} finally { Number.prototype.toString = original; }
});

test('registered message targets prepare one conversion for the complete immutable packet', () => {
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'pan' }, 32);
	const packets: ScheduledParameterMessage[] = [];
	const target = new ScheduledParameterRegistry().registerMessageTarget(descriptor, packet => { packets.push(packet); });
	const events = Array.from({ length: 1000 }, (_, frame) => ({ kind: 'set' as const, frame, value: 0 }));
	const original = Number.prototype.toString;
	let conversions = 0;
	Number.prototype.toString = function(radix?: number): string {
		if (Number(this) === 1.2) conversions += 1;
		return original.call(this, radix);
	};
	try {
		target.schedule(events, { fromFrame: 0, contextStartTime: 0, sampleRate: 44_100, contextSampleRate: 48_000, transportRate: 1.2 });
		assert.equal(conversions, 1);
	} finally { Number.prototype.toString = original; }
	assert.equal(packets.length, 1);
	const packet = packets[0]!;
	assert.ok(Object.isFrozen(packet) && Object.isFrozen(packet.events) && packet.events.every(Object.isFrozen));
	assert.deepEqual(packet.events[0], { kind: 'set', frameOffset: 32, value: 0 });
	assert.deepEqual(packet.events.at(-1), { kind: 'set', frameOffset: 938, value: 0 });
	events[0]!.value = .5;
	assert.equal(packet.events[0]!.value, 0);
});

test('standalone frame-before-window refusal still precedes transport ratio decoding', () => {
	const original = Number.prototype.toString;
	Number.prototype.toString = function(): string { throw new Error('Unexpected decimal decoding'); };
	try {
		assert.throws(() => roundScheduledParameterContextFrameOffset(99, 100, 48_000, 48_000, 1.2, 0), { message: 'A parameter frame offset is unsafe.' });
	} finally { Number.prototype.toString = original; }
});

test('context offset overflow retains its original public error fields', () => {
	assert.throws(() => roundScheduledParameterContextFrameOffset(1, 0, 48_000, 48_000, Number.MIN_VALUE, 0), error => {
		assert.ok(error instanceof RangeError);
		assert.equal(error.message, 'A parameter frame offset is unsafe.');
		assert.equal(Object.hasOwn(error, 'cause'), false);
		return true;
	});
});
