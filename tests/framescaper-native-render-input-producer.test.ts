/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type {
	ProductNativeRenderInputOperation,
} from '../src/common/editor/controller/product-native-render-input-authority.ts';
import {
	acquireVideoExportTimingIndexes,
	type VideoExportTimingIndexLease,
} from '../src/common/editor/controller/video-export-timing.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
	NativeMediaPlanViolationError,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import type {
	FramescaperNativeRenderInputV1,
} from '../src/common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import type { UnifiedExactRenderPlanV14 } from '../src/common/editor/unified-exact-render-plan.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperNativeRenderPlanAuthorityNativeMedia,
} from '../src/framescaper/editor-native-render-plan-authority.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA as DEFAULTS,
	createFramescaperNativeCarrierFrameSourceNativeMedia as createFrameSource,
	createFramescaperNativeRenderInputProducerNativeMedia as createProducer,
	resolveFramescaperNativeRenderInputProducerDependenciesNativeMedia as resolveDependencies,
	streamFramescaperNativeRenderCarrierNativeMedia as streamCarrier,
	type FramescaperNativeRenderInputProducerAuthorityNativeMedia as ProducerAuthority,
	type FramescaperNativeRenderInputProducerDependenciesNativeMedia as Dependencies,
	type FramescaperNativeRenderInputRequestNativeMedia as InputRequest,
	type NativeRenderInputStoreNativeMedia as Store,
} from '../src/framescaper/editor-native-render-input-producer.ts';
import {
	framescaperProjectFinishingFoundationShapeNativeMedia as foundationShape,
} from '../src/framescaper/editor-project-native-media-foundation.ts';
import {
	createFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanNativeMedia,
} from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const CARRIER_SHA = 'a1'.repeat(32);
const AUDIO_SHA = 'b2'.repeat(32);

/** One 2x2, single-frame video project: the smallest plan the V14 authority mints. */
function projectOptions(): Data {
	const options = framescaperV20Options();
	options.sources = (options.sources as Data[]).filter(({ kind }) => kind === 'video').map((source) => ({
		...source, width: 2, height: 2, sourceFrameCount: 1, frameRate: { num: 1, den: 1 },
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
	}));
	options.clips = (options.clips as Data[]).filter(({ kind }) => kind === 'video')
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 }));
	options.projectBin = {
		clips: (options.projectBin as { clips: Data[] }).clips
			.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })),
	};
	options.tracks = (options.tracks as Data[]).filter(({ type }) => type === 'video');
	options.sequences = [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }];
	return options;
}

function fixture(mutate: (options: Data) => void = () => undefined) {
	const options = projectOptions();
	mutate(options);
	const project = createFramescaperProjectNativeMedia(PROFILE, options);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const request: InputRequest = Object.freeze({
		planPayload: canonicalizeNativeMediaPlan(plan),
		planFingerprint: fingerprintNativeMediaPlan(plan).sha256,
		projectId: String(project.id),
		projectRevision: Number(project.revision),
	});
	return { project, plan, request };
}

function movedFixture() {
	return fixture((options) => {
		(options.clips as Data[])[0]!.sequenceFrameCount = 2;
		(options.sources as Data[])[0]!.sourceFrameCount = 2;
	});
}

function store(load: Store['loadMediaAsset'] = async () => null): Store {
	return Object.freeze({ loadMediaAsset: load });
}

function operationDouble(project: FramescaperProjectNativeMedia, finish: () => void = () => undefined) {
	const controller = new AbortController();
	const calls = { finish: 0 };
	const operation: ProductNativeRenderInputOperation = Object.freeze({
		project: project as unknown as Readonly<Data>,
		signal: controller.signal,
		assertCurrent: () => undefined,
		renderAudio: async () => null,
		finish() { calls.finish += 1; finish(); },
	});
	return { operation, controller, calls };
}

function authorityDouble(operation: ProductNativeRenderInputOperation) {
	const calls = { begin: 0 };
	return { calls, value: Object.freeze({
		authority: Object.freeze({ begin() { calls.begin += 1; return operation; } }),
		store: store(),
	}) as ProducerAuthority };
}

