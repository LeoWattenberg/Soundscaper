/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import type { ProductNativeRenderInputOperation } from '../src/common/editor/controller/product-native-render-input-authority.ts';
import {
	createFramescaperNativeCarrierFrameSourceV28,
	createFramescaperNativeRenderInputProducerV28,
	type FramescaperNativeRenderInputProducerDependenciesV28,
} from '../src/framescaper/editor-native-render-input-producer-v28.ts';
import { assertFramescaperNativeCarrierDispositionV28 } from '../src/framescaper/editor-native-render-carrier-semantics-v28.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from '../src/framescaper/editor-project-v28-foundation.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;

test('selected V28 finishes its controller lease after successful carrier production', async () => {
	const fixture = producerFixture();
	const inputs = await fixture.produce(fixture.request);
	assert.equal(fixture.finished(), 1);
	assert.deepEqual(inputs.map(({ role, byteLength, sha256 }) => ({ role, byteLength, sha256 })), [
		{ role: 'evaluated-rgba-frame-pack', byteLength: 3, sha256: '56'.repeat(32) },
		{ role: 'staged-audio-mix', byteLength: 2, sha256: '57'.repeat(32) },
	]);
});

test('selected V28 reports cleanup failure even after carrier production succeeds', async () => {
	const cleanup = new Error('controller lease cleanup failed');
	const fixture = producerFixture({ cleanup });
	await assert.rejects(() => fixture.produce(fixture.request), (error) => error === cleanup);
	assert.equal(fixture.finished(), 1);
});

test('selected V28 preserves both carrier and cleanup failures', async () => {
	const primary = new Error('carrier failed');
	const cleanup = new Error('controller lease cleanup failed');
	const fixture = producerFixture({ primary, cleanup });
	await assert.rejects(() => fixture.produce(fixture.request), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [primary, cleanup]);
		assert.equal(error.cause, primary);
		return true;
	});
	assert.equal(fixture.finished(), 1);
});

test('selected V28 proves its V14-to-V13 semantic projection before acquiring media', async () => {
	const timing = new Error('timing sentinel');
	const fixture = producerFixture({ useDefaultCarrier: true, timing });
	await assert.rejects(() => fixture.produce(fixture.request), (error) => error === timing);
	assert.equal(fixture.finished(), 1);
});

test('selected V28 carries an exact 60000/1001 image-sequence clock to media acquisition', async () => {
	const timing = new Error('high-rate image sequence reached timing');
	const fixture = producerFixture({
		useDefaultCarrier: true,
		timing,
		delivery: {
			kind: 'image-sequence', format: 'openexr',
			frameRate: { num: 60_000, den: 1_001 }, preserveAlpha: true,
		},
	});
	await assert.rejects(() => fixture.produce(fixture.request), (error) => error === timing);
	assert.equal(fixture.finished(), 1);
});

test('selected V28 evaluates 60000/1001 carrier ordinals and retime positions without cadence substitution', () => {
	const project = createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(), id: 'framescaper-v28-exact-clock', title: 'Exact clock',
	});
	const delivery = Object.freeze({
		kind: 'image-sequence' as const, format: 'openexr' as const,
		frameRate: Object.freeze({ num: 60_000, den: 1_001 }), preserveAlpha: true,
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project, delivery), delivery,
	);
	const calls: Array<Readonly<{
		readonly localSequencePosition: Readonly<{ readonly num: number; readonly den: number }>;
		readonly outputOrdinal?: number;
	}>> = [];
	const descriptor = Object.freeze({ authority: 'exact-60000-over-1001' });
	const source = createFramescaperNativeCarrierFrameSourceV28({
		plan, exportProject: framescaperProjectV27FoundationShapeV28(project),
		startFrame: plan.timebase.sampleStart,
		endFrame: plan.timebase.sampleStart + plan.timebase.sampleDuration,
		resolvePresentationDescriptor(request) {
			calls.push(request);
			return descriptor as never;
		},
	});

	assert.deepEqual(source.canvas.frameRate, { num: 60_000, den: 1_001 });
	assert.equal(source.frameCount, 60);
	const first = source.frame(0);
	const second = source.frame(1);
	const last = source.frame(59);
	assert.deepEqual(first.timelinePosition, { num: 0, den: 1 });
	assert.deepEqual(second.timelinePosition, { num: 4_004, den: 5 });
	assert.deepEqual(last.timelinePosition, { num: 236_236, den: 5 });
	assert.deepEqual(calls.map(({ outputOrdinal, localSequencePosition }) => ({
		outputOrdinal, localSequencePosition,
	})), [
		{ outputOrdinal: 0, localSequencePosition: { num: 0, den: 1 } },
		{ outputOrdinal: 1, localSequencePosition: { num: 1_001, den: 6_000 } },
		{ outputOrdinal: 59, localSequencePosition: { num: 59_059, den: 6_000 } },
	]);
	const entry = (second.layers[0] as {
		readonly clips: readonly [{ readonly presentationDescriptor: unknown }];
	}).clips[0];
	assert.equal(entry.presentationDescriptor, descriptor);
	assert.throws(() => source.frame(60), /outside the range/iu);
});

