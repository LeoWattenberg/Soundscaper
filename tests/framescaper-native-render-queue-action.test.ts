/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import {
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { runFramescaperNativeCarrierRegeneration } from
	'../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperNativeRenderQueueActionRuntimeNativeMedia as createRuntime,
} from '../src/framescaper/editor-native-render-queue-action.ts';
import {
	createFramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const QUEUE_ENTRY = Object.freeze({
	domain: 'queue',
	id: 'persistent-render-queue',
	policyCleared: true,
	buildSupported: true,
	probeSucceeded: true,
	selfTestPassed: true,
	userEnabled: true,
});

function owner(): Data {
	return {
		project: createFramescaperProjectNativeMedia(
			PROFILE,
			framescaperV20Options() as never,
		),
	};
}

function services(overrides: Data = {}, queueEnabled = true): Data {
	return {
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: [], roots: [], watchRules: [],
		}),
		control: async () => undefined,
		reorder: async () => undefined,
		remove: async () => undefined,
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: queueEnabled,
			entries: queueEnabled ? [QUEUE_ENTRY] : [],
		} as never),
		...overrides,
	};
}

function installBridge(context: TestContext, overrides: Data = {}, queueEnabled = true): void {
	const scope = globalThis as unknown as Data;
	const previous = scope.framescaperDesktop;
	scope.framescaperDesktop = { v1: { nativeServices: services(overrides, queueEnabled) } };
	context.after(() => {
		if (previous === undefined) delete scope.framescaperDesktop;
		else scope.framescaperDesktop = previous;
	});
}

function enqueue(runtime: Data, request?: unknown): Promise<void> {
	return (runtime.run as (surface: string, request: unknown) => Promise<void>)(
		'render-queue-enqueue',
		request,
	);
}

test('the render queue runtime registers exactly its enqueue surface', () => {
	assert.deepEqual(createRuntime(PROFILE, owner() as never).surfaces, ['render-queue-enqueue']);
});

test('a render queue runtime requires a controller owner', () => {
	for (const value of [null, undefined, 'owner', 42]) {
		assert.throws(() => createRuntime(PROFILE, value as never), TypeError);
	}
});

test('an unsupported delivery format is refused before any bridge is consulted', async () => {
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.rejects(
		() => enqueue(runtime, { kind: 'quicktime-ish' }),
		/delivery format is unsupported/u,
	);
});

test('an image-sequence delivery that would drop alpha is refused', async () => {
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.rejects(
		() => enqueue(runtime, {
			kind: 'image-sequence', format: 'png',
			frameRate: { num: 24, den: 1 }, preserveAlpha: false,
		}),
		/must preserve alpha/u,
	);
});

test('a delivery request carrying unknown fields is refused', async () => {
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.rejects(
		() => enqueue(runtime, { kind: 'encoded-mov', extra: 1 }),
		/invalid closed shape/u,
	);
});

test('enqueueing without an authenticated desktop bridge is refused', async () => {
	const scope = globalThis as unknown as Data;
	const previous = scope.framescaperDesktop;
	delete scope.framescaperDesktop;
	try {
		const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;
		await assert.rejects(() => enqueue(runtime), /desktop bridge is unavailable/u);
	} finally {
		if (previous !== undefined) scope.framescaperDesktop = previous;
	}
});

test('a runtime whose render queue capability is not enabled refuses to enqueue', async (context) => {
	installBridge(context, {}, false);
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.rejects(() => enqueue(runtime), /render queue is unavailable or not enabled/u);
});

test('a bridge without the root and enqueue ports refuses to enqueue', async (context) => {
	installBridge(context);
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.rejects(() => enqueue(runtime), /cannot enqueue selected V14 renders/u);
});

test('an operator who declines the destination root leaves nothing enqueued', async (context) => {
	let enqueued = 0;
	installBridge(context, {
		selectRoot: async () => null,
		revalidateRoot: async () => true,
		enqueue: async () => { enqueued += 1; return { jobId: 'job-1' }; },
	});
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.doesNotReject(() => enqueue(runtime));
	assert.equal(enqueued, 0, 'a declined root must not queue work');
});

