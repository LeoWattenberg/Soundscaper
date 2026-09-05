/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeProResProxyCandidateObserver as createObserver,
} from '../src/framescaper/editor-native-prores-proxy-candidate.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	assertVideoProxyCandidateObserver,
	consumeVideoProxyCandidateObservation,
	observeVideoProxyCandidate,
	type VideoProxyCandidateObservationMaterial,
	type VideoProxyCandidateObserver,
} from '../src/common/editor/video-proxy-candidate-observation.ts';

type Data = Record<string, unknown>;

interface GenerateCall {
	readonly receiver: unknown;
	readonly identity: Data;
	readonly recipe: Data;
	readonly generation: Data;
}

interface DeferredModule {
	readonly createFramescaperNativeProResProxyGenerator: (options: unknown) => unknown;
}

interface Harness {
	readonly attempts: unknown[];
	readonly options: Data[];
	readonly calls: GenerateCall[];
	readonly loader: () => Promise<DeferredModule>;
	loadError: unknown;
	gate: Promise<void> | null;
	generate: ((call: GenerateCall) => unknown) | null;
	generatorFor: ((options: unknown) => unknown) | null;
}

const BRIDGE_REQUIRED = Object.freeze(['snapshot', 'control', 'reorder', 'remove']);
const PROXY_METHODS = Object.freeze([
	'enqueue', 'selectRoot', 'revalidateRoot',
	'claimProxyOutput', 'readProxyOutput', 'releaseProxyOutput',
]);

const PROBE_RESULT = Object.freeze({
	nominalRate: Object.freeze({ num: 24, den: 1 }),
	timescale: 24,
	presentationTicks: Object.freeze([0n, 1n, 2n]),
	finalFrameDurationTicks: 1n,
});

const TIMING_PROBE = Object.freeze({
	id: 'helper-probe',
	probe: () => Promise.resolve(PROBE_RESULT),
});

function bridge(): Data {
	return Object.fromEntries([...BRIDGE_REQUIRED, ...PROXY_METHODS]
		.map((method) => [method, () => Promise.resolve(null)]));
}

function scope(services: Data = bridge()): Data {
	return { framescaperDesktop: { v1: { nativeServices: services } } };
}

function project(): Data {
	return { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 1 };
}

function candidateBlob(): Blob {
	return new Blob([new Uint8Array([9, 8, 7])], { type: 'video/quicktime' });
}

/** A deferred module whose load, factory and generate calls are all observable. */
function harness(): Harness {
	const self: Harness = {
		attempts: [],
		options: [],
		calls: [],
		loader: () => load(),
		loadError: undefined,
		gate: null,
		generate: null,
		generatorFor: null,
	};
	async function load(): Promise<DeferredModule> {
		self.attempts.push(null);
		if (self.gate) await self.gate;
		if (self.loadError !== undefined) throw self.loadError;
		return { createFramescaperNativeProResProxyGenerator: factory };
	}
	function factory(options: unknown): unknown {
		self.options.push(options as Data);
		if (self.generatorFor) return self.generatorFor(options);
		return {
			id: 'framescaper-native-media-host',
			version: 1,
			generate(this: unknown, _original: Blob, identity: Data, recipe: Data, generation: Data) {
				const call: GenerateCall = { receiver: this, identity, recipe, generation };
				self.calls.push(call);
				return self.generate ? self.generate(call) : candidateBlob();
			},
		};
	}
	return self;
}

function observer(overrides: Data = {}, loader?: Harness['loader']): unknown {
	return createObserver({
		profile: PROFILE,
		getProject: project,
		scope: scope(),
		composition: { runtime: {}, helperTimingProbe: TIMING_PROBE },
		...overrides,
	} as never, loader as never);
}

