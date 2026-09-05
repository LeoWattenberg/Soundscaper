/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	framescaperNativeProjectActionRuntimeFor,
	runFramescaperNativeCarrierRegeneration,
	type FramescaperNativeProjectActionRuntime,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_RENDER_QUEUE_RESERVATIONS as RESERVATIONS,
	bindFramescaperNativeRenderQueueActionNativeMedia as bindRuntime,
	createFramescaperNativeRenderQueueActionRuntimeNativeMedia as createRuntime,
} from '../src/framescaper/editor-native-render-queue-action.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;
interface Sink { write(bytes: Uint8Array): Promise<void> | void }

const GRANT = 'a'.repeat(16);
const STAGE = 'b'.repeat(40);
const JOB = 'c'.repeat(40);
const SHA = '1'.repeat(64);
const CONTENT = '12'.repeat(32);

const QUEUE_ENTRY = Object.freeze({
	domain: 'queue', id: 'persistent-render-queue', buildSupported: true,
	probeSucceeded: true, selfTestPassed: true, userEnabled: true,
});

function options(silent: boolean): Data {
	const input = framescaperV20Options();
	if (!silent) return input;
	input.sources = (input.sources as Data[]).filter((row) => row.kind !== 'audio');
	input.clips = (input.clips as Data[]).filter((row) => row.kind !== 'audio');
	input.tracks = (input.tracks as Data[]).filter((row) => row.type !== 'audio');
	input.sequences = (input.sequences as Data[]).map((sequence) => ({
		...sequence,
		trackIds: (sequence.trackIds as string[]).filter((id) => id !== 'audio-track'),
	}));
	return input;
}

/** Silent legacy-unmanaged colour is the only V14 family main renders carrier-free. */
function carrierFreeProject(): Data {
	const input = options(true);
	const derived = createFramescaperProjectNativeMedia(PROFILE, input as never) as unknown as Data;
	input.finishing = {
		sourceColorInterpretations: (derived.videoSourceColorInterpretations as Data[])
			.map((row) => ({ ...row, provenance: 'legacy-unmanaged-encoded' })),
	};
	return createFramescaperProjectNativeMedia(PROFILE, input as never) as unknown as Data;
}

function silentCarrierProject(): Data {
	return createFramescaperProjectNativeMedia(PROFILE, options(true) as never) as unknown as Data;
}

function audioCarrierProject(): Data {
	return createFramescaperProjectNativeMedia(PROFILE, options(false) as never) as unknown as Data;
}

function destination(project: Data, suffix = '.mov'): string {
	return `renders/framescaper-${String(project.id)}-r${String(project.revision)}${suffix}`;
}

function projection(queue: readonly Data[] = [], overrides: Data = {}): Data {
	return {
		snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
		queue, roots: [], watchRules: [], ...overrides,
	};
}

function pausedRow(project: Data, overrides: Data = {}): Data {
	return {
		jobId: JOB, schemaFamily: 'framescaper', schemaVersion: 1, taskKind: 'encoded-export',
		projectId: project.id, relativeDestination: destination(project),
		state: 'paused', position: 0, progress: null, attempt: 1,
		lastFailureCode: 'awaiting-carrier-regeneration', ...overrides,
	};
}

function services(overrides: Data = {}): Data {
	return {
		snapshot: async () => projection(),
		control: async () => undefined,
		reorder: async () => undefined,
		remove: async () => undefined,
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true, entries: [QUEUE_ENTRY],
		} as never),
		...overrides,
	};
}

/** The whole authenticated live-carrier port set, so each test breaks exactly one part. */
function liveServices(overrides: Data = {}): Data {
	return services({
		selectRoot: async () => ({ grantId: GRANT, displayName: 'Exports', revoked: false }),
		revalidateRoot: async () => true,
		stageLiveRenderInputs: async (request: Data) => ({
			stageId: STAGE, carrierByteLength: request.carrierByteLength, scratchByteLength: 4,
		}),
		writeLiveRenderInput: async (request: Data) => ({
			sequence: request.sequence,
			receivedBytes: Number(request.offset) + (request.bytes as Uint8Array).byteLength,
		}),
		completeLiveRenderInput: async (request: Data) => ({
			byteLength: request.byteLength, sha256: request.sha256,
		}),
		abandonRenderInputs: async () => true,
		enqueue: async () => ({}),
		...overrides,
	});
}

