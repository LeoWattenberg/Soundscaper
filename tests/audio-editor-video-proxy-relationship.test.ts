/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES,
	VIDEO_PROXY_CANDIDATE_MAXIMUM_TIMING_PROBES,
	createVideoProxyCandidateObserver,
	type VideoProxyCandidateObserver,
	type VideoProxyCandidateObserverDependencies,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import {
	assertVideoProxyRelationshipCurrent,
	createVideoProxyRelationshipAuthority,
	proveVideoProxyRelationship,
	videoProxyRelationshipInfo,
	type VideoProxyRelationship,
	type VideoProxyRelationshipAuthority,
	type VideoProxyRelationshipAuthorityDependencies,
} from '../src/common/editor/video-proxy-relationship.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	ORIGINAL_SHA256,
	ORIGINAL_SOURCE_ID,
	PROJECT_ID,
	bindFixtureTiming,
	createFinalMutationAuthority,
	createNonEnumerableReleaseAuthority,
	createReceiverGuardedRelationshipAuthority,
	createSplitReadProjectAuthority,
	createVideoProxyFixture,
	deferred,
	exactProbeResult,
	retimeCurve,
	videoProxyProject,
} from './helpers/video-proxy-relationship-fixtures.ts';

const CANDIDATE_SOURCE_URL = new URL(
	'../src/common/editor/video-proxy-candidate-observation.ts',
	import.meta.url,
);
const RELATIONSHIP_SOURCE_URL = new URL(
	'../src/common/editor/video-proxy-relationship.ts',
	import.meta.url,
);