async function observe(
	value: unknown,
	settings: Readonly<{ signal?: AbortSignal; assertCurrent?: () => void }> = {},
): Promise<VideoProxyCandidateObservationMaterial> {
	const original = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' });
	const observation = await observeVideoProxyCandidate(value as VideoProxyCandidateObserver, {
		original,
		identity: {
			authority: 'owned', projectId: 'project-1', sourceId: 'source-1',
			storageKey: 'original-1', mimeType: original.type, byteLength: original.size,
			sha256: 'a'.repeat(64), generationToken: 'generation-1',
		},
		originalSourceId: 'source-1',
		assertCurrent: settings.assertCurrent ?? (() => undefined),
		...(settings.signal ? { signal: settings.signal } : {}),
	});
	return consumeVideoProxyCandidateObservation(observation);
}

function firstCall(calls: readonly GenerateCall[]): GenerateCall {
	const [first] = calls;
	if (!first) throw new Error('the deferred generator was never invoked');
	return first;
}

function firstOptions(options: readonly Data[]): Data {
	const [first] = options;
	if (!first) throw new Error('the deferred module was never loaded');
	return first;
}

test('a desktop bridge and a timing probe compose an authenticated observer without loading anything', () => {
	const deferred = harness();

	const composed = observer({}, deferred.loader);

	assert.notEqual(composed, null);
	assert.doesNotThrow(() => assertVideoProxyCandidateObserver(composed));
	assert.equal(deferred.attempts.length, 0, 'composition must never pay for the generator module');
});

test('composing an observer refuses every profile but the authenticated Framescaper runtime profile', () => {
	assert.throws(
		() => observer({ profile: {} }),
		/authenticated Framescaper 1\.0 runtime profile is required/u,
	);
	// A structural copy carries the same fields and still is not the authority.
	assert.throws(() => observer({ profile: { ...PROFILE } }), TypeError);
	assert.throws(() => observer({ profile: undefined }), TypeError);
});

test('composing an observer requires a project authority it can actually call', () => {
	assert.throws(
		() => observer({ getProject: undefined }),
		/Native proxy composition requires its project authority/u,
	);
	assert.throws(
		() => observer({ getProject: 'not-a-function' }),
		/Native proxy composition requires its project authority/u,
	);
	assert.throws(() => createObserver(null as never), TypeError);
});

test('a build whose desktop bridge is absent or incomplete composes no observer at all', () => {
	assert.equal(observer({ scope: {} }), null);
	assert.equal(observer({ scope: { framescaperDesktop: { v1: {} } } }), null);
	for (const method of [...BRIDGE_REQUIRED, ...PROXY_METHODS]) {
		const partial = bridge();
		delete partial[method];
		assert.equal(
			observer({ scope: scope(partial) }),
			null,
			`a bridge missing ${method} cannot generate a native proxy`,
		);
	}
	// An optional port that is present but not callable fails the bridge closed.
	assert.equal(observer({ scope: scope({ ...bridge(), capabilities: 1 }) }), null);
});

test('a build with no timing probe composes nothing, and either probe alone is enough', () => {
	assert.equal(observer({ composition: { runtime: {} } }), null);
	assert.equal(observer({ composition: { runtime: null } }), null);
	assert.equal(observer({ composition: {} }), null);
	assert.notEqual(observer({ composition: { runtime: {}, helperTimingProbe: TIMING_PROBE } }), null);
	assert.notEqual(
		observer({ composition: { runtime: { probeVideoTiming: TIMING_PROBE.probe } } }),
		null,
	);
});

test('the deferred module is loaded once, on the first candidate, and answers every later one', async () => {
	const deferred = harness();
	const composed = observer({}, deferred.loader);

	const first = await observe(composed);
	const second = await observe(composed);

	assert.equal(deferred.attempts.length, 1, 'the module is memoized across candidates');
	assert.equal(deferred.calls.length, 2);
	assert.deepEqual(new Uint8Array(await first.candidate.arrayBuffer()), new Uint8Array([9, 8, 7]));
	assert.deepEqual(new Uint8Array(await second.candidate.arrayBuffer()), new Uint8Array([9, 8, 7]));
});