function producer(overrides: Data = {}): Data {
	return {
		carrierByteLength: 1, audio: null,
		stream: async (sink: Sink) => {
			await sink.write(Uint8Array.of(7));
			return { byteLength: 1, sha256: SHA, chunkCount: 1 };
		},
		...overrides,
	};
}

function owner(project: Data, prepared: Data | null = null): Data {
	return prepared === null
		? { project }
		: { project, prepareNativeRenderInputStreamNativeMedia: async () => prepared };
}

function install(context: TestContext, bridge: Data): void {
	const global = globalThis as unknown as Data;
	const previous = global.framescaperDesktop;
	global.framescaperDesktop = { v1: { nativeServices: bridge } };
	context.after(() => {
		if (previous === undefined) delete global.framescaperDesktop;
		else global.framescaperDesktop = previous;
	});
}

function replace(bridge: Data): void {
	(globalThis as unknown as Data).framescaperDesktop = { v1: { nativeServices: bridge } };
}

function enqueue(runtime: FramescaperNativeProjectActionRuntime, request?: unknown): Promise<void> {
	return runtime.run('render-queue-enqueue', request);
}

function aggregate(first: RegExp, second: RegExp): (error: unknown) => boolean {
	return (error: unknown) => {
		assert.ok(error instanceof AggregateError, 'a failed cleanup must aggregate both causes');
		assert.match(String((error.errors[0] as Error).message), first);
		assert.match(String((error.errors[1] as Error).message), second);
		return true;
	};
}

test('binding the render queue action registers it as the owner runtime', () => {
	const controller = owner(carrierFreeProject());
	const runtime = bindRuntime(PROFILE, controller as never);

	assert.equal(framescaperNativeProjectActionRuntimeFor(controller), runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);
});

test('every disabled native-media condition refuses the queue before a root is chosen', async (context) => {
	const disabled: readonly Data[] = [
		{ snapshot: async () => projection([], { runtimeAvailable: false }) },
		{ snapshot: async () => projection([], { nativeMediaEnabled: false }) },
		{ preferences: async () => ({
			nativeMediaEnabled: false, hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false, ofxConsentEnabled: false,
		}) },
		{ capabilities: async () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true, entries: [{ ...QUEUE_ENTRY, userEnabled: false }],
		} as never) },
		{ capabilities: undefined },
	];
	for (const overrides of disabled) {
		let selected = 0;
		install(context, liveServices({ ...overrides, selectRoot: async () => { selected += 1; return null; } }));
		const runtime = createRuntime(PROFILE, owner(carrierFreeProject()) as never);

		await assert.rejects(() => enqueue(runtime), /render queue is unavailable or not enabled/u);
		assert.equal(selected, 0, 'a refused capability must never open the native picker');
	}
});

test('a carrier-free encoded delivery enqueues one exact stageless V14 job', async (context) => {
	const project = carrierFreeProject();
	let recorded: Data | null = null;
	install(context, liveServices({ enqueue: async (row: Data) => { recorded = row; return {}; } }));
	const runtime = createRuntime(PROFILE, owner(project) as never);

	await enqueue(runtime);

	const request = recorded as unknown as Data;
	assert.ok(request, 'the exact carrier-free job must reach the desktop bridge');
	assert.match(String(request.planFingerprint), /^[a-f0-9]{64}$/u);
	assert.equal((JSON.parse(String(request.planPayload)) as Data).version, 14);
	const { planFingerprint: _fingerprint, planPayload: _payload, ...rest } = request;
	assert.deepEqual(rest, {
		schemaFamily: 'framescaper', schemaVersion: 1, taskKind: 'encoded-export',
		planVersion: 14, derivedInputStageId: null,
		projectId: project.id, projectRevision: project.revision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: CONTENT }],
		rootGrantId: GRANT, relativeDestination: destination(project),
		reservations: { ...RESERVATIONS, scratchBytes: 0 },
		recoveryClass: 'atomic-restart',
	});
});

test('an image-sequence delivery names its rate and format in the queued destination', async (context) => {
	const project = carrierFreeProject();
	let recorded: Data | null = null;
	install(context, liveServices({ enqueue: async (row: Data) => { recorded = row; return {}; } }));
	const runtime = createRuntime(PROFILE, owner(project) as never);

	await enqueue(runtime, { kind: 'image-sequence', format: 'tiff', frameRate: { num: 10, den: 1 }, preserveAlpha: true });

	const request = recorded as unknown as Data;
	assert.equal(request.taskKind, 'image-sequence-export');
	assert.equal(request.relativeDestination, destination(project, '-10-1-tiff'));
	assert.equal(request.recoveryClass, 'atomic-restart', 'the V14 route restarts from zero');
});

