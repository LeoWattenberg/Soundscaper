/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import * as execution from '../desktop/framescaper-openfx-frame-execution.ts';
import * as transport from '../desktop/framescaper-openfx-frame-port.ts';
import { createFramescaperOpenFxFrameRegistration } from '../desktop/framescaper-openfx-frame-registration.mjs';
import { FramescaperNativeLiveRenderInputStaging } from '../desktop/native-services-live-render-input-staging.ts';
import { createFramescaperOpenFxFramePortClient } from '../src/common/editor/ui/framescaper-native-openfx-frame-client.ts';
import { createVideoKeyframeOfflineRgbaRenderer } from '../src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import { acquireVideoExportTimingIndexes } from '../src/common/editor/controller/export/video-export-timing.ts';
import {
	streamFramescaperNativeRenderCarrierNativeMedia,
	type FramescaperNativeRenderInputProducerDependenciesNativeMedia,
} from '../src/framescaper/editor-native-render-input-producer.ts';
import {
	OWNER, STAGE_ID, SOURCE_BYTES, beginRequest, byteDescriptor, claimRequest,
	liveFixture, openFxPlugin, queueRecord,
} from './helpers/framescaper-native-live-openfx-fixture.ts';

test('the current producer evaluates authored OpenFX once through the frame port and relays its authenticated carrier once', async (context) => {
	const harness = await setup(context);
	const { fixture, staging } = harness;
	await staging.beginLive(OWNER, beginRequest(fixture));
	await staging.finalize(OWNER, { stageId: STAGE_ID });
	await staging.claim(OWNER, claimRequest(fixture));
	await assert.rejects(() => staging.claim(OWNER, claimRequest(fixture)), /finalized exactly once/iu);
	const record = queueRecord(fixture);
	const input = await staging.inspect(record);
	const waiting = input.materialize(harness.root);
	const trailer = await harness.produce();
	assert.equal(harness.executions(), 1);
	assert.equal(harness.chunks.length, 3, 'file header, frame header, and evaluated pixels relay once');
	assert.deepEqual(await staging.completeLive(OWNER, {
		stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
		byteLength: trailer.byteLength, sha256: trailer.sha256,
	}), { byteLength: trailer.byteLength, sha256: trailer.sha256 });
	const [grant] = await waiting;
	if (grant?.type !== 'file') throw new Error('The current OpenFX carrier returned no helper file grant.');
	const bytes = new Uint8Array(await readFile(grant.path));
	assert.deepEqual(bytes, new Uint8Array(Buffer.concat(harness.chunks)));
	assert.equal(grant.sha256, byteDescriptor(bytes).sha256);
	assert.equal(grant.bytes, fixture.carrierByteLength);
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.equal(header.getUint32(35, true), 2);
	assert.equal(header.getUint32(39, true), 2);
	assert.equal(header.getBigUint64(43, true), 1n);
	assert.deepEqual([...bytes.slice(-16)], new Array<number>(16).fill(255), 'evaluated white pixels reach the helper unchanged');
	await input.materialize(harness.root);
	assert.equal(harness.executions(), 1, 'native CPU replay does not reevaluate OpenFX');
	await assert.rejects(() => input.materialize(harness.root), /only hardware and one CPU attempt/iu);
	await staging.settle(record, 'succeeded');
	assert.equal(await staging.revalidate(record), false);
});

test('a stale current project refuses the producer frame before native execution', async (context) => {
	const harness = await setup(context, false);
	await harness.staging.beginLive(OWNER, beginRequest(harness.fixture));
	await harness.staging.finalize(OWNER, { stageId: STAGE_ID });
	await harness.staging.claim(OWNER, claimRequest(harness.fixture));
	await assert.rejects(() => harness.produce(), /current baseline project revision/iu);
	assert.equal(harness.executions(), 0);
});

test('cancellation after frame evaluation aborts carrier production and pending helper replay', async (context) => {
	const harness = await setup(context);
	await harness.staging.beginLive(OWNER, beginRequest(harness.fixture));
	await harness.staging.finalize(OWNER, { stageId: STAGE_ID });
	await harness.staging.claim(OWNER, claimRequest(harness.fixture));
	const input = await harness.staging.inspect(queueRecord(harness.fixture));
	const refused = assert.rejects(input.materialize(harness.root), /cancel|ended|disposed/iu);
	harness.cancelAfterExecution = true;
	await assert.rejects(() => harness.produce(), /cancel/iu);
	await harness.staging.abandonOwner(OWNER);
	await refused;
	assert.equal(harness.executions(), 1);
});

