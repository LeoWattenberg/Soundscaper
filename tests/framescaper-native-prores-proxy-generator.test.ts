/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaCapabilitySnapshotV1,
	type NativeMediaCapabilityEntryInputV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import type {
	FramescaperNativeServicesBridge,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import type {
	VideoProxyCandidateOriginalIdentity,
	VideoProxyCandidateRecipe,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperNativeProResProxyGenerator as createGenerator,
} from '../src/framescaper/editor-native-prores-proxy-generator.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;
type Poll = (signal?: AbortSignal) => Promise<void>;

const JOB_ID = 'ab'.repeat(20);
const CLAIM_ID = 'cd'.repeat(20);
const GRANT_ID = 'ef'.repeat(8);
const SOURCE_SHA256 = '12'.repeat(32);
const PROXY_BYTES = Uint8Array.from([9, 8, 7, 6, 5]);
const READ_BYTES = 1024 * 1024;
const CANCEL = Object.freeze({ jobId: JOB_ID, action: 'cancel' });
const RECIPE = Object.freeze({
	id: 'framescaper-native-prores-proxy-mov-v1', version: 1,
}) as VideoProxyCandidateRecipe;
const ORIGINAL = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'video/mp4' });
const PROJECT = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
const IDENTITY = Object.freeze({
	authority: 'owned', projectId: String(PROJECT.id), sourceId: 'video-source',
	storageKey: 'video-source', mimeType: 'video/mp4', byteLength: ORIGINAL.size,
	sha256: SOURCE_SHA256, generationToken: 'generation-1',
}) as VideoProxyCandidateOriginalIdentity;
const DESTINATION = /^\.framescaper-native-proxies\/[a-f0-9]{16}-1212121212121212-[a-f0-9]{32}\.mov$/u;

interface World {
	readonly log: string[]; readonly enqueued: Data[]; readonly reads: Data[];
	readonly controls: Data[]; readonly polls: (AbortSignal | undefined)[];
	bridge: FramescaperNativeServicesBridge;
	state: string; queue: (() => readonly unknown[]) | null;
	runtimeAvailable: boolean; nativeMediaEnabled: boolean; preferenceEnabled: boolean;
	capabilitySnapshot: unknown; root: unknown; revalidate: unknown;
	enqueueResult: unknown; claim: unknown; bytes: Uint8Array;
	readResult: ((request: Data) => unknown) | null;
	release: unknown; releaseError: unknown; waitForPoll: Poll; onClaim: (() => void) | null;
}

function capability(entry: Partial<NativeMediaCapabilityEntryInputV1> = {}, masterEnabled = true): unknown {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled,
		entries: [{
			domain: 'codec', id: 'encode-mov-prores-proxy', buildSupported: true,
			probeSucceeded: true, selfTestPassed: true, userEnabled: true, ...entry,
		}],
	});
}

function queueRow(state: string, overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, jobId: JOB_ID,
		taskKind: 'proxy-generation', projectId: String(PROJECT.id),
		relativeDestination: '.framescaper-native-proxies/proxy.mov',
		state, position: 0, progress: null, attempt: 0, lastFailureCode: null, ...overrides,
	};
}