test('a revoked or unrevalidated destination root is refused as unauthorized', async (context) => {
	for (const overrides of [
		{ selectRoot: async () => ({ grantId: GRANT, displayName: 'Exports', revoked: true }) },
		{ revalidateRoot: async () => false },
	]) {
		let enqueued = 0;
		install(context, liveServices({ ...overrides, enqueue: async () => { enqueued += 1; return {}; } }));
		const runtime = createRuntime(PROFILE, owner(carrierFreeProject()) as never);

		await assert.rejects(() => enqueue(runtime), /destination root is not authorized/u);
		assert.equal(enqueued, 0);
	}
});

test('a desktop bridge replaced during root selection abandons the admission', async (context) => {
	const project = carrierFreeProject();
	let enqueued = 0;
	install(context, liveServices({
		selectRoot: async () => {
			replace(liveServices({ enqueue: async () => { enqueued += 1; return {}; } }));
			return { grantId: GRANT, displayName: 'Exports', revoked: false };
		},
		enqueue: async () => { enqueued += 1; return {}; },
	}));
	const runtime = createRuntime(PROFILE, owner(project) as never);

	await assert.rejects(() => enqueue(runtime), /bridge changed during root selection/u);
	assert.equal(enqueued, 0);
});

test('a project edited during root selection refuses the stale queue admission', async (context) => {
	const controller = owner(carrierFreeProject());
	install(context, liveServices({
		selectRoot: async () => {
			controller.project = silentCarrierProject();
			return { grantId: GRANT, displayName: 'Exports', revoked: false };
		},
	}));
	const runtime = createRuntime(PROFILE, controller as never);

	await assert.rejects(() => enqueue(runtime), /project changed during queue admission/u);
});

test('a project edited while its carrier is staged abandons the staged carrier', async (context) => {
	const controller = owner(silentCarrierProject(), producer());
	const abandoned: string[] = [];
	let enqueued = 0;
	install(context, liveServices({
		stageLiveRenderInputs: async (request: Data) => {
			controller.project = carrierFreeProject();
			return { stageId: STAGE, carrierByteLength: request.carrierByteLength, scratchByteLength: 4 };
		},
		abandonRenderInputs: async (request: Data) => { abandoned.push(String(request.stageId)); return true; },
		enqueue: async () => { enqueued += 1; return {}; },
	}));
	const runtime = createRuntime(PROFILE, controller as never);

	await assert.rejects(() => enqueue(runtime), /changed while its carrier was staged/u);
	assert.deepEqual(abandoned, [STAGE]);
	assert.equal(enqueued, 0);
});

test('a carrier-requiring plan without a live authority refuses before staging', async (context) => {
	const noPorts = liveServices({ writeLiveRenderInput: undefined });
	for (const [bridge, controller] of [
		[liveServices(), owner(silentCarrierProject())],
		[noPorts, owner(silentCarrierProject(), producer())],
	] as const) {
		let staged = 0;
		install(context, { ...bridge, stageLiveRenderInputs: async () => { staged += 1; return {}; } });
		const runtime = createRuntime(PROFILE, controller as never);

		await assert.rejects(() => enqueue(runtime), /live evaluated-carrier authority is unavailable/u);
		assert.equal(staged, 0);
	}
});

test('a live carrier producer that breaks its closed shape is refused', async (context) => {
	install(context, liveServices());
	const cases: readonly (readonly [unknown, RegExp])[] = [
		[producer({ carrierByteLength: 0 }), /live carrier producer is invalid/u],
		[producer({ stream: null }), /live carrier producer is invalid/u],
		[producer({ extra: 1 }), /live carrier producer is invalid/u],
		['not-a-producer', /live carrier producer must be an object/u],
	];
	for (const [value, message] of cases) {
		const controller = {
			project: silentCarrierProject(),
			prepareNativeRenderInputStreamNativeMedia: async () => value,
		};
		await assert.rejects(() => enqueue(createRuntime(PROFILE, controller as never)), message);
	}
});

test('a stage request that fails before acknowledging a stage abandons nothing', async (context) => {
	let abandons = 0;
	install(context, liveServices({
		stageLiveRenderInputs: async () => { throw new RangeError('main refused the stage.'); },
		abandonRenderInputs: async () => { abandons += 1; return true; },
	}));
	const runtime = createRuntime(PROFILE, owner(silentCarrierProject(), producer()) as never);

	await assert.rejects(() => enqueue(runtime), /main refused the stage/u);
	assert.equal(abandons, 0, 'an unacknowledged stage has nothing to abandon');
});

