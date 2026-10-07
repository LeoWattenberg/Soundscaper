/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileParallelStackEffectInventory } from '../src/common/editor/engine/parallel-stack-effect-plan.ts';
import type { ParallelStackEffect } from '../src/common/editor/engine/parallel-stack-types.ts';
import type { EngineEffect } from '../src/common/editor/engine/types.ts';

test('effect inventory inspects all rack flags before compiling and never changes caller records', () => {
	const observed: string[] = [];
	const make = (id: string, type: string, lookahead: number): EngineEffect => ({
		id, type,
		get enabled() { observed.push(`${id}:enabled`); return true; },
		get bypassed() { observed.push(`${id}:bypassed`); return false; },
		get params() { observed.push(`${id}:params`); return { lookahead }; },
	});
	const first = make('first', 'limiter', .001);
	const second = make('second', 'limiter', .002);
	const rack = Object.freeze([first, second, { id: 'disabled', type: 'unsupported', enabled: false }]);
	const inventory = compileParallelStackEffectInventory(rack, 48_000, 2);
	assert.deepEqual(observed.slice(0, 4), ['first:enabled', 'first:bypassed', 'second:enabled', 'second:bypassed']);
	assert.ok(observed.indexOf('first:params') >= 4);
	assert.equal(inventory.hasParametricEq, false);
	assert.equal(inventory.latencyFrames, 144);
	assert.deepEqual(inventory.effects.map(effect => [effect.id, effect.type, effect.latencyFrames]), [
		['first', 'limiter', 48], ['second', 'limiter', 96],
	]);
	assert.equal(rack[0], first);
	assert.equal(rack[1], second);
	assert.notEqual(inventory.effects[0], first);
});

test('caller-owned filter and selected-array map retain their original authority', () => {
	const input: EngineEffect = { id: 'input', type: 'unsupported' };
	const rack = [input];
	const selected = [input];
	const compiled: ParallelStackEffect[] = [{ id: 'custom', type: 'parametric-eq', params: {}, latencyFrames: 7, stateBytes: 1 }];
	let mapCalls = 0;
	Object.defineProperty(rack, 'filter', { value: () => selected });
	Object.defineProperty(selected, 'map', { value: () => { mapCalls += 1; return compiled; } });
	const result = compileParallelStackEffectInventory(rack, 48_000, 2);
	assert.equal(mapCalls, 1);
	assert.equal(result.effects, compiled);
	assert.equal(result.hasParametricEq, true);
	assert.equal(result.latencyFrames, 7);
	assert.equal(selected[0], input);
	assert.equal(rack[0], input);
});

test('effect compilation errors preserve authored order after full flag admission', () => {
	const flags: string[] = [];
	const rack = ['first', 'second'].map(id => ({ id, type: id,
		get enabled() { flags.push(id); return true; },
	}));
	assert.throws(() => compileParallelStackEffectInventory(rack, 48_000, 2), { message: 'Parallel stacks do not support effect first.' });
	assert.deepEqual(flags, ['first', 'second']);
});