/** The four required ports the producer never reaches once its carrier is injected. */
function unusedPorts(): Dependencies {
	const refuse = (name: string) => () => { throw new Error(`${name} is not reached by this test.`); };
	return {
		acquireTiming: refuse('timing') as unknown as Dependencies['acquireTiming'],
		createCanvas: refuse('canvas') as unknown as Dependencies['createCanvas'],
		createResolver: refuse('resolver') as unknown as Dependencies['createResolver'],
		createRenderer: refuse('renderer') as unknown as Dependencies['createRenderer'],
	};
}

function carrierBytes() {
	return Object.freeze({
		byteLength: 4, sha256: CARRIER_SHA, bytes: new Blob([Uint8Array.of(7, 7, 7, 7)]),
	});
}

function audioInput(): FramescaperNativeRenderInputV1 {
	return Object.freeze({
		role: 'staged-audio-mix' as const, byteLength: 2, sha256: AUDIO_SHA,
		bytes: new Blob([Uint8Array.of(1, 2)]),
	});
}

function producerFor(
	project: FramescaperProjectNativeMedia,
	overrides: Partial<Dependencies> = {},
	finish: () => void = () => undefined,
) {
	const double = operationDouble(project, finish);
	const authority = authorityDouble(double.operation);
	return {
		double, authority,
		produce: createProducer(PROFILE, authority.value, {
			...unusedPorts(),
			produceCarrier: (async () => carrierBytes()) as unknown as Dependencies['produceCarrier'],
			produceAudio: (async () => null) as unknown as Dependencies['produceAudio'],
			...overrides,
		}),
	};
}

function leasedTiming(release: (lease: VideoExportTimingIndexLease) => void): Dependencies['acquireTiming'] {
	return (async (...args: Parameters<typeof acquireVideoExportTimingIndexes>) => {
		const lease = await acquireVideoExportTimingIndexes(...args);
		return Object.freeze({ ...lease, release: () => release(lease) }) as VideoExportTimingIndexLease;
	}) as Dependencies['acquireTiming'];
}

test('complete carrier dependencies resolve to a frozen record that fills in both producers', () => {
	const ports = unusedPorts();

	const resolved = resolveDependencies(ports);

	assert.equal(Object.isFrozen(resolved), true);
	assert.equal(typeof resolved.produceCarrier, 'function');
	assert.equal(typeof resolved.produceAudio, 'function');
	assert.equal(resolved.acquireTiming, ports.acquireTiming);
	assert.equal(resolved.createCanvas, ports.createCanvas);
	assert.equal(resolved.createImageSequenceResolver, undefined);
});

test('supplied carrier and audio producers survive dependency resolution unreplaced', () => {
	const produceCarrier = (async () => carrierBytes()) as unknown as Dependencies['produceCarrier'];
	const produceAudio = (async () => null) as unknown as Dependencies['produceAudio'];

	const resolved = resolveDependencies({ ...unusedPorts(), produceCarrier, produceAudio });

	assert.equal(resolved.produceCarrier, produceCarrier);
	assert.equal(resolved.produceAudio, produceAudio);
});

test('every required carrier dependency port must be a function', () => {
	for (const port of ['acquireTiming', 'createCanvas', 'createResolver', 'createRenderer'] as const) {
		assert.throws(
			() => resolveDependencies({ ...unusedPorts(), [port]: undefined } as unknown as Dependencies),
			(error: unknown) => error instanceof TypeError
				&& /carrier dependencies are incomplete/u.test(String(error)),
			`${port} must be refused`,
		);
	}
	assert.throws(() => resolveDependencies(null as unknown as Dependencies), TypeError);
});

test('an optional carrier dependency port is refused when present but not callable', () => {
	const ports = [
		'createImageSequenceResolver', 'resolveNativeBridge', 'produceCarrier',
		'produceAudio', 'openFxExecute',
	] as const;
	for (const port of ports) {
		assert.throws(
			() => resolveDependencies({ ...unusedPorts(), [port]: 'nope' } as unknown as Dependencies),
			/carrier dependencies are incomplete/u,
			`${port} must be refused`,
		);
		assert.doesNotThrow(
			() => resolveDependencies({ ...unusedPorts(), [port]: undefined } as unknown as Dependencies),
		);
	}
});