test('selected V28 admits reported professional source facts while retaining original authority', async () => {
	const timing = new Error('reported professional source reached timing');
	const fixture = producerFixture({
		useDefaultCarrier: true, timing, project: reportedProfessionalProject(),
	});
	await assert.rejects(() => fixture.produce(fixture.request), (error) => error === timing);
	assert.equal(fixture.finished(), 1);
});

test('selected V28 renders the authenticated identity foundation for one live OpenFX filter', async () => {
	const timing = new Error('OpenFX foundation reached timing');
	const fixture = producerFixture({
		useDefaultCarrier: true, timing, project: openFxIdentityProject(),
	});
	await assert.rejects(() => fixture.produce(fixture.request), (error) => error === timing);
	assert.equal(fixture.finished(), 1);
});

test('selected V28 native carrier disposition covers every OpenFX frame and reports degradation exactly', () => {
	const project = openFxIdentityProject();
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const nodes = plan.nodes.filter(({ kind }) => kind !== 'professional-media' && kind !== 'openfx');
	const effects = plan.nodes.flatMap((node) => node.kind === 'openfx'
		? Array.from({ length: plan.output.frameCount }, (_, outputOrdinal) => ({
			instanceId: node.state.instanceId, context: node.state.context, outputOrdinal,
			mode: 'render' as const, reportsDegradation: outputOrdinal === 0,
			backend: 'cpu' as const, retriedOnCpu: outputOrdinal === 0,
		})) : []);
	const disposition = {
		exactPlanVersion: 13 as const,
		nodeDispositions: nodes.map(({ nodeId, kind }) => ({
			nodeId, kind, disposition: 'executed' as const,
		})),
		captionDisposition: 'sidecar-only' as const, captionTrackIds: [],
		audioDisposition: 'shared-v21-delivery' as const, originalSourceIds: ['video-source'],
		unexplainedOmittedNodeIds: [], openFxDispositions: effects,
		reportsOpenFxDegradation: true,
	};
	assert.doesNotThrow(() => assertFramescaperNativeCarrierDispositionV28(plan, disposition));
	assert.throws(() => assertFramescaperNativeCarrierDispositionV28(plan, {
		...disposition, openFxDispositions: effects.slice(1),
	}), /does not cover every exact frame node/iu);
	assert.throws(() => assertFramescaperNativeCarrierDispositionV28(plan, {
		...disposition, reportsOpenFxDegradation: false,
	}), /degradation summary is contradictory/iu);
});

