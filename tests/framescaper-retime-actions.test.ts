/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperVideoRetimeActionsRetime,
} from '../src/framescaper/editor-project-retime-retime-actions.ts';

type Data = Record<string, unknown>;

const BASE: Data = Object.freeze({ clipId: 'clip-1', expectedRetimeMap: null });

function rational(value: number): Data {
	return { num: value, den: 1 };
}

function actions(): Readonly<{ actions: Data; executed: Data[] }> {
	const executed: Data[] = [];
	return {
		executed,
		actions: createFramescaperVideoRetimeActionsRetime((command: unknown) => {
			executed.push(command as Data);
			return 'executed';
		}) as unknown as Data,
	};
}

function invoke(name: string, input: Data): Data {
	const { actions: bound, executed } = actions();
	const result = (bound[name] as (value: unknown) => unknown)(input);

	assert.equal(result, 'executed', 'an action must return whatever its executor returned');
	assert.equal(executed.length, 1, 'an action must reach the executor exactly once');
	return executed[0]!;
}

test('the retime facade exposes exactly its six frozen authoring spellings', () => {
	const { actions: bound } = actions();

	assert.deepEqual(
		Object.keys(bound),
		['set', 'reset', 'constant', 'reverse', 'freeze', 'ramp'],
	);
	assert.ok(Object.isFrozen(bound), 'the facade must not admit a generic command escape hatch');
});

test('each spelling builds its own command type for the bound executor', () => {
	assert.equal(invoke('reset', BASE).type, 'video-retime/reset');
	assert.equal(invoke('constant', BASE).type, 'video-retime/constant');
	assert.equal(invoke('reverse', BASE).type, 'video-retime/reverse');
	assert.equal(
		invoke('freeze', { ...BASE, sourceFrame: rational(3) }).type,
		'video-retime/freeze',
	);
	assert.equal(invoke('ramp', {
		...BASE,
		direction: 'forward',
		startVelocity: rational(1),
		endVelocity: rational(2),
		sourceStartFrame: rational(0),
	}).type, 'video-retime/ramp');
});

test('a command defaults to timeline scope and carries its clip identity', () => {
	const command = invoke('reset', BASE);

	assert.equal(command.scope, 'timeline');
	assert.equal(command.clipId, 'clip-1');
});

test('an explicit project-bin scope is preserved', () => {
	assert.equal(invoke('reset', { ...BASE, scope: 'project-bin' }).scope, 'project-bin');
});

test('a caller cannot smuggle its own command type or extra fields through an action', () => {
	const { actions: bound } = actions();
	const reset = bound.reset as (value: unknown) => unknown;

	assert.throws(() => reset({ ...BASE, type: 'video-retime/reset' }), TypeError);
	assert.throws(() => reset({ ...BASE, extra: 1 }), TypeError);
	assert.throws(() => reset({ ...BASE, scope: 'bin' }), RangeError);
});

test('a set command refuses the null retime map that reset exists to express', () => {
	const { actions: bound } = actions();
	const set = bound.set as (value: unknown) => unknown;

	assert.throws(() => set({ ...BASE, retimeMap: null }), /requires a non-null retimeMap/u);
});

test('the facade requires an exact command executor', () => {
	for (const value of [null, undefined, 'execute', {}, 42]) {
		assert.throws(() => createFramescaperVideoRetimeActionsRetime(value), TypeError);
	}
});