test('the default dependency bundle refuses a host without a document and uses one when present', (t: TestContext) => {
	const scope = globalThis as unknown as Data;
	const previous = scope.document;
	t.after(() => {
		if (previous === undefined) delete scope.document;
		else scope.document = previous;
	});

	delete scope.document;
	assert.throws(() => DEFAULTS.createCanvas(), /requires a browser canvas/u);
	scope.document = { createElement: 'not-a-function' };
	assert.throws(() => DEFAULTS.createCanvas(), /requires a browser canvas/u);

	const created: string[] = [];
	scope.document = {
		createElement(tag: string) { created.push(tag); return { width: 0, height: 0 }; },
	};
	assert.deepEqual(DEFAULTS.createCanvas(), { width: 0, height: 0 });
	assert.deepEqual(created, ['canvas']);
});

test('a produced render input pairs the frozen evaluated carrier with the staged audio mix', async () => {
	const { project, request } = fixture();
	const seen: { plan?: UnifiedExactRenderPlanV14; project?: FramescaperProjectNativeMedia } = {};
	const { produce, double, authority } = producerFor(project, {
		produceCarrier: (async (plan: UnifiedExactRenderPlanV14, carried: FramescaperProjectNativeMedia) => {
			seen.plan = plan; seen.project = carried; return carrierBytes();
		}) as unknown as Dependencies['produceCarrier'],
		produceAudio: (async () => audioInput()) as unknown as Dependencies['produceAudio'],
	});

	const inputs = await produce(request);

	assert.equal(Object.isFrozen(inputs), true);
	assert.deepEqual(inputs.map(({ role }) => role), ['evaluated-rgba-frame-pack', 'staged-audio-mix']);
	assert.equal(inputs[0]?.sha256, CARRIER_SHA);
	assert.equal(inputs[0]?.byteLength, 4);
	assert.equal(Object.isFrozen(inputs[0]), true);
	assert.equal(inputs[1]?.sha256, AUDIO_SHA);
	assert.equal(seen.plan?.version, 14);
	assert.equal(seen.project?.id, project.id);
	assert.notEqual(seen.project, project, 'the producer carries its own admitted project clone');
	assert.equal(authority.calls.begin, 1);
	assert.equal(double.calls.finish, 1);
});

test('a plan that carries no audio yields the evaluated carrier alone', async () => {
	const { project, request } = fixture();
	const { produce, double } = producerFor(project);

	const inputs = await produce(request);

	assert.equal(inputs.length, 1);
	assert.equal(inputs[0]?.role, 'evaluated-rgba-frame-pack');
	assert.equal(double.calls.finish, 1);
});

test('an invalid render-input request is refused before any authority operation begins', async () => {
	const { project, request } = fixture();
	const { produce, double, authority } = producerFor(project);

	await assert.rejects(
		() => produce({ ...request, projectRevision: -1 } as InputRequest),
		(error: unknown) => error instanceof TypeError && /request is invalid/u.test(String(error)),
	);
	assert.equal(authority.calls.begin, 0);
	assert.equal(double.calls.finish, 0);
});

test('a request whose revision has moved on refuses the render and still finishes the operation', async () => {
	const { project, request } = fixture();
	const { produce, double } = producerFor(project);

	await assert.rejects(
		() => produce({ ...request, projectRevision: request.projectRevision + 1 }),
		/render request is stale/u,
	);
	assert.equal(double.calls.finish, 1);
});