test('prepares fresh frozen exact relationships with opaque source bytes and ignores proxy audio', async () => {
	const adversarialCandidate = new class extends Blob {
		override get size(): number { throw new Error('subclass size getter must not run'); }
		override get type(): string { throw new Error('subclass type getter must not run'); }
		override slice(): Blob { throw new Error('subclass slice must not run'); }
	}(['canonical-proxy'], { type: 'video/webm' });
	const fixture = createVideoProxyFixture({ candidate: adversarialCandidate });
	(fixture.project().sources as Record<string, unknown>[])[0]!.opaqueBytes = new Uint8Array([1, 2, 3]);

	const first = await proveVideoProxyRelationship(fixture.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	assert.strictEqual(fixture.seen.probeCandidate, first.candidate);
	const second = await proveVideoProxyRelationship(fixture.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	const firstInfo = videoProxyRelationshipInfo(first.relationship);
	const secondInfo = videoProxyRelationshipInfo(second.relationship);
	const expectedSha256 = await digestMediaContent(first.candidate);

	assert.equal(first.candidate instanceof Blob, true);
	assert.notStrictEqual(first.candidate, adversarialCandidate);
	assert.strictEqual(fixture.seen.probeCandidate, second.candidate);
	assert.deepEqual(firstInfo, {
		kind: 'video-proxy-relationship',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		projectId: PROJECT_ID,
		originalSourceId: ORIGINAL_SOURCE_ID,
		originalSha256: ORIGINAL_SHA256,
		originalAuthorityKind: 'owned',
		candidateSha256: expectedSha256,
		candidateByteLength: first.candidate.size,
		candidateMimeType: 'video/webm',
		generatorId: 'fixture-generator',
		generatorVersion: 3,
		recipeId: 'fixture-proxy-recipe',
		recipeVersion: 7,
		timingBackendId: 'exact-probe-1',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 4,
		boundaryCount: 5,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	});
	assert.deepEqual(secondInfo, firstInfo);
	assert.notStrictEqual(second.relationship, first.relationship);
	assert.notStrictEqual(secondInfo, firstInfo);
	assertDeepFrozen(first);
	assertDeepFrozen(first.relationship);
	assertDeepFrozen(firstInfo);
	assert.equal(fixture.counters.originalReleases, 2);
	assert.deepEqual(fixture.seen.generatorRecipe, { id: 'fixture-proxy-recipe', version: 7 });
	assert.equal(Object.hasOwn(firstInfo, 'audioStreams'), false);
	assert.equal(Object.hasOwn(firstInfo, 'candidateHasAudio'), false);
});

test('admits target timeline and Project Bin retime in the source domain', async () => {
	for (const [location, project] of [
		['timeline', videoProxyProject({ timelineRetime: retimeCurve() })],
		['Project Bin', videoProxyProject({ binRetime: retimeCurve() })],
	] as const) {
		const fixture = createVideoProxyFixture({ project });
		await assert.doesNotReject(
			proveVideoProxyRelationship(fixture.authority, { sourceId: ORIGINAL_SOURCE_ID }),
			`${location} retime must not alter the source-domain relationship`,
		);
		assert.equal(fixture.counters.generatorCalls, 1);
	}
	const allowed = createVideoProxyFixture({ project: videoProxyProject({ includeUnrelatedRetime: true }) });
	const allowedPromise = proveVideoProxyRelationship(allowed.authority, { sourceId: ORIGINAL_SOURCE_ID });
	await assert.doesNotReject(allowedPromise);
});

test('rejects stale original timing and every exact timing disagreement, releasing once', async () => {
	const staleTiming = createVideoProxyFixture();
	staleTiming.setTimingOverride(bindFixtureTiming('different-source'));
	assert.throws(
		() => proveVideoProxyRelationship(staleTiming.authority, { sourceId: ORIGINAL_SOURCE_ID }),
		/timing|source|authentic|target/iu,
	);
	assert.equal(staleTiming.counters.originalReleases, 0);

	const cases = [
		['interior drift', exactProbeResult({ presentationTicks: [0n, 1n, 3n, 4n] })],
		['final drift', exactProbeResult({ finalFrameDurationTicks: 2n })],
		['count drift', exactProbeResult({ presentationTicks: [0n, 1n, 2n] })],
	] as const;
	for (const [name, probeResult] of cases) {
		const fixture = createVideoProxyFixture({ probeResult });
		await assert.rejects(
			proveVideoProxyRelationship(fixture.authority, { sourceId: ORIGINAL_SOURCE_ID }),
			/timing|source|frame|boundary|exact|conform/iu,
			name,
		);
		assert.equal(fixture.counters.originalReleases, 1, name);
	}
	const fallback = createVideoProxyFixture({ failingProbes: new Set([0]) });
	await assert.rejects(
		proveVideoProxyRelationship(fallback.authority, { sourceId: ORIGINAL_SOURCE_ID }),
		/exact|timing|probe|fallback|unavailable/iu,
	);
	assert.equal(fallback.counters.originalReleases, 1);
});

test('enforces genuine nonempty video Blob and independently reachable byte/probe caps', async () => {
	assert.equal(VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES, 512 * 1024 * 1024);
	assert.equal(VIDEO_PROXY_CANDIDATE_MAXIMUM_TIMING_PROBES, 8);
	for (const [name, fixture] of [
		['empty', createVideoProxyFixture({ candidate: new Blob([], { type: 'video/webm' }) })],
		['non-video', createVideoProxyFixture({ candidate: new Blob(['x'], { type: 'text/plain' }) })],
		['over reduced cap', createVideoProxyFixture({
			candidate: new Blob(['12345'], { type: 'video/webm' }), candidateMaximumBytes: 4,
		})],
	] as const) {
		await assert.rejects(
			proveVideoProxyRelationship(fixture.authority, { sourceId: ORIGINAL_SOURCE_ID }),
			/Blob|video|MIME|empty|byte|size|maximum|limit/iu,
			name,
		);
		assert.equal(fixture.counters.originalReleases, 1, name);
	}
	const atCap = createVideoProxyFixture({
		candidate: new Blob(['1234'], { type: 'video/webm' }), candidateMaximumBytes: 4,
	});
	assert.equal((await proveVideoProxyRelationship(atCap.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	})).candidate.size, 4);

	assert.doesNotThrow(() => createVideoProxyFixture({ probeCount: 8 }));
	assert.throws(
		() => createVideoProxyFixture({ probeCount: 9 }),
		/probe|eight|8|maximum|limit/iu,
	);
	let lengthReads = 0;
	let ownKeyReads = 0;
	let elementReads = 0;
	const bounded = createVideoProxyFixture();
	const oversizedProbes = new Proxy(
		Array.from(
			{ length: VIDEO_PROXY_CANDIDATE_MAXIMUM_TIMING_PROBES + 1 },
			() => bounded.candidateDependencies.probes[0]!,
		),
		{
			getOwnPropertyDescriptor(target, key) {
				if (key === 'length') lengthReads += 1;
				else elementReads += 1;
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			ownKeys(target) {
				ownKeyReads += 1;
				return Reflect.ownKeys(target);
			},
		},
	);
	assert.throws(
		() => createVideoProxyCandidateObserver({
			...bounded.candidateDependencies,
			probes: oversizedProbes,
		}),
		/probe|eight|8|maximum|limit/iu,
	);
	assert.deepEqual({ lengthReads, ownKeyReads, elementReads }, {
		lengthReads: 1, ownKeyReads: 0, elementReads: 0,
	});
	assert.throws(
		() => createVideoProxyFixture({ candidateMaximumBytes: VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES + 1 }),
		/byte|maximum|limit|raise/iu,
	);
});

test('captures generator and probe method receivers without retaining their raw Proxies', async () => {
	let afterCapture = false;
	let rawReceiverReads = 0;
	let generatorCalls = 0;
	let probeCalls = 0;
	function guardedReceiver<Value extends object>(target: Value): Value {
		return new Proxy(target, {
			get(value, key, receiver) {
				if (afterCapture) rawReceiverReads += 1;
				return Reflect.get(value, key, receiver);
			},
		});
	}
	const candidateObserver = createVideoProxyCandidateObserver({
		generator: guardedReceiver(Object.freeze({
			id: 'receiver-generator',
			version: 1,
			async generate(this: Readonly<{ id: string }>): Promise<unknown> {
				generatorCalls += 1;
				assert.equal(this.id, 'receiver-generator');
				return new Blob(['receiver-candidate'], { type: 'video/webm' });
			},
		})),
		recipe: Object.freeze({ id: 'receiver-recipe', version: 1 }),
		probes: Object.freeze([guardedReceiver(Object.freeze({
			id: 'receiver-probe',
			async probe(this: Readonly<{ id: string }>, input: Blob) {
				probeCalls += 1;
				assert.equal(this.id, 'receiver-probe');
				assert.equal(input instanceof Blob, true);
				return exactProbeResult();
			},
		}))]),
	});
	afterCapture = true;
	const fixture = createVideoProxyFixture();
	const authority = createVideoProxyRelationshipAuthority({
		...fixture.relationshipDependencies,
		candidateObserver,
	});
	const prepared = await proveVideoProxyRelationship(authority, { sourceId: ORIGINAL_SOURCE_ID });
	const info = videoProxyRelationshipInfo(prepared.relationship);
	assert.deepEqual({ generatorCalls, probeCalls, rawReceiverReads }, {
		generatorCalls: 1, probeCalls: 1, rawReceiverReads: 0,
	});
	assert.equal(info.generatorId, 'receiver-generator');
	assert.equal(info.timingBackendId, 'receiver-probe');
});

test('rejects project, task, source, membership, retime, and original drift after deferred generation', async () => {
	const mutations: ReadonlyArray<readonly [string, (fixture: ReturnType<typeof createVideoProxyFixture>) => void]> = [
		['project replacement', (fixture) => {
			fixture.setProject(videoProxyProject());
			fixture.advanceTask();
		}],
		['same-revision source drift', (fixture) => {
			const project = fixture.project();
			(project.sources as Record<string, unknown>[])[0]!.name = 'changed';
		}],
		['same-revision clip drift', (fixture) => {
			const project = fixture.project();
			(project.clips as Record<string, unknown>[])[0]!.title = 'changed';
		}],
		['membership drift', (fixture) => {
			const project = fixture.project();
			(project.clips as Record<string, unknown>[]).splice(0, 1);
		}],
		['retime drift', (fixture) => {
			const project = fixture.project();
			(project.clips as Record<string, unknown>[])[0]!.retimeMap = retimeCurve();
		}],
		['original generation drift', (fixture) => fixture.setOriginalCurrent(false)],
		['fingerprint drift', (fixture) => fixture.setFingerprint({ generationToken: 'generation-2' })],
	];
	for (const [name, mutate] of mutations) {
		const gate = deferred<void>();
		const fixture = createVideoProxyFixture({ generatorGate: gate });
		const result = proveVideoProxyRelationship(fixture.authority, { sourceId: ORIGINAL_SOURCE_ID });
		await waitFor(() => fixture.counters.generatorCalls === 1);
		mutate(fixture);
		gate.resolve();
		await assert.rejects(result, /current|changed|stale|project|source|target|retime|generation|fingerprint/iu, name);
		assert.equal(fixture.counters.originalReleases, 1, name);
	}

	const restoreGate = deferred<void>();
	const restored = createVideoProxyFixture({ generatorGate: restoreGate });
	const restoredResult = proveVideoProxyRelationship(restored.authority, { sourceId: ORIGINAL_SOURCE_ID });
	await waitFor(() => restored.counters.generatorCalls === 1);
	restored.advanceTask();
	restoreGate.resolve();
	await assert.rejects(restoredResult, /AbortError|current|task|changed/iu);
	assert.equal(restored.counters.originalReleases, 1);
});

test('preserves exact cancellation/fault reasons and releases exactly once', async () => {
	const cancellation = new Error('exact cancellation identity');
	const controller = new AbortController();
	controller.abort(cancellation);
	const cancelled = createVideoProxyFixture();
	assert.throws(
		() => proveVideoProxyRelationship(cancelled.authority, {
			sourceId: ORIGINAL_SOURCE_ID,
			signal: controller.signal,
		}),
		(error: unknown) => error === cancellation,
	);
	assert.deepEqual(cancelled.counters, zeroCounters());

	const fault = new Error('generator fault identity');
	const failed = createVideoProxyFixture({ generatorError: fault });
	await assert.rejects(
		proveVideoProxyRelationship(failed.authority, { sourceId: ORIGINAL_SOURCE_ID }),
		(error: unknown) => error === fault,
	);
	assert.equal(failed.counters.originalReleases, 1);
});

test('rejects a non-enumerable release lease but still releases it exactly once', async () => {
	const fixture = createVideoProxyFixture();
	let malformedReleases = 0;
	const authority = createNonEnumerableReleaseAuthority(fixture, () => { malformedReleases += 1; });
	await assert.rejects(
		proveVideoProxyRelationship(authority, { sourceId: ORIGINAL_SOURCE_ID }),
		/closed|enumerable|lease|release/iu,
	);
	assert.deepEqual({ malformedReleases, originalReleases: fixture.counters.originalReleases }, {
		malformedReleases: 1, originalReleases: 1,
	});
});

test('arbitrates operation, release, cancellation, and task failures after cleanup', async () => {
	const operation = new Error('ordinary operation failure');
	const release = new Error('ordinary release failure');
	const ordinary = createVideoProxyFixture({ generatorError: operation, releaseError: release });
	await assert.rejects(
		proveVideoProxyRelationship(ordinary.authority, { sourceId: ORIGINAL_SOURCE_ID }),
		(error: unknown) => error instanceof AggregateError
			&& error.errors.length === 2 && error.errors[0] === operation && error.errors[1] === release,
	);

	const workGate = deferred<void>();
	const workCancellation = new Error('cancelled during rejected work');
	const workController = new AbortController();
	const duringWork = createVideoProxyFixture({ generatorGate: workGate, releaseError: release });
	const workResult = proveVideoProxyRelationship(duringWork.authority, {
		sourceId: ORIGINAL_SOURCE_ID, signal: workController.signal,
	});
	await waitFor(() => duringWork.counters.generatorCalls === 1);
	workController.abort(workCancellation);
	workGate.reject(operation);
	await assert.rejects(workResult, (error: unknown) => error === workCancellation);

	const releaseGate = deferred<void>();
	const releaseCancellation = new Error('cancelled during rejected release');
	const releaseController = new AbortController();
	const duringRelease = createVideoProxyFixture({ generatorError: operation, releaseGate });
	const releaseResult = proveVideoProxyRelationship(duringRelease.authority, {
		sourceId: ORIGINAL_SOURCE_ID, signal: releaseController.signal,
	});
	await waitFor(() => duringRelease.counters.originalReleases === 1);
	releaseController.abort(releaseCancellation);
	releaseGate.reject(release);
	await assert.rejects(releaseResult, (error: unknown) => error === releaseCancellation);

	const taskGate = deferred<void>();
	const staleTask = createVideoProxyFixture({ generatorGate: taskGate });
	const taskResult = proveVideoProxyRelationship(staleTask.authority, { sourceId: ORIGINAL_SOURCE_ID });
	await waitFor(() => staleTask.counters.generatorCalls === 1);
	staleTask.advanceTask();
	taskGate.reject(operation);
	await assert.rejects(taskResult, (error: unknown) => (
		error instanceof DOMException && error.name === 'AbortError' && /task changed/iu.test(error.message)
	));
});

test('captures relationship callback receivers and detects mutation by final callbacks', async () => {
	const guardedFixture = createVideoProxyFixture();
	const guarded = createReceiverGuardedRelationshipAuthority(guardedFixture);
	await proveVideoProxyRelationship(guarded.authority, { sourceId: ORIGINAL_SOURCE_ID });
	assert.deepEqual(guarded.inspection(), {
		rawReads: 0, receiverCount: 1, frozen: true, raw: false, authorityState: false,
		leaseRawReads: 0, leaseReceiverCount: 1, leaseFrozen: true,
	});
	for (const callback of ['task', 'lease', 'resolver'] as const) {
		const fixture = createVideoProxyFixture();
		await assert.rejects(
			proveVideoProxyRelationship(createFinalMutationAuthority(fixture, callback), {
				sourceId: ORIGINAL_SOURCE_ID,
			}),
			/changed|current|invalid|snapshot|target/iu,
			callback,
		);
		assert.equal(fixture.counters.originalReleases, 1, callback);
	}
});

test('rechecks authentic relationships without regenerating and refuses every stale original fingerprint', async () => {
	const fixture = createVideoProxyFixture();
	const prepared = await proveVideoProxyRelationship(fixture.authority, { sourceId: ORIGINAL_SOURCE_ID });
	const generated = fixture.counters.generatorCalls;
	await assertVideoProxyRelationshipCurrent(
		fixture.authority,
		prepared.relationship,
		{ sourceId: ORIGINAL_SOURCE_ID },
	);
	assert.equal(fixture.counters.generatorCalls, generated);
	assert.equal(fixture.counters.originalOpens, 2);
	assert.equal(fixture.counters.originalReleases, 2);

	for (const [field, value] of [
		['authority', 'linked'],
		['projectId', 'other-project'],
		['sourceId', 'other-source'],
		['storageKey', 'other-storage'],
		['mimeType', 'video/quicktime'],
		['byteLength', 99],
		['sha256', 'ff'.repeat(32)],
		['generationToken', 'next-generation'],
	] as const) {
		const stale = createVideoProxyFixture();
		const proof = await proveVideoProxyRelationship(stale.authority, { sourceId: ORIGINAL_SOURCE_ID });
		stale.setFingerprint({ [field]: value });
		await assert.rejects(
			assertVideoProxyRelationshipCurrent(stale.authority, proof.relationship, {
				sourceId: ORIGINAL_SOURCE_ID,
			}),
			/current|changed|stale|original|fingerprint|identity|generation/iu,
			field,
		);
		assert.equal(stale.counters.originalReleases, 2, field);
	}
});

test('closes factories and requests, authenticates tokens before getter reads, and preserves inputs', async () => {
	const fixture = createVideoProxyFixture();
	const projectBefore = structuredClone(fixture.project());
	const prepared = await proveVideoProxyRelationship(fixture.authority, { sourceId: ORIGINAL_SOURCE_ID });
	assert.deepEqual(fixture.project(), projectBefore);
	const invalid = createVideoProxyFixture();
	((invalid.project().sources as Record<string, unknown>[])[0]!).evil = () => {};
	assert.throws(() => proveVideoProxyRelationship(invalid.authority, { sourceId: ORIGINAL_SOURCE_ID }),
		/JSON|scalar|serializable|project/iu);
	const split = createVideoProxyFixture();
	assert.throws(() => proveVideoProxyRelationship(createSplitReadProjectAuthority(split), {
		sourceId: ORIGINAL_SOURCE_ID,
	}), /unstable/iu);

	for (const request of [
		{ sourceId: ORIGINAL_SOURCE_ID, extra: true },
		Object.defineProperty({}, 'sourceId', {
			enumerable: true, get() { throw new Error('request getter must not run'); },
		}),
	]) {
		assert.throws(
			() => proveVideoProxyRelationship(fixture.authority, request as never),
			/closed|extra|unsupported|accessor|data property|request/iu,
		);
	}
	assert.throws(
		() => createVideoProxyCandidateObserver({
			...fixture.candidateDependencies, extra: true,
		} as unknown as VideoProxyCandidateObserverDependencies),
		/closed|extra|unsupported|factory|dependencies/iu,
	);
	assert.throws(
		() => createVideoProxyRelationshipAuthority({
			...fixture.relationshipDependencies, extra: true,
		} as unknown as VideoProxyRelationshipAuthorityDependencies),
		/closed|extra|unsupported|factory|dependencies/iu,
	);
	assert.throws(
		() => createVideoProxyRelationshipAuthority({
			...fixture.relationshipDependencies,
			candidateObserver: { ...fixture.candidateObserver } as VideoProxyCandidateObserver,
		}),
		/authentic|observer|token|brand/iu,
	);

	let proofReads = 0;
	const forgedProof = Object.freeze(Object.defineProperties({}, {
		kind: { enumerable: true, get: () => { proofReads += 1; return 'video-proxy-relationship'; } },
		version: { enumerable: true, get: () => { proofReads += 1; return 1; } },
	})) as VideoProxyRelationship;
	for (const proof of [
		{ ...prepared.relationship },
		structuredClone(prepared.relationship),
		JSON.parse(JSON.stringify(prepared.relationship)) as unknown,
		forgedProof,
		null,
	]) {
		assert.throws(
			() => videoProxyRelationshipInfo(proof as VideoProxyRelationship),
			/authentic|relationship|proof|token/iu,
		);
	}
	assert.equal(proofReads, 0);

	let authorityReads = 0;
	const forgedAuthority = Object.freeze(Object.defineProperties({}, {
		kind: { enumerable: true, get: () => { authorityReads += 1; return 'video-proxy-relationship-authority'; } },
		version: { enumerable: true, get: () => { authorityReads += 1; return 1; } },
	})) as VideoProxyRelationshipAuthority;
	assert.throws(
		() => proveVideoProxyRelationship(forgedAuthority, { sourceId: ORIGINAL_SOURCE_ID }),
		/authentic|authority|token/iu,
	);
	assert.equal(authorityReads, 0);
});

test('source pins pre-I/O admission, one exact proof, final recheck, same-Blob flow, and dormancy', async () => {
	const [candidate, relationship] = await Promise.all([
		readFile(CANDIDATE_SOURCE_URL, 'utf8'),
		readFile(RELATIONSHIP_SOURCE_URL, 'utf8'),
	]);
	assert.match(relationship, /export function proveVideoProxyRelationship\(/u);
	assert.doesNotMatch(
		relationship,
		/export async function proveVideoProxyRelationship\(/u,
		'pre-I/O target admission must throw synchronously rather than become a rejected Promise',
	);
	assert.match(relationship, /project\.clips[\s\S]*?projectBin/u);
	assert.doesNotMatch(
		relationship,
		/cannot include retimed clips/u,
		'occurrence retime is applied after source-domain proxy selection',
	);
	assert.equal(
		[...relationship.matchAll(/\bproveVideoProxyTimingConformance\s*\(/gu)].length,
		1,
		'the relationship must consume one authentic 3B-6a proof',
	);
	assert.match(relationship, /assertTaskCurrent[\s\S]*?getProject[\s\S]*?(?:fingerprint|target)/u);
	assert.doesNotMatch(
		relationship,
		/for \(const trackValue of tracks\)[\s\S]*?for \(const sequenceValue of sequences\)/u,
		'target ownership capture must not nest full track and sequence scans',
	);
	assert.match(candidate, /canonicalMediaContentBlob[\s\S]*?digestMediaContent[\s\S]*?probeVideoTiming/u);
	assert.doesNotMatch(candidate, /video-derivative|derivative-cache|VideoTimingAssetStore|publishVideoTimingAsset/u);
	assert.doesNotMatch(relationship, /video-derivative|derivative-cache|VideoTimingAssetStore|publishVideoTimingAsset/u);

	const consumers = await readFile(new URL('../src/common/editor/app.js', import.meta.url), 'utf8');
	assert.doesNotMatch(consumers, /video-proxy-(?:candidate-observation|relationship)/u);
});

function zeroCounters(): Record<string, number> {
	return {
		captureTask: 0,
		taskChecks: 0,
		timingResolutions: 0,
		originalOpens: 0,
		originalChecks: 0,
		originalReleases: 0,
		generatorCalls: 0,
		probeCalls: 0,
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempts = 0; attempts < 100; attempts += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for the deferred proxy phase.');
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