function world(): World {
	const self: World = {
		log: [], enqueued: [], reads: [], controls: [], polls: [],
		bridge: undefined as unknown as FramescaperNativeServicesBridge,
		state: 'completed', queue: null, runtimeAvailable: true, nativeMediaEnabled: true,
		preferenceEnabled: true, capabilitySnapshot: capability(),
		root: { grantId: GRANT_ID, displayName: 'Proxies', revoked: false },
		revalidate: true, enqueueResult: undefined, claim: undefined, bytes: PROXY_BYTES,
		readResult: null, release: true, releaseError: undefined, onClaim: null,
		waitForPoll: (signal?: AbortSignal) => {
			self.polls.push(signal);
			return Promise.resolve();
		},
	};
	const note = <T>(method: string, value: T): T => { self.log.push(method); return value; };
	self.bridge = {
		snapshot: () => Promise.resolve(note('snapshot', {
			snapshotVersion: 1, runtimeAvailable: self.runtimeAvailable, roots: [], watchRules: [],
			nativeMediaEnabled: self.nativeMediaEnabled,
			queue: self.queue ? self.queue() : [queueRow(self.state)],
		})),
		control: (request: Data) => {
			self.controls.push(request);
			return Promise.resolve(note('control', queueRow('cancelled')));
		},
		reorder: () => Promise.resolve([]),
		remove: () => Promise.resolve(true),
		capabilities: () => Promise.resolve(self.capabilitySnapshot),
		preferences: () => Promise.resolve({
			nativeMediaEnabled: self.preferenceEnabled, hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false, ofxConsentEnabled: false,
		}),
		selectRoot: () => Promise.resolve(note('selectRoot', self.root)),
		revalidateRoot: () => Promise.resolve(note('revalidateRoot', self.revalidate)),
		enqueue: (request: Data) => {
			self.enqueued.push(request);
			return Promise.resolve(note('enqueue',
				self.enqueueResult === undefined ? queueRow('queued') : self.enqueueResult));
		},
		claimProxyOutput: async () => {
			note('claimProxyOutput', null);
			self.onClaim?.();
			if (self.claim !== undefined) return self.claim;
			return {
				claimId: CLAIM_ID, byteLength: self.bytes.byteLength, mimeType: 'video/quicktime',
				sha256: await digestMediaContent(new Blob([self.bytes as Uint8Array<ArrayBuffer>])),
			};
		},
		readProxyOutput: (request: Data) => {
			note('readProxyOutput', self.reads.push(request));
			const offset = Number(request.offset);
			return Promise.resolve(self.readResult ? self.readResult(request)
				: self.bytes.subarray(offset, offset + Number(request.length)));
		},
		releaseProxyOutput: () => {
			note('releaseProxyOutput', null);
			if (self.releaseError !== undefined) throw self.releaseError;
			return Promise.resolve(self.release);
		},
	} as unknown as FramescaperNativeServicesBridge;
	return self;
}

interface GenerateOptions {
	getProject?: () => unknown; identity?: unknown; recipe?: unknown;
	signal?: AbortSignal; assertCurrent?: () => void; waitForPoll?: Poll | 'default';
}

function generate(self: World, options: Readonly<GenerateOptions> = {}): Promise<Blob> {
	const poll = options.waitForPoll ?? self.waitForPoll;
	const generator = createGenerator({
		profile: PROFILE, getProject: options.getProject ?? (() => PROJECT), bridge: self.bridge,
		...(poll === 'default' ? {} : { waitForPoll: poll }),
	} as never);
	return Promise.resolve(generator.generate(
		ORIGINAL,
		(options.identity ?? IDENTITY) as VideoProxyCandidateOriginalIdentity,
		(options.recipe ?? RECIPE) as VideoProxyCandidateRecipe,
		Object.freeze({
			...(options.signal ? { signal: options.signal } : {}),
			assertCurrent: options.assertCurrent ?? ((): void => undefined),
		}),
	)) as Promise<Blob>;
}

/** A project whose sources are reshaped without disturbing the shared fixture. */
function projectWith(mutate: (sources: Data[]) => void): () => unknown {
	const clone = structuredClone(PROJECT) as unknown as Data;
	mutate(clone.sources as Data[]);
	return () => clone;
}

test('a completed queue job yields the claimed ProRes Proxy bytes and releases its claim', async () => {
	const self = world();

	const proxy = await generate(self);

	assert.equal(proxy.type, 'video/quicktime');
	assert.deepEqual(new Uint8Array(await proxy.arrayBuffer()), PROXY_BYTES);
	assert.deepEqual(self.log.filter((method) => method !== 'snapshot'), [
		'selectRoot', 'revalidateRoot', 'enqueue', 'claimProxyOutput', 'readProxyOutput',
		'releaseProxyOutput',
	]);
	assert.deepEqual(self.reads, [{ claimId: CLAIM_ID, offset: 0, length: PROXY_BYTES.byteLength }]);
	assert.deepEqual(self.controls, [], 'a completed job is never cancelled after the fact');
});