test('an observed candidate carries the native host generator and the ProRes Proxy recipe identity', async () => {
	const deferred = harness();

	const material = await observe(observer({}, deferred.loader));

	assert.equal(material.generatorId, 'framescaper-native-media-host');
	assert.equal(material.generatorVersion, 1);
	assert.equal(material.recipeId, 'framescaper-native-prores-proxy-mov-v1');
	assert.equal(material.recipeVersion, 1);
	assert.equal(material.mimeType, 'video/quicktime');
	assert.equal(material.byteLength, 3);
	assert.equal(material.timingBackendId, 'helper-probe');
});

test('the deferred generator is invoked as itself with the maintained recipe and the original identity', async () => {
	const deferred = harness();
	const built: Data[] = [];
	deferred.generatorFor = () => {
		const generator: Data = {
			id: 'framescaper-native-media-host',
			version: 1,
			generate(this: unknown, _original: Blob, identity: Data, recipe: Data, generation: Data) {
				deferred.calls.push({ receiver: this, identity, recipe, generation });
				return candidateBlob();
			},
		};
		built.push(generator);
		return generator;
	};
	const signal = new AbortController().signal;

	await observe(observer({}, deferred.loader), { signal });

	const call = firstCall(deferred.calls);
	assert.equal(call.receiver, built[0], 'the loaded generator is its own generate receiver');
	assert.deepEqual(call.recipe, { id: 'framescaper-native-prores-proxy-mov-v1', version: 1 });
	assert.equal(call.identity.sourceId, 'source-1');
	assert.equal(call.identity.sha256, 'a'.repeat(64));
	assert.equal(call.generation.signal, signal);
	assert.equal(typeof call.generation.assertCurrent, 'function');
});

test('the execution options carry the authenticated profile, the resolved bridge, and no invented poll', async () => {
	const services = bridge();
	const deferred = harness();

	await observe(observer({ scope: scope(services) }, deferred.loader));

	const options = firstOptions(deferred.options);
	assert.deepEqual(Object.keys(options), ['profile', 'getProject', 'bridge']);
	assert.equal(options.profile, PROFILE);
	assert.equal(options.bridge, services, 'the generator receives the very bridge the scope exposed');
	assert.equal(Object.isFrozen(options), true);
});

test('a supplied poll interval is forwarded to the deferred generator unchanged', async () => {
	const waitForPoll = () => Promise.resolve();
	const deferred = harness();

	await observe(observer({ waitForPoll }, deferred.loader));

	const options = firstOptions(deferred.options);
	assert.deepEqual(Object.keys(options), ['profile', 'getProject', 'bridge', 'waitForPoll']);
	assert.equal(options.waitForPoll, waitForPoll);
});