for (const fault of ['sequence', 'trailer'] as const) {
	test(`the current OpenFX carrier refuses ${fault} substitution`, async (context) => {
		const harness = await setup(context);
		await harness.staging.beginLive(OWNER, beginRequest(harness.fixture));
		await harness.staging.finalize(OWNER, { stageId: STAGE_ID });
		await harness.staging.claim(OWNER, claimRequest(harness.fixture));
		if (fault === 'sequence') {
			await assert.rejects(() => harness.staging.writeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence: 1, offset: 0,
				bytes: Uint8Array.of(1),
			}), /sequence|order|offset/iu);
		} else {
			const trailer = await harness.produce();
			await assert.rejects(() => harness.staging.completeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
				byteLength: trailer.byteLength, sha256: 'ff'.repeat(32),
			}), /trailer|digest|sha256/iu);
		}
	});
}

async function setup(context: TestContext, current = true) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-openfx-current-replay-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fixture = liveFixture(true);
	const abort = new AbortController();
	let executed = 0;
	let listener: ((offer: never, port: never) => void) | null = null;
	const chunks: Buffer[] = [];
	const state = { cancelAfterExecution: false };
	const broker = await createFramescaperOpenFxFrameRegistration({
		openFxService: {
			inventory: () => [openFxPlugin()], supportedGpuBackends: () => [],
			execute: async (request: { inputs: readonly { rgba: Uint8Array }[] }) => {
				executed += 1;
				assert.equal(request.inputs[0]?.rgba.byteLength, 16);
				const rgba = new Uint8Array(16).fill(255);
				if (state.cancelAfterExecution) abort.abort(new Error('producer cancelled'));
				return { mode: 'render', rgba, availability: 'available', authoredStatePreserved: true,
					backend: 'cpu', retriedOnCpu: false, reportsDegradation: false,
					output: { streamId: '34'.repeat(20), ...byteDescriptor(rgba) } };
			},
		},
		currentProject: () => current,
		projectContextAuthority: { openFxTimingAssets: async () => [] },
		createMessageChannel: () => {
			const channel = new MessageChannel();
			return { hostPort: channel.port1 as never, helperPort: channel.port2 as never };
		},
		mintOpaqueId: () => '56'.repeat(20),
	}, { modules: [execution, transport] });
	context.after(() => broker.dispose());
	const client = createFramescaperOpenFxFramePortClient({
		openSession: async (request) => broker.open(OWNER, { postMessage(_channel, offer, ports) {
			listener?.(offer as never, ports[0] as never);
		} }, request as never),
		subscribeOffers(value) { listener = value as never; return () => { listener = null; }; },
		mintRequestNonce: () => '78'.repeat(20),
	});
	context.after(() => client.dispose());
	const staging = new FramescaperNativeLiveRenderInputStaging({
		root, mintStageId: () => STAGE_ID,
		createMessageChannel: () => { throw new Error('Durable carrier replay needs no helper port.'); },
	});
	context.after(() => staging.abandonOwner(OWNER));
	const canvas = () => ({ width: 2, height: 2, getContext: () => ({
		clearRect() {}, drawImage() {},
		getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }),
	}) }) as unknown as HTMLCanvasElement;
	const previous = globalThis.document;
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
	context.after(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }));
	const dependencies: FramescaperNativeRenderInputProducerDependenciesNativeMedia = {
		acquireTiming: acquireVideoExportTimingIndexes, createCanvas: canvas,
		createRenderer: createVideoKeyframeOfflineRgbaRenderer,
		createResolver: ({ sources }) => ({
			resolveSource: () => ({ sourceId: sources[0]!.sourceId, identity: sources[0]!.identity,
				drawable: canvas(), decodedWidth: 2, decodedHeight: 2, displayWidth: 2, displayHeight: 2,
				present() {}, dispose() {} }),
			dispose() {},
		}),
		openFxExecute: (request) => client.execute(request),
	};
	const operation = { project: fixture.project as unknown as Readonly<Record<string, unknown>>,
		signal: abort.signal, assertCurrent() {}, renderAudio: async () => null, finish() {} };
	let sequence = 0; let offset = 0;
	return Object.assign(state, { root, fixture, staging, chunks, executions: () => executed,
		produce: () => streamFramescaperNativeRenderCarrierNativeMedia(
			fixture.plan, fixture.project, { loadMediaAsset: async () => new Blob([SOURCE_BYTES]) },
			operation, dependencies, { write: async (bytes) => {
				chunks.push(Buffer.from(bytes));
				await staging.writeLive(OWNER, { stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
					sequence, offset, bytes });
				sequence += 1; offset += bytes.byteLength;
			} },
		),
	});
}