test('the enqueued job carries the V14 proxy plan, the granted root and a fresh destination', async () => {
	const self = world();

	await generate(self);
	await generate(self);

	const [first, second] = self.enqueued as [Data, Data];
	assert.equal(first.taskKind, 'proxy-generation');
	assert.equal(first.planVersion, 14);
	assert.equal(first.derivedInputStageId, null);
	assert.equal(first.schemaFamily, 'framescaper');
	assert.equal(first.schemaVersion, 1);
	assert.equal(first.recoveryClass, 'atomic-restart');
	assert.equal(first.rootGrantId, GRANT_ID);
	assert.equal(first.projectId, String(PROJECT.id));
	assert.equal(first.projectRevision, Number(PROJECT.revision));
	assert.deepEqual(first.inputFingerprints, [{ sourceId: 'video-source', sha256: SOURCE_SHA256 }]);
	assert.match(String(first.planFingerprint), /^[a-f0-9]{64}$/u);
	assert.equal((JSON.parse(String(first.planPayload)) as Data).version, 14);
	assert.deepEqual(first.reservations, {
		cpuCores: 2, processTreeRssBytes: 4 * 1_024 ** 3, scratchBytes: 32 * 1_024 ** 3,
		minimumFreeBytes: 10 * 1_024 ** 3, hardwareBackend: null,
	});
	assert.match(String(first.relativeDestination), DESTINATION);
	assert.notEqual(
		first.relativeDestination, second.relativeDestination,
		'each attempt gets its own unguessable destination',
	);
});

test('a destination the platform cannot make unguessable refuses the whole generation', async () => {
	const self = world();
	const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'getRandomValues');
	Object.defineProperty(globalThis.crypto, 'getRandomValues', {
		configurable: true, writable: true, value: (bytes: Uint8Array) => bytes,
	});
	try {
		await assert.rejects(generate(self), /Secure native proxy destination randomness is unavailable/u);
	} finally {
		if (descriptor) Object.defineProperty(globalThis.crypto, 'getRandomValues', descriptor);
		else Reflect.deleteProperty(globalThis.crypto, 'getRandomValues');
	}
	assert.deepEqual(self.enqueued, [], 'no job may be queued without a private destination');
});

test('a recipe that is not the pinned ProRes Proxy identity is refused before any bridge call', async () => {
	for (const recipe of [
		{ id: 'framescaper-native-prores-proxy-mov-v1', version: 2 },
		{ id: 'some-other-proxy-recipe', version: 1 },
		{ id: 'framescaper-native-prores-proxy-mov-v1', version: 1, extra: 1 },
		{ id: 'framescaper-native-prores-proxy-mov-v1' },
	]) {
		const self = world();
		await assert.rejects(
			generate(self, { recipe }),
			/The selected native proxy recipe changed identity/u,
			JSON.stringify(recipe),
		);
		assert.deepEqual(self.log, []);
	}
});

test('a generation that is already stale never reaches the desktop bridge', async () => {
	const aborted = new AbortController();
	const reason = new Error('the proxy relationship moved on');
	aborted.abort(reason);
	const stale = world();
	const replaced = world();
	const replacement = new Error('a newer candidate replaced this one');

	await assert.rejects(
		generate(stale, { signal: aborted.signal }),
		(error: unknown) => error === reason,
	);
	await assert.rejects(
		generate(replaced, { assertCurrent: () => { throw replacement; } }),
		(error: unknown) => error === replacement,
	);
	assert.deepEqual(stale.log, []);
	assert.deepEqual(replaced.log, []);
});