test('a silent plan refuses a carrier that offers an audio role', async (context) => {
	install(context, liveServices());
	const runtime = createRuntime(PROFILE, owner(silentCarrierProject(), producer({
		audio: { role: 'staged-audio-mix', byteLength: 1, stream: async () => ({ byteLength: 1, sha256: SHA }) },
	})) as never);

	await assert.rejects(() => enqueue(runtime), /silent selected nativeMedia carrier returned audio/u);
});

test('an audio plan refuses a carrier whose audio role is not the staged mix', async (context) => {
	install(context, liveServices());
	const runtime = createRuntime(PROFILE, owner(audioCarrierProject(), producer({
		audio: { role: 'staged-audio', byteLength: 1, stream: async () => ({ byteLength: 1, sha256: SHA }) },
	})) as never);

	await assert.rejects(() => enqueue(runtime), /live audio authority is invalid/u);
});

test('a stage acknowledgement that cannot be abandoned reports both failures together', async (context) => {
	install(context, liveServices({
		stageLiveRenderInputs: async () => ({ stageId: STAGE, carrierByteLength: 1, scratchByteLength: 0 }),
		abandonRenderInputs: async () => false,
	}));
	const runtime = createRuntime(PROFILE, owner(silentCarrierProject(), producer()) as never);

	await assert.rejects(
		() => enqueue(runtime),
		aggregate(/stage changed its exact admission/u, /stage abandonment was not acknowledged/u),
	);
});

test('a carrier that fails mid-production cancels the job it was queued for', async (context) => {
	const cases: readonly (readonly [Data, Data, RegExp])[] = [
		[
			{ writeLiveRenderInput: async (row: Data) => ({ sequence: Number(row.sequence) + 1, receivedBytes: 1 }) },
			{},
			/sink changed its live acknowledgement/u,
		],
		[{}, { carrierByteLength: 2 }, /changed its reserved length or trailer/u],
	];
	for (const [ports, carrier, message] of cases) {
		const controls: Data[] = [];
		install(context, liveServices({
			...ports, control: async (request: Data) => { controls.push(request); return undefined; },
		}));
		const runtime = createRuntime(PROFILE, owner(silentCarrierProject(), producer(carrier)) as never);

		await assert.rejects(() => enqueue(runtime), message);
		assert.deepEqual(controls, [{ jobId: STAGE, action: 'cancel' }]);
	}
});

test('a completed carrier whose identity changed fails and reports an uncancellable job', async (context) => {
	install(context, liveServices({
		completeLiveRenderInput: async (request: Data) => ({ byteLength: request.byteLength, sha256: '2'.repeat(64) }),
		control: async () => { throw new Error('the queue refused the cancellation.'); },
	}));
	const runtime = createRuntime(PROFILE, owner(silentCarrierProject(), producer()) as never);

	await assert.rejects(() => enqueue(runtime), aggregate(
		/changed the completed evaluated-rgba-frame-pack identity/u,
		/refused the cancellation/u,
	));
});

test('a live bridge that loses its write port before production refuses to stream', async (context) => {
	const bridge: Data = liveServices({});
	bridge.enqueue = async () => { delete bridge.writeLiveRenderInput; return {}; };
	install(context, bridge);
	const runtime = createRuntime(PROFILE, owner(silentCarrierProject(), producer()) as never);

	await assert.rejects(() => enqueue(runtime), /live carrier bridge ended before production/u);
});

test('two paused carrier jobs for one destination refuse an ambiguous recovery', async (context) => {
	const project = carrierFreeProject();
	install(context, liveServices({
		snapshot: async () => projection([pausedRow(project), pausedRow(project, { jobId: 'd'.repeat(40) })]),
	}));
	const runtime = createRuntime(PROFILE, owner(project) as never);

	await assert.rejects(() => enqueue(runtime), /ambiguous paused carrier jobs/u);
});

test('carrier regeneration refuses a queue row that is not an awaiting paused job', async (context) => {
	const project = carrierFreeProject();
	for (const overrides of [
		{ jobId: 'd'.repeat(40) },
		{ state: 'queued' },
		{ lastFailureCode: 'decode-failed' },
		{ projectId: 'other-project' },
	]) {
		install(context, liveServices({ snapshot: async () => projection([pausedRow(project, overrides)]) }));
		const runtime = createRuntime(PROFILE, owner(project) as never);

		await assert.rejects(
			() => runFramescaperNativeCarrierRegeneration(runtime, JOB),
			/no longer matches its exact paused queue job/u,
		);
	}
});