test('a plan payload that is not JSON, not a V14 plan or not canonical is refused', async () => {
	const { project, request } = fixture();
	const { produce, double } = producerFor(project);

	await assert.rejects(
		() => produce({ ...request, planPayload: 'not json' }),
		(error: unknown) => error instanceof TypeError && /render plan is not JSON/u.test(String(error)),
	);
	await assert.rejects(
		() => produce({ ...request, planPayload: '{"version":9}' }),
		(error: unknown) => error instanceof NativeMediaPlanViolationError
			&& error.code === 'unsupported-version',
	);
	await assert.rejects(
		() => produce({ ...request, planPayload: `${request.planPayload} ` }),
		/no exact V14 identity/u,
	);
	assert.equal(double.calls.finish, 3);
});

test('a plan minted for a different project no longer matches its current project authority', async () => {
	const authored = fixture();
	const { produce, double } = producerFor(movedFixture().project);

	await assert.rejects(() => produce(authored.request), /changed from its current project authority/u);
	assert.equal(double.calls.finish, 1);
});

test('a cancelled operation refuses production with its own abort reason before the carrier runs', async () => {
	const { project, request } = fixture();
	const reason = new Error('the controller moved on');
	let carrierCalls = 0;
	const { produce, double } = producerFor(project, {
		produceCarrier: (async () => {
			carrierCalls += 1; return carrierBytes();
		}) as unknown as Dependencies['produceCarrier'],
	});
	double.controller.abort(reason);

	await assert.rejects(() => produce(request), (error: unknown) => error === reason);
	assert.equal(carrierCalls, 0);
	assert.equal(double.calls.finish, 1);
});

test('a carrier failure is rethrown unchanged once the operation has been finished', async () => {
	const { project, request } = fixture();
	const failure = new Error('the frame pack could not be spooled');
	const { produce, double } = producerFor(project, {
		produceCarrier: (async () => { throw failure; }) as unknown as Dependencies['produceCarrier'],
	});

	await assert.rejects(() => produce(request), (error: unknown) => error === failure);
	assert.equal(double.calls.finish, 1);
});

test('a cleanup failure on its own surfaces as the only render-input failure', async () => {
	const { project, request } = fixture();
	const cleanupFailure = new Error('the authority lease would not close');
	const { produce } = producerFor(project, {}, () => { throw cleanupFailure; });

	await assert.rejects(() => produce(request), (error: unknown) => error === cleanupFailure);
});

test('a carrier failure and a cleanup failure aggregate with the carrier failure as the cause', async () => {
	const { project, request } = fixture();
	const cleanupFailure = new Error('the authority lease would not close');
	const carrierFailure = new Error('the frame pack could not be spooled');
	const { produce } = producerFor(project, {
		produceCarrier: (async () => { throw carrierFailure; }) as unknown as Dependencies['produceCarrier'],
	}, () => { throw cleanupFailure; });

	await assert.rejects(() => produce(request), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [carrierFailure, cleanupFailure]);
		assert.equal(error.cause, carrierFailure);
		assert.match(error.message, /production and authority cleanup failed/u);
		return true;
	});
});

test('a producer refuses incomplete dependencies before it is ever called', () => {
	const authority = authorityDouble(operationDouble(fixture().project).operation);

	assert.throws(
		() => createProducer(PROFILE, authority.value, { createCanvas: () => ({}) } as unknown as Dependencies),
		/carrier dependencies are incomplete/u,
	);
	assert.equal(authority.calls.begin, 0);
});

test('the carrier frame source clocks the plan canvas across the requested sample range', () => {
	const { project, plan } = fixture();
	const exportProject = foundationShape(project) as unknown as Readonly<Data>;

	const source = createFrameSource({ plan, exportProject, startFrame: 0, endFrame: 48_000 });

	assert.equal(source.frameCount, 1);
	assert.equal(source.canvas.width, plan.output.canvas.width);
	assert.equal(source.canvas.height, plan.output.canvas.height);
	assert.deepEqual(source.canvas.frameRate, plan.output.frameRate);
	assert.equal(source.frame(0).index, 0);
	assert.throws(() => source.frame(1), RangeError);
	assert.throws(
		() => createFrameSource({ plan, exportProject, startFrame: 48_000, endFrame: 48_000 }),
		RangeError,
	);
});