test('native media that is unavailable, switched off or unopted refuses to generate', async () => {
	const cases: readonly (readonly [string, (self: World) => void])[] = [
		['the native runtime is absent', (self) => { self.runtimeAvailable = false; }],
		['the build disabled native media', (self) => { self.nativeMediaEnabled = false; }],
		['the user opted out of native media', (self) => { self.preferenceEnabled = false; }],
		['the master switch is off', (self) => { self.capabilitySnapshot = capability({}, false); }],
		['the proxy codec is not opted into',
			(self) => { self.capabilitySnapshot = capability({ userEnabled: false }); }],
		['the proxy codec failed its self test',
			(self) => { self.capabilitySnapshot = capability({ selfTestPassed: false }); }],
		['no capability report exists', (self) => { self.capabilitySnapshot = null; }],
	];
	for (const [label, apply] of cases) {
		const self = world();
		apply(self);
		await assert.rejects(
			generate(self), /Native ProRes Proxy generation is unavailable or not enabled/u, label,
		);
		assert.equal(self.log.includes('selectRoot'), false, label);
	}
	// A degraded but opted-in codec is still usable, which is what makes the
	// refusals above about capability rather than about a missing row.
	const degraded = world();
	degraded.capabilitySnapshot = capability({ degraded: true });
	assert.equal((await generate(degraded)).size, PROXY_BYTES.byteLength);
});

test('a cancelled destination selection aborts the candidate rather than failing it', async () => {
	const self = world();
	self.root = null;

	await assert.rejects(generate(self), (error: unknown) => (
		error instanceof DOMException && error.name === 'AbortError'
		&& /destination selection was cancelled/u.test(error.message)
	));
	assert.equal(self.log.includes('revalidateRoot'), false);
});

test('a root that is not an exact unrevoked grant is refused before anything is queued', async () => {
	for (const root of [
		'grant', [], { grantId: GRANT_ID }, { grantId: 'not-hex', revoked: false },
		{ grantId: GRANT_ID, revoked: 'no' },
	]) {
		const self = world();
		self.root = root;
		await assert.rejects(generate(self), TypeError, JSON.stringify(root));
	}
	for (const [label, apply] of [
		['a revoked grant', (self: World) => { self.root = { grantId: GRANT_ID, revoked: true }; }],
		['an unconfirmed grant', (self: World) => { self.revalidate = false; }],
		['a non-boolean confirmation', (self: World) => { self.revalidate = 'yes'; }],
	] as const) {
		const self = world();
		apply(self);
		await assert.rejects(
			generate(self), /The native ProRes Proxy destination root is not authorized/u, label,
		);
		assert.deepEqual(self.enqueued, [], label);
	}
});

test('a queue acknowledgement that is not a proxy-generation row is refused', async () => {
	for (const result of [
		null, 'queued', [queueRow('queued')], queueRow('queued', { jobId: 'short' }),
		queueRow('queued', { taskKind: 'encoded-export' }),
	]) {
		const self = world();
		self.enqueueResult = result;
		await assert.rejects(generate(self), TypeError, JSON.stringify(result));
		assert.equal(self.log.includes('claimProxyOutput'), false);
	}
});

test('the observed original must still be the one video source the project holds', async () => {
	const cases: readonly (readonly [Readonly<GenerateOptions>, RegExp])[] = [
		[{ identity: { ...IDENTITY, projectId: 'another-project' } },
			/The native proxy candidate project identity changed/u],
		[{ identity: { ...IDENTITY, sha256: 'not-a-digest' } },
			/The native proxy candidate project identity changed/u],
		[{ getProject: projectWith((sources) => { video(sources).contentSha256 = 'fe'.repeat(32); }) },
			/The native proxy candidate original generation changed/u],
		[{ identity: { ...IDENTITY, sourceId: 'no-such-source' } },
			/The native proxy candidate source is absent or duplicated/u],
		[{ identity: { ...IDENTITY, sourceId: 'audio-source' } },
			/The native proxy candidate source is absent or duplicated/u],
		// A duplicated source never reaches the proxy check: the project shaping
		// the generator clones through rejects the whole project first.
		[{ getProject: projectWith((sources) => { sources.push(structuredClone(video(sources))); }) },
			/Duplicate project source ID: video-source/u],
	];
	for (const [options, pattern] of cases) {
		const self = world();
		await assert.rejects(generate(self, options), pattern);
		assert.deepEqual(self.enqueued, []);
	}
});