function producerFixture(options: Readonly<{
	readonly primary?: Error;
	readonly cleanup?: Error;
	readonly timing?: Error;
	readonly useDefaultCarrier?: boolean;
	readonly project?: ReturnType<typeof createFramescaperProjectV28>;
	readonly delivery?: Parameters<typeof createFramescaperNativeRenderPlanAuthorityV28>[1];
}> = {}) {
	const project = options.project ?? createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(), id: 'framescaper-v28-carrier', title: 'V28 carrier',
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project, options.delivery),
		options.delivery,
	);
	const planPayload = canonicalizeNativeMediaPlan(plan);
	let finishCount = 0;
	const operation: ProductNativeRenderInputOperation = {
		project: project as unknown as Readonly<Record<string, unknown>>,
		signal: new AbortController().signal,
		assertCurrent() {},
		async renderAudio() { throw new Error('audio rendering was not requested'); },
		finish() {
			finishCount += 1;
			if (options.cleanup) throw options.cleanup;
		},
	};
	const bytes = new Blob([new Uint8Array([1, 2, 3])]);
	const audio = new Blob([new Uint8Array([4, 5])]);
	const dependencies = {
		acquireTiming() { throw options.timing ?? new Error('timing acquisition was not requested'); },
		createCanvas() { throw new Error('canvas creation was not requested'); },
		createResolver() { throw new Error('resolver creation was not requested'); },
		createRenderer() { throw new Error('renderer creation was not requested'); },
		async produceAudio() { return Object.freeze({
			role: 'staged-audio-mix' as const, bytes: audio, byteLength: audio.size,
			sha256: '57'.repeat(32),
		}); },
		...(options.useDefaultCarrier ? {} : { async produceCarrier() {
			if (options.primary) throw options.primary;
			return Object.freeze({
				bytes, byteLength: bytes.size, sha256: '56'.repeat(32), chunkCount: 1,
			});
		} }),
	} as unknown as FramescaperNativeRenderInputProducerDependenciesV28;
	return Object.freeze({
		produce: createFramescaperNativeRenderInputProducerV28(PROFILE, {
			authority: Object.freeze({ begin: () => operation }),
			store: Object.freeze({ async loadMediaAsset() { return null; } }),
		}, dependencies),
		request: Object.freeze({
			planPayload, planFingerprint: fingerprintNativeMediaPlan(plan).sha256,
			projectId: String(project.id), projectRevision: Number(project.revision),
		}),
		finished: () => finishCount,
	});
}

function openFxIdentityProject() {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>)
		.filter(({ kind }) => kind !== 'audio');
	options.clips = (options.clips as Array<Record<string, unknown>>)
		.filter(({ kind }) => kind !== 'audio');
	options.tracks = (options.tracks as Array<Record<string, unknown>>)
		.filter(({ type }) => type !== 'audio');
	options.sequences = (options.sequences as Array<Record<string, unknown>>).map((sequence) => ({
		...sequence, trackIds: (sequence.trackIds as string[]).filter((id) => id !== 'audio-track'),
	}));
	const derived = createFramescaperProjectV28(PROFILE, options);
	return createFramescaperProjectV28(PROFILE, {
		...options,
		finishing: {
			sourceColorInterpretations: derived.videoSourceColorInterpretations.map(
				(interpretation) => ({
					...interpretation, primaries: 'bt709', transfer: 'bt709', matrix: 'rgb',
					range: 'full', provenance: 'user-override',
				}),
			),
		},
		ofxEffects: [{
			schemaVersion: 1, instanceId: 'ofx-live-filter', pluginId: 'net.example.Filter',
			binarySha256: 'a1'.repeat(32), context: 'filter',
			attachment: { kind: 'filter', targetId: 'video-clip' },
			inputs: [{ name: 'Source', sourceRef: 'video-source' }],
			parameters: [], customEncodings: {}, enabled: true,
			freshness: {
				authoredStateSha256: 'a1'.repeat(32), inputIdentitiesSha256: 'b2'.repeat(32),
				renderPlanFingerprintSha256: 'c3'.repeat(32),
				nativeEffectFingerprintSha256: 'd4'.repeat(32),
			},
			frozenFallback: null,
		}],
	});
}

function reportedProfessionalProject() {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? {
			...source, videoCodec: 'h264',
			characteristics: {
				backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
				videoCodec: 'h264', bitDepth: 10, pixelFormat: 'yuv420p10le', chromaFormat: '4:2:0',
			},
		} : source
	));
	return createFramescaperProjectV28(PROFILE, options);
}