test('the deferred generator only ever sees the project through the native-media foundation shaping', async () => {
	const raw = () => ({ schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1' });
	const deferred = harness();

	await observe(observer({ getProject: raw }, deferred.loader));

	const options = firstOptions(deferred.options);
	assert.notEqual(options.getProject, raw, 'the raw project authority is never handed on');
	// The raw authority answers happily; only the shaped view refuses an
	// unreconcilable project, which is how the shaping proves it is applied.
	assert.doesNotThrow(raw);
	assert.throws(
		() => (options.getProject as () => unknown)(),
		/featureRequirements must be an object/u,
	);
});

test('candidates raised while the deferred load is still in flight share that single load', async () => {
	const deferred = harness();
	let release = () => undefined as void;
	deferred.gate = new Promise<void>((resolve) => { release = () => { resolve(); }; });
	const composed = observer({}, deferred.loader);

	const both = Promise.all([observe(composed), observe(composed)]);
	release();
	const [first, second] = await both;

	assert.equal(deferred.attempts.length, 1);
	assert.equal(deferred.calls.length, 2);
	assert.equal(first?.generatorId, 'framescaper-native-media-host');
	assert.equal(second?.generatorId, 'framescaper-native-media-host');
});

test('a failed deferred load rejects that candidate and is retried by the next one', async () => {
	const deferred = harness();
	const failure = new Error('the native media host module is unavailable');
	deferred.loadError = failure;
	const composed = observer({}, deferred.loader);

	await assert.rejects(observe(composed), (error: unknown) => error === failure);
	assert.equal(deferred.attempts.length, 1);

	deferred.loadError = undefined;
	const material = await observe(composed);

	assert.equal(deferred.attempts.length, 2, 'a failed load must not be memoized');
	assert.equal(material.generatorId, 'framescaper-native-media-host');
});

test('a deferred module that answers anything but the exact native host port is refused', async () => {
	const deferred = harness();
	const composed = observer({}, deferred.loader);
	const rejected: readonly unknown[] = [
		null,
		'framescaper-native-media-host',
		[],
		{ id: 'framescaper-native-media-host', version: 1 },
		{ id: 'framescaper-native-media-host', version: 1, generate: () => candidateBlob(), extra: 1 },
		{ id: 'framescaper-native-media-host', version: 1, other: () => candidateBlob() },
		{ id: 'some-other-host', version: 1, generate: () => candidateBlob() },
		{ id: 'framescaper-native-media-host', version: 2, generate: () => candidateBlob() },
		{ id: 'framescaper-native-media-host', version: 1, generate: 'not-a-function' },
	];

	for (const [index, value] of rejected.entries()) {
		deferred.generatorFor = () => value;
		await assert.rejects(
			observe(composed),
			/Deferred native proxy execution returned an invalid generator/u,
			`entry ${String(index)} must not pass as the native host generator`,
		);
	}

	// Every refusal is a failed load, so none of them is remembered.
	assert.equal(deferred.attempts.length, rejected.length);
	assert.equal(deferred.calls.length, 0);
});

test('a candidate that fails to generate keeps the already-loaded module for the next one', async () => {
	const deferred = harness();
	const failure = new Error('the native queue refused the job');
	deferred.generate = () => { throw failure; };
	const composed = observer({}, deferred.loader);

	await assert.rejects(observe(composed), (error: unknown) => error === failure);

	deferred.generate = null;
	const material = await observe(composed);

	assert.equal(deferred.attempts.length, 1, 'a generation failure is not a load failure');
	assert.equal(deferred.calls.length, 2);
	assert.equal(material.generatorId, 'framescaper-native-media-host');
});

test('a candidate cancelled before it is generated never loads the deferred module', async () => {
	const deferred = harness();
	const controller = new AbortController();
	const reason = new Error('the proxy relationship moved on');
	controller.abort(reason);

	await assert.rejects(
		observe(observer({}, deferred.loader), { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(deferred.attempts.length, 0);
	assert.equal(deferred.calls.length, 0);
});

test('the currency hook handed to the deferred generator cancels a candidate mid-generation', async () => {
	const deferred = harness();
	const reason = new Error('the proxy relationship was replaced');
	let checks = 0;
	// The observer asserts currency once before generating; the generator's own
	// call is the second, and is the one that must be able to stop the work.
	const assertCurrent = () => { checks += 1; if (checks > 1) throw reason; };
	deferred.generate = (call) => {
		(call.generation.assertCurrent as () => void)();
		return candidateBlob();
	};

	await assert.rejects(
		observe(observer({}, deferred.loader), { assertCurrent }),
		(error: unknown) => error === reason,
	);
	assert.equal(deferred.calls.length, 1);
	assert.equal(checks, 2);
});

test('the shipped loader resolves the real native ProRes Proxy generator', async () => {
	// No loader override: this drives the module's own dynamic import, and the
	// real generator is what asks the shaped project authority for its project.
	const composed = observer({ getProject: () => null });

	await assert.rejects(
		observe(composed),
		/Framescaper assistance project must be an object/u,
	);
});