test('the queue is polled until its row completes, and each poll carries the signal', async () => {
	const self = world();
	const controller = new AbortController();
	self.state = 'queued';
	let seen = 0;
	self.waitForPoll = (signal?: AbortSignal) => {
		self.polls.push(signal);
		seen += 1;
		self.state = seen === 1 ? 'running' : 'completed';
		return Promise.resolve();
	};

	const proxy = await generate(self, { signal: controller.signal });

	assert.equal(proxy.size, PROXY_BYTES.byteLength);
	assert.deepEqual(self.polls, [controller.signal, controller.signal]);
	assert.deepEqual(self.controls, []);
});

test('the shipped poll actually waits between queue reads when none is supplied', async () => {
	const self = world();
	let seen = 0;
	self.queue = () => [queueRow(self.enqueued.length > 0 && ++seen > 1 ? 'completed' : 'running')];
	const started = Date.now();

	await generate(self, { waitForPoll: 'default' });

	assert.ok(Date.now() - started >= 200, 'a busy loop would hammer the native queue');
});

test('a queue row that disappears or is duplicated stops the generation', async () => {
	for (const rows of [[], [queueRow('completed'), queueRow('completed')]]) {
		const self = world();
		self.queue = () => rows;
		await assert.rejects(generate(self), /The native ProRes Proxy queue row disappeared/u);
	}
});

test('a job that stops short is reported by state and cancelled only while it could still run', async () => {
	for (const state of ['failed', 'cancelled', 'blocked', 'needs-authorization']) {
		const self = world();
		self.state = state;
		await assert.rejects(
			generate(self), new RegExp(`Native ProRes Proxy generation stopped in state ${state}\\.`, 'u'),
		);
		assert.deepEqual(
			self.controls,
			['blocked', 'needs-authorization'].includes(state) ? [CANCEL] : [],
			`a ${state} job must not be cancelled twice`,
		);
	}
});

test('a claim that is not an exact ProRes Proxy output claim is refused without a release', async () => {
	const valid = {
		claimId: CLAIM_ID, byteLength: 5, sha256: 'ab'.repeat(32), mimeType: 'video/quicktime',
	};
	for (const claim of [
		null, [valid], { ...valid, claimId: 'short' }, { ...valid, byteLength: 0 },
		{ ...valid, byteLength: 1.5 }, { ...valid, byteLength: 512 * 1024 ** 2 + 1 },
		{ ...valid, sha256: 'not-a-digest' }, { ...valid, mimeType: 'video/mp4' },
	]) {
		const self = world();
		self.claim = claim;
		await assert.rejects(generate(self), TypeError, JSON.stringify(claim));
		assert.equal(self.log.includes('releaseProxyOutput'), false, 'nothing was claimed to release');
		assert.deepEqual(self.controls, [], 'a completed job is left alone for a later attempt');
	}
});

test('output longer than one read span is assembled from successive ranges', async () => {
	const self = world();
	self.bytes = new Uint8Array(READ_BYTES + 7).fill(3);
	self.bytes[READ_BYTES + 6] = 9;

	const proxy = await generate(self);

	assert.equal(proxy.size, READ_BYTES + 7);
	assert.deepEqual(self.reads, [
		{ claimId: CLAIM_ID, offset: 0, length: READ_BYTES },
		{ claimId: CLAIM_ID, offset: READ_BYTES, length: 7 },
	]);
	assert.equal(new Uint8Array(await proxy.arrayBuffer())[READ_BYTES + 6], 9);
});

