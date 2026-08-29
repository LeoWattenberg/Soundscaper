/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperOpenFxFrameGraphNativeMedia as createGraph,
} from '../src/framescaper/editor-openfx-frame-graph-native-media.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

type Data = Record<string, unknown>;

function options(overrides: Data = {}): never {
	return {
		plan: unifiedExactPlanFixture(14),
		assertCurrent: () => undefined,
		execute: async () => ({ frame: null }),
		...overrides,
	} as unknown as never;
}

function graph(overrides: Data = {}): Data {
	return createGraph(options(overrides)) as unknown as Data;
}

function request(overrides: Data = {}): never {
	return {
		context: 'filter',
		targetId: 'clip-out',
		outputOrdinal: 0,
		primary: null,
		namedPlanes: [],
		signal: new AbortController().signal,
		...overrides,
	} as unknown as never;
}

function apply(built: Data, overrides: Data = {}): Promise<Data> {
	return (built.apply as (value: unknown) => Promise<Data>)(request(overrides));
}

test('a frame graph exposes exactly its apply port', () => {
	assert.deepEqual(Object.keys(graph()), ['apply']);
});

test('a frame graph is bound to a V14 render plan', () => {
	assert.throws(() => graph({ plan: {} }), /requires a V14 plan/u);
	assert.throws(
		() => graph({ plan: unifiedExactPlanFixture(13) }),
		/requires a V14 plan/u,
	);
});

test('a frame graph requires both of its authority ports', () => {
	assert.throws(
		() => createGraph({ plan: unifiedExactPlanFixture(14), execute: async () => ({}) } as never),
		/requires exact authority ports/u,
	);
	assert.throws(
		() => createGraph({ plan: unifiedExactPlanFixture(14), assertCurrent: () => undefined } as never),
		/requires exact authority ports/u,
	);
});

test('frozen frame recovery must be a function when it is supplied at all', () => {
	assert.throws(() => graph({ resolveFrozenFrame: 1 }), /frozen recovery must be a function/u);
	assert.doesNotThrow(() => graph({ resolveFrozenFrame: async () => null }));
});

test('a target the plan carries no OpenFX node for passes the frame through', async () => {
	const applied = await apply(graph(), { targetId: 'target-with-no-openfx' });

	assert.deepEqual(
		Object.keys(applied),
		['frame', 'dispositions', 'reportsDegradation'],
	);
	assert.deepEqual(applied.dispositions, []);
	assert.equal(applied.reportsDegradation, false);
});

test('every application reasserts that the render is still current', async () => {
	let asserted = 0;
	const built = graph({ assertCurrent: () => { asserted += 1; } });

	await apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 0 });
	await apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 1 });

	assert.equal(asserted, 2);
});

test('replaying an output ordinal is forbidden so a render stays deterministic', async () => {
	const built = graph();
	await apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 0 });

	await assert.rejects(
		() => apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 0 }),
		/frame ordinal replay is forbidden/u,
	);
	await assert.doesNotReject(
		() => apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 1 }),
		'advancing to a fresh ordinal is the ordinary case',
	);
});

test('a graph told to allow repeated frames admits the same ordinal twice', async () => {
	const built = graph({ allowRepeatedFrames: true });

	await apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 0 });

	await assert.doesNotReject(
		() => apply(built, { targetId: 'target-with-no-openfx', outputOrdinal: 0 }),
		'preview scrubbing revisits frames, so the guard is opt-out rather than absolute',
	);
});

test('an application checkpoint must name a context, ordinal and signal', async () => {
	const built = graph();

	await assert.rejects(
		() => apply(built, { context: 'nonsense' }),
		/frame checkpoint is invalid/u,
	);
	await assert.rejects(
		() => apply(built, { outputOrdinal: -1 }),
		/frame checkpoint is invalid/u,
	);
	await assert.rejects(
		() => apply(built, { signal: undefined }),
		/frame checkpoint is invalid/u,
	);
});

test('an application on a cancelled signal surfaces the caller abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the frame');
	controller.abort(reason);

	await assert.rejects(() => apply(graph(), { signal: controller.signal }), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
});
