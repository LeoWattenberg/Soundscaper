/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeProResProxyCandidateObserver as createObserver,
	createFramescaperNativeProResProxyGenerator as createGenerator,
} from '../src/framescaper/editor-native-prores-proxy-generator.ts';

type Data = Record<string, unknown>;

const BRIDGE_REQUIRED = Object.freeze(['snapshot', 'control', 'reorder', 'remove']);
const PROXY_METHODS = Object.freeze([
	'enqueue', 'selectRoot', 'revalidateRoot',
	'claimProxyOutput', 'readProxyOutput', 'releaseProxyOutput',
]);

const TIMING_PROBE = Object.freeze({ id: 'helper-probe', probe: async () => null });

function bridge(): Data {
	return Object.fromEntries(
		[...BRIDGE_REQUIRED, ...PROXY_METHODS].map((method) => [method, async () => null]),
	);
}

function scope(services: Data = bridge()): Data {
	return { framescaperDesktop: { v1: { nativeServices: services } } };
}

function getProject(): Data {
	return { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 1 };
}

function observer(overrides: Data = {}): unknown {
	return createObserver({
		profile: {},
		getProject,
		scope: scope(),
		composition: { runtime: {}, helperTimingProbe: TIMING_PROBE },
		...overrides,
	} as never);
}

test('an observer is composed when a proxy bridge and a timing probe are both present', () => {
	assert.notEqual(observer(), null);
});

test('an observer declines when no desktop bridge is reachable from its scope', () => {
	assert.equal(observer({ scope: {} }), null);
});

test('an observer declines when the bridge lacks any proxy execution port', () => {
	for (const method of PROXY_METHODS) {
		const partial = bridge();
		delete partial[method];
		assert.equal(
			observer({ scope: scope(partial) }),
			null,
			`a bridge missing ${method} cannot generate a proxy`,
		);
	}
});

test('an observer declines when no timing probe can measure the source', () => {
	assert.equal(
		observer({ composition: { runtime: {} } }),
		null,
		'a proxy that cannot be timed must not be offered',
	);
});

test('an observer requires its project authority', () => {
	assert.throws(() => createObserver({ profile: {}, scope: scope() } as never), TypeError);
	assert.throws(() => createObserver(null as never), TypeError);
	assert.throws(
		() => createObserver({ profile: {}, getProject: 'not-a-function', scope: scope() } as never),
		TypeError,
	);
});

test('a generator exposes its recipe identity and generate port', () => {
	const generator = createGenerator({ profile: {}, getProject, bridge: bridge() } as never);

	assert.deepEqual(Object.keys(generator), ['id', 'version', 'generate']);
	assert.equal(typeof (generator as unknown as Data).generate, 'function');
});

test('a generator requires its exact execution ports', () => {
	assert.throws(
		() => createGenerator({ profile: {}, bridge: bridge() } as never),
		/requires its exact execution ports/u,
	);
	assert.throws(
		() => createGenerator({ profile: {}, getProject, bridge: {} } as never),
		/requires its exact execution ports/u,
	);
	assert.throws(
		() => createGenerator({ profile: {}, getProject, bridge: bridge(), waitForPoll: 1 } as never),
		/requires its exact execution ports/u,
	);
	assert.throws(() => createGenerator(null as never), /requires its exact execution ports/u);
});

test('a generator refuses a bridge missing any single proxy port', () => {
	for (const method of PROXY_METHODS) {
		const partial = bridge();
		delete partial[method];
		assert.throws(
			() => createGenerator({ profile: {}, getProject, bridge: partial } as never),
			/requires its exact execution ports/u,
		);
	}
});