test('a short or mistyped output range fails the read and still releases the claim', async () => {
	for (const answer of [
		() => new Uint8Array(2), () => 'bytes', () => new Uint8Array(8).buffer, () => null,
	]) {
		const self = world();
		self.readResult = answer;
		await assert.rejects(generate(self), /A pathless native proxy-output range was short/u);
		assert.equal(self.log.includes('releaseProxyOutput'), true);
		assert.deepEqual(self.controls, []);
	}
});

test('a proxy whose assembled bytes do not match the claimed digest is refused', async () => {
	const self = world();
	self.claim = {
		claimId: CLAIM_ID, byteLength: PROXY_BYTES.byteLength, sha256: 'ab'.repeat(32),
		mimeType: 'video/quicktime',
	};

	await assert.rejects(
		generate(self), /The pathless native proxy candidate changed exact byte identity/u,
	);
	assert.equal(self.log.includes('releaseProxyOutput'), true);
});

test('a cancellation raised while the output is being read still releases the claim', async () => {
	const self = world();
	const controller = new AbortController();
	const reason = new Error('the proxy relationship was replaced mid-read');
	self.onClaim = () => { controller.abort(reason); };

	await assert.rejects(
		generate(self, { signal: controller.signal }), (error: unknown) => error === reason,
	);
	assert.deepEqual(self.reads, [], 'no range is read once the candidate is stale');
	assert.equal(self.log.includes('releaseProxyOutput'), true);
});

test('a claim the desktop refuses to release fails an otherwise complete generation', async () => {
	const self = world();
	self.release = false;

	await assert.rejects(generate(self), /The pathless native proxy output claim was not released/u);
	assert.deepEqual(self.controls, []);
});

test('a release failure is raised alone, or aggregated with the read failure it followed', async () => {
	const alone = world();
	const releaseFailure = new Error('the claim broker is gone');
	alone.releaseError = releaseFailure;

	await assert.rejects(generate(alone), (error: unknown) => error === releaseFailure);

	const both = world();
	both.releaseError = releaseFailure;
	both.readResult = () => new Uint8Array(1);

	await assert.rejects(generate(both), (error: unknown) => (
		error instanceof AggregateError && error.errors.length === 2
		&& error.errors[1] === releaseFailure && error.cause === error.errors[0]
		&& /proxy-output range was short/u.test(String((error.errors[0] as Error).message))
		&& /Native proxy read and claim release failed/u.test(error.message)
	));
});

test('a failure after the job is queued cancels only a job that could still be running', async () => {
	const failure = new Error('the claim broker refused this job');
	const done = world();
	done.onClaim = () => { throw failure; };

	await assert.rejects(generate(done), (error: unknown) => error === failure);
	assert.deepEqual(done.controls, [], 'a completed job has nothing left to cancel');

	// A row that reads as still runnable by the time the read failed is the one
	// case that must be cancelled, and a bridge that cannot even answer the
	// cancellation read must not replace the failure the caller needs to see.
	const running = world();
	running.onClaim = () => { throw failure; };
	running.queue = () => [queueRow(running.log.includes('claimProxyOutput') ? 'running' : 'completed')];

	await assert.rejects(generate(running), (error: unknown) => error === failure);
	assert.deepEqual(running.controls, [CANCEL]);

	const mute = world();
	mute.onClaim = () => { throw failure; };
	mute.queue = () => {
		if (mute.log.includes('claimProxyOutput')) throw new Error('the native bridge went away');
		return [queueRow('completed')];
	};

	await assert.rejects(generate(mute), (error: unknown) => error === failure);
	assert.deepEqual(mute.controls, []);
});

function video(sources: Data[]): Data {
	const row = sources.find(({ kind }) => kind === 'video');
	if (!row) throw new Error('the fixture project lost its video source');
	return row;
}