test('carrier regeneration shares queue-admission serialization with ordinary enqueue', async (context) => {
	const runtimeOwner = owner();
	const project = runtimeOwner.project as Data;
	const jobId = 'c'.repeat(40);
	let releaseFirst!: () => void;
	let firstStarted!: () => void;
	const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
	const started = new Promise<void>((resolve) => { firstStarted = resolve; });
	let pickerCalls = 0;
	installBridge(context, {
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: [{
				jobId, schemaFamily: 'framescaper', schemaVersion: 1, taskKind: 'encoded-export',
				projectId: project.id, relativeDestination: `renders/framescaper-${String(project.id)}-r${String(project.revision)}.mov`,
				state: 'paused', position: 0, progress: null, attempt: 1,
				lastFailureCode: 'awaiting-carrier-regeneration',
			}], roots: [], watchRules: [],
		}),
		selectRoot: async () => {
			pickerCalls += 1;
			if (pickerCalls === 1) { firstStarted(); await held; }
			return null;
		},
		revalidateRoot: async () => true,
		enqueue: async () => ({}),
	});
	const runtime = createRuntime(PROFILE, runtimeOwner as never) as unknown as Data;
	const ordinary = enqueue(runtime);
	await started;
	const regeneration = runFramescaperNativeCarrierRegeneration(runtime as never, jobId);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(pickerCalls, 1, 'a second native destination picker must wait for the first admission');
	releaseFirst();
	await Promise.all([ordinary, regeneration]);
	assert.equal(pickerCalls, 2);
});

test('a destination root that fails its projection is refused', async (context) => {
	installBridge(context, {
		selectRoot: async () => ({ grantId: 'grant-1', path: '/out', revoked: false }),
		revalidateRoot: async () => true,
		enqueue: async () => ({ jobId: 'job-1' }),
	});
	const runtime = createRuntime(PROFILE, owner() as never) as unknown as Data;

	await assert.rejects(() => enqueue(runtime), /destination root projection is invalid/u);
});

test('a malformed live-stage acknowledgement abandons the main-created stage', async (context) => {
	const stageId = 'd'.repeat(40);
	const abandoned: string[] = [];
	installBridge(context, {
		selectRoot: async () => ({
			grantId: 'a'.repeat(16), displayName: 'Exports', revoked: false,
		}),
		revalidateRoot: async () => true,
		stageLiveRenderInputs: async () => ({
			stageId, carrierByteLength: 2, scratchByteLength: 2,
		}),
		writeLiveRenderInput: async () => ({}),
		completeLiveRenderInput: async () => ({}),
		abandonRenderInputs: async (request: Data) => {
			abandoned.push(String(request.stageId));
			return true;
		},
		enqueue: async () => ({}),
	});
	const stream = async () => ({ byteLength: 1, sha256: '1'.repeat(64), chunkCount: 1 });
	const runtime = createRuntime(PROFILE, {
		...owner(),
		prepareNativeRenderInputStreamNativeMedia: async () => ({
			carrierByteLength: 1, stream,
			audio: { role: 'staged-audio-mix', byteLength: 1, stream },
		}),
	} as never) as unknown as Data;

	await assert.rejects(() => enqueue(runtime), /stage changed its exact admission/u);
	assert.deepEqual(abandoned, [stageId]);
});

test('an audio-inclusive live carrier does not supersede its sibling video task', async (context) => {
	type Role = 'evaluated-rgba-frame-pack' | 'staged-audio-mix';
	const lifetime = new EditorControllerLifetime();
	const started: Role[] = [];
	const completed: Role[] = [];
	const roleStream = (role: Role) => async (sink: Readonly<{
		write(bytes: Uint8Array): Promise<void>;
	}>) => {
		started.push(role);
		const task = lifetime.startTask('product-native-render-input');
		try {
			await Promise.resolve();
			task.assertCurrent();
			await sink.write(Uint8Array.of(role === 'evaluated-rgba-frame-pack' ? 1 : 2));
			task.assertCurrent();
			return { byteLength: 1, sha256: '1'.repeat(64), chunkCount: 1 };
		} finally {
			task.finish();
		}
	};
	installBridge(context, {
		selectRoot: async () => ({
			grantId: 'a'.repeat(16), displayName: 'Exports', revoked: false,
		}),
		revalidateRoot: async () => true,
		stageLiveRenderInputs: async (request: Data) => ({
			stageId: 'b'.repeat(40), carrierByteLength: request.carrierByteLength,
			scratchByteLength: 2,
		}),
		writeLiveRenderInput: async (request: Data) => ({
			sequence: request.sequence,
			receivedBytes: Number(request.offset) + (request.bytes as Uint8Array).byteLength,
		}),
		completeLiveRenderInput: async (request: Data) => {
			completed.push(request.role as Role);
			return { byteLength: request.byteLength, sha256: request.sha256 };
		},
		abandonRenderInputs: async () => true,
		enqueue: async () => ({}),
	});
	const runtimeOwner = {
		...owner(),
		prepareNativeRenderInputStreamNativeMedia: async () => ({
			carrierByteLength: 1,
			stream: roleStream('evaluated-rgba-frame-pack'),
			audio: {
				role: 'staged-audio-mix', byteLength: 1,
				stream: roleStream('staged-audio-mix'),
			},
		}),
	};
	const runtime = createRuntime(PROFILE, runtimeOwner as never) as unknown as Data;

	await assert.doesNotReject(() => enqueue(runtime));
	assert.deepEqual(started, ['evaluated-rgba-frame-pack', 'staged-audio-mix']);
	assert.deepEqual(completed, started);
});