test('a supplied presentation resolver is consulted for every carrier frame layer', () => {
	const { project, plan } = fixture();
	const consulted = new Error('presentation resolver reached');

	const source = createFrameSource({
		plan, exportProject: foundationShape(project) as unknown as Readonly<Data>,
		startFrame: 0, endFrame: 48_000,
		resolvePresentationDescriptor: () => { throw consulted; },
	});

	assert.throws(() => source.frame(0), (error: unknown) => error === consulted);
});

test('a carrier whose project no longer matches its plan is refused before any timing lease', async () => {
	const authored = fixture();
	const moved = movedFixture();
	const double = operationDouble(moved.project);
	let timingCalls = 0;

	await assert.rejects(
		() => streamCarrier(authored.plan, moved.project, store(), double.operation, {
			...unusedPorts(),
			acquireTiming: (async () => {
				timingCalls += 1; throw new Error('unreachable');
			}) as unknown as Dependencies['acquireTiming'],
		}, { write: () => undefined }),
		/exceed the exact inherited V13 Web carrier subset/u,
	);
	assert.equal(timingCalls, 0);
});

test('a video source the media store cannot supply refuses the carrier and releases its lease', async () => {
	const { project, plan } = fixture();
	const double = operationDouble(project);
	const requested: string[] = [];
	const released: string[] = [];
	const mediaStore = store(async (storageKey) => { requested.push(storageKey); return null; });

	await assert.rejects(
		() => streamCarrier(plan, project, mediaStore, double.operation, {
			...unusedPorts(),
			acquireTiming: leasedTiming((lease) => { released.push('released'); lease.release(); }),
		}, { write: () => undefined }),
		/Selected nativeMedia source video-source is unavailable/u,
	);
	assert.deepEqual(requested, ['video-source']);
	assert.deepEqual(released, ['released']);
});

test('a timing lease that will not release aggregates with the carrier failure it followed', async () => {
	const { project, plan } = fixture();
	const double = operationDouble(project);
	const releaseFailure = new Error('the timing lease would not release');

	await assert.rejects(
		() => streamCarrier(plan, project, store(), double.operation, {
			...unusedPorts(),
			acquireTiming: leasedTiming((lease) => { lease.release(); throw releaseFailure; }),
		}, { write: () => undefined }),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors.length, 2);
			assert.match(String(error.errors[0]), /is unavailable/u);
			assert.equal(error.errors[1], releaseFailure);
			assert.match(error.message, /carrier execution and cleanup did not both complete/u);
			return true;
		},
	);
});

test('a carrier source body that is missing, empty or not a Blob is refused alike', async () => {
	const { project, plan } = fixture();
	const bodies: readonly unknown[] = [null, new Blob([]), { size: 8 }];
	for (const body of bodies) {
		const double = operationDouble(project);
		await assert.rejects(
			() => streamCarrier(plan, project, store(async () => body as never), double.operation, {
				...unusedPorts(), acquireTiming: acquireVideoExportTimingIndexes,
			}, { write: () => undefined }),
			/Selected nativeMedia source video-source is unavailable/u,
			`${String(body)} must be refused`,
		);
	}
});

/*
 * Regression: the acquired timing lease carries an authenticated timing map,
 * which is deliberately not a `Map`, and the presentation authority admits its
 * timing only through `instanceof Map`. Handing the lease's map straight over
 * refused every keyed carrier render before it read a frame.
 */
test('a keyed carrier gets its authenticated timing past the presentation authority', async () => {
	const { project, plan } = fixture();
	const double = operationDouble(project);
	const body = new Blob([Uint8Array.of(9, 9, 9, 9)]);

	await assert.rejects(
		() => streamCarrier(plan, project, store(async () => body), double.operation, {
			...unusedPorts(), acquireTiming: acquireVideoExportTimingIndexes,
		}, { write: () => undefined }),
		(error: unknown) => {
			assert.doesNotMatch(
				String(error instanceof AggregateError ? error.errors[0] : error),
				/presentation timing must be a ReadonlyMap/u,
				'the authority must accept the timing the lease actually carries',
			);
			return true;
		},
	);
});
