/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	consumeVideoProxyCandidateObservation,
	observeVideoProxyCandidate,
	type VideoProxyCandidateGeneratorPort,
	type VideoProxyCandidateObserver,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import {
	createFramescaperNativeProResProxyCandidateObserverV31,
	type DeferredFramescaperNativeProResProxyCandidateModuleV31,
} from '../src/framescaper/editor-native-prores-proxy-candidate-v31.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';

const ORIGINAL_BYTES = new Uint8Array([8, 6, 7, 5]);
const CANDIDATE_BYTES = new Uint8Array([3, 0, 9]);

test('F31 creates an eligible native proxy observer synchronously without loading execution', () => {
	let loads = 0;
	const load = async (): Promise<DeferredFramescaperNativeProResProxyCandidateModuleV31> => {
		loads += 1;
		throw new Error('execution must stay deferred');
	};
	assert.ok(createFramescaperNativeProResProxyCandidateObserverV31(options(), load));
	assert.equal(createFramescaperNativeProResProxyCandidateObserverV31({
		...options(), scope: {},
	}, load), null);
	assert.equal(createFramescaperNativeProResProxyCandidateObserverV31({
		...options(), composition: { runtime: null },
	}, load), null);
	assert.equal(loads, 0);
});

test('concurrent and repeated F31 proxy generations share one deferred execution factory', async () => {
	let loads = 0;
	let creations = 0;
	let runs = 0;
	let loadedProfile: unknown = null;
	const release = deferred<void>();
	const observer = createFramescaperNativeProResProxyCandidateObserverV31(
		options(),
		async () => {
			loads += 1;
			await release.promise;
			return executionModule((executionOptions) => {
				creations += 1;
				loadedProfile = executionOptions.profile;
				return generator(async () => {
					runs += 1;
					return candidate();
				});
			});
		},
	);
	assert.ok(observer);
	const first = observe(observer);
	const second = observe(observer);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(loads, 1);
	release.resolve();
	await Promise.all([first, second]);
	await observe(observer);

	assert.equal(loadedProfile, FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE);
	assert.deepEqual({ loads, creations, runs }, { loads: 1, creations: 1, runs: 3 });
});

test('F31 proxy execution initialization failure is shared and retryable', async () => {
	const failure = new Error('native proxy execution unavailable');
	let loads = 0;
	let creations = 0;
	const observer = createFramescaperNativeProResProxyCandidateObserverV31(
		options(),
		async () => {
			loads += 1;
			if (loads === 1) throw failure;
			return executionModule(() => {
				creations += 1;
				return generator(async () => candidate());
			});
		},
	);
	assert.ok(observer);
	const settled = await Promise.allSettled([observe(observer), observe(observer)]);
	assert.deepEqual(settled.map(({ status }) => status), ['rejected', 'rejected']);
	for (const result of settled) {
		assert.equal(result.status === 'rejected' ? result.reason : null, failure);
	}
	assert.deepEqual({ loads, creations }, { loads: 1, creations: 0 });

	await observe(observer);
	await observe(observer);
	assert.deepEqual({ loads, creations }, { loads: 2, creations: 1 });
});

test('ordinary F31 proxy generation failures retain loaded execution', async () => {
	const failure = new Error('native proxy queue rejected generation');
	let loads = 0;
	let creations = 0;
	let runs = 0;
	const observer = createFramescaperNativeProResProxyCandidateObserverV31(
		options(),
		async () => {
			loads += 1;
			return executionModule(() => {
				creations += 1;
				return generator(async () => {
					runs += 1;
					if (runs === 1) throw failure;
					return candidate();
				});
			});
		},
	);
	assert.ok(observer);
	await assert.rejects(observe(observer), (error) => error === failure);
	await observe(observer);
	assert.deepEqual({ loads, creations, runs }, { loads: 1, creations: 1, runs: 2 });
});

test('an invalid deferred F31 proxy generator is rejected and retried', async () => {
	let loads = 0;
	const observer = createFramescaperNativeProResProxyCandidateObserverV31(
		options(),
		async () => {
			loads += 1;
			return executionModule(() => loads === 1 ? Object.freeze({
				id: 'unexpected-native-generator', version: 1,
				generate: async () => candidate(),
			}) : generator(async () => candidate()));
		},
	);
	assert.ok(observer);
	await assert.rejects(
		observe(observer),
		/Deferred native proxy execution returned an invalid generator\./u,
	);
	await observe(observer);
	assert.equal(loads, 2);
});

test('the F31 proxy wrapper owns eligibility without a static V28 implementation edge', () => {
	const source = readFileSync(new URL(
		'../src/framescaper/editor-native-prores-proxy-candidate-v31.ts',
		import.meta.url,
	), 'utf8');
	assert.match(
		source,
		/import\('\.\/editor-native-prores-proxy-candidate-v28\.ts'\)/u,
	);
	assert.doesNotMatch(
		source,
		/import \{[^}]+\} from '\.\/editor-native-prores-proxy-candidate-v28\.ts'/su,
	);
	assert.doesNotMatch(source, /editor-project-unified-render-plan-v28/u);
});

function options(): Parameters<typeof createFramescaperNativeProResProxyCandidateObserverV31>[0] {
	return {
		profile: FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		getProject: () => Object.freeze({}),
		composition: {
			runtime: {
				probeVideoTiming: async () => ({
					nominalRate: { num: 24, den: 1 }, timescale: 24,
					presentationTicks: [0n, 1n, 2n], finalFrameDurationTicks: 1n,
				}),
			},
		},
		scope: desktopScope(),
	};
}

function desktopScope(): object {
	const bridge = Object.freeze({
		capabilities: async () => ({}), preferences: async () => ({}),
		snapshot: async () => ({ queue: [] }), control: async () => ({}),
		reorder: async () => [], remove: async () => true,
		enqueue: async () => ({}), selectRoot: async () => null,
		revalidateRoot: async () => true, claimProxyOutput: async () => ({}),
		readProxyOutput: async () => new Uint8Array(), releaseProxyOutput: async () => true,
	});
	return { window: { framescaperDesktop: { v1: { nativeServices: bridge } } } };
}

function executionModule(
	create: DeferredFramescaperNativeProResProxyCandidateModuleV31[
		'createFramescaperNativeProResProxyGeneratorV28'
	],
): DeferredFramescaperNativeProResProxyCandidateModuleV31 {
	return Object.freeze({ createFramescaperNativeProResProxyGeneratorV28: create });
}

function generator(
	generate: VideoProxyCandidateGeneratorPort['generate'],
): VideoProxyCandidateGeneratorPort {
	return Object.freeze({
		id: 'framescaper-native-media-host', version: 1, generate,
	});
}

async function observe(observer: VideoProxyCandidateObserver): Promise<void> {
	const original = new Blob([ORIGINAL_BYTES], { type: 'video/mp4' });
	const observation = await observeVideoProxyCandidate(observer, {
		original,
		identity: {
			authority: 'owned', projectId: 'project', sourceId: 'source', storageKey: 'source',
			mimeType: original.type, byteLength: original.size, sha256: digest(ORIGINAL_BYTES),
			generationToken: 'project-generation',
		},
		originalSourceId: 'source',
		assertCurrent: () => undefined,
	});
	consumeVideoProxyCandidateObservation(observation);
}

function candidate(): Blob {
	return new Blob([CANDIDATE_BYTES], { type: 'video/quicktime' });
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}> {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