test('carrier regeneration refuses a paused job it cannot restore to an exact delivery', async (context) => {
	const project = carrierFreeProject();
	const cases: readonly (readonly [Data, RegExp])[] = [
		[
			{ taskKind: 'proxy-generation', relativeDestination: 'proxies/framescaper.mov' },
			/unsupported queue task/u,
		],
		[
			{ taskKind: 'image-sequence-export', relativeDestination: destination(project, '-broken') },
			/lost its exact delivery intent/u,
		],
		[{ relativeDestination: 'renders/stale.mov' }, /regeneration destination is stale/u],
	];
	for (const [overrides, message] of cases) {
		install(context, liveServices({ snapshot: async () => projection([pausedRow(project, overrides)]) }));
		const runtime = createRuntime(PROFILE, owner(project) as never);

		await assert.rejects(() => runFramescaperNativeCarrierRegeneration(runtime, JOB), message);
	}
});

test('carrier regeneration refuses once its paused job leaves the queue before admission', async (context) => {
	const project = carrierFreeProject();
	let snapshots = 0;
	install(context, liveServices({
		snapshot: async () => {
			snapshots += 1;
			return projection(snapshots === 1 ? [pausedRow(project)] : []);
		},
	}));
	const runtime = createRuntime(PROFILE, owner(project) as never);

	await assert.rejects(
		() => runFramescaperNativeCarrierRegeneration(runtime, JOB),
		/no longer matches its exact paused queue job/u,
	);
	assert.equal(snapshots, 2, 'the refusal must come from the admission, not the recovery lookup');
});

test('carrier regeneration recovers an image-sequence delivery from its paused destination', async (context) => {
	const project = carrierFreeProject();
	const target = destination(project, '-10-1-openexr');
	let recorded: Data | null = null;
	install(context, liveServices({
		snapshot: async () => projection([pausedRow(project, {
			taskKind: 'image-sequence-export', relativeDestination: target,
		})]),
		enqueue: async (row: Data) => { recorded = row; return {}; },
	}));
	const runtime = createRuntime(PROFILE, owner(project) as never);

	await runFramescaperNativeCarrierRegeneration(runtime, JOB);

	const request = recorded as unknown as Data;
	assert.equal(request.taskKind, 'image-sequence-export');
	assert.equal(request.relativeDestination, target);
	assert.equal(request.derivedInputStageId, null);
});

test('carrier regeneration stages its replacement carrier against the paused job', async (context) => {
	const project = silentCarrierProject();
	let staged: Data | null = null;
	let recorded: Data | null = null;
	install(context, liveServices({
		snapshot: async () => projection([pausedRow(project)]),
		stageLiveRenderInputs: async (row: Data) => {
			staged = row;
			return { stageId: STAGE, carrierByteLength: row.carrierByteLength, scratchByteLength: 4 };
		},
		enqueue: async (row: Data) => { recorded = row; return {}; },
	}));
	const runtime = createRuntime(PROFILE, owner(project, producer()) as never);

	await runFramescaperNativeCarrierRegeneration(runtime, JOB);

	const stage = staged as unknown as Data;
	const request = recorded as unknown as Data;
	assert.equal(stage.restartJobId, JOB, 'the stage must claim the job it regenerates');
	assert.deepEqual(stage.inputFingerprints, [{ sourceId: 'video-source', sha256: CONTENT }]);
	assert.equal(request.derivedInputStageId, STAGE);
	assert.equal(request.relativeDestination, destination(project));
	assert.equal((request.reservations as Data).scratchBytes, 4);
});

test('a rejected admission releases the serialized action for the next request', async (context) => {
	let selections = 0;
	install(context, liveServices({
		selectRoot: async () => {
			selections += 1;
			return selections === 1 ? { grantId: 'nope', displayName: 'Exports', revoked: false } : null;
		},
	}));
	const runtime = createRuntime(PROFILE, owner(carrierFreeProject()) as never);

	const first = enqueue(runtime);
	const second = enqueue(runtime);

	await assert.rejects(() => first, /destination root projection is invalid/u);
	await assert.doesNotReject(() => second);
	assert.equal(selections, 2);
});
