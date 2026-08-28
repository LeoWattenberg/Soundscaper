/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import {
	createFramescaperOpenFxFramePortBroker,
} from '../desktop/framescaper-openfx-frame-port.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	createUnifiedExactRenderPlan,
	type UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { createFramescaperOpenFxFramePortClient } from '../src/common/editor/ui/framescaper-native-openfx-frame-client.ts';
import { createFramescaperNativeOpenFxFrameRuntimeNativeMedia } from '../src/common/editor/ui/framescaper-native-openfx-frame-runtime.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('the renderer runtime closes a forged same-window offer without throwing', () => {
	const windowIdentity = {};
	let receive: ((event: unknown) => void) | null = null;
	let closes = 0;
	const runtime = createFramescaperNativeOpenFxFrameRuntimeNativeMedia({
		openOpenFxFrameSession: async () => ({
			protocolVersion: 1, sessionId: '00'.repeat(20), requestNonce: '11'.repeat(20),
		}),
	} as never, {
		window: windowIdentity as Window,
		addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
			receive = listener as (event: unknown) => void;
		},
		removeEventListener() { receive = null; },
	});
	assert.doesNotThrow(() => receive?.({
		source: windowIdentity,
		data: { type: 'framescaper-openfx-frame-port-v1', offer: {
			protocolVersion: 1, sessionId: '../bad', requestNonce: '11'.repeat(20),
		} },
		ports: [{ close() { closes += 1; } }],
	}));
	assert.equal(closes, 1);
	assert.doesNotThrow(() => receive?.({
		source: windowIdentity,
		data: { type: 'framescaper-openfx-frame-port-v1', offer: {
			protocolVersion: 1, sessionId: '00'.repeat(20), requestNonce: '11'.repeat(20),
		} },
		ports: [{ close() { closes += 1; } }, { close() { closes += 1; } }],
	}));
	assert.equal(closes, 3);
	const hostile = Object.defineProperty({}, 'type', {
		enumerable: true, get() { throw new Error('renderer accessor must not escape'); },
	});
	assert.doesNotThrow(() => receive?.({
		source: windowIdentity, data: hostile, ports: [{ close() { closes += 1; } }],
	}));
	assert.equal(closes, 4);
	runtime?.dispose();
});

test('the pathless OpenFX frame port carries only digest-bound RGBA with one-in-flight backpressure', async (context) => {
	let offerListener: ((offer: never, port: never) => void) | null = null;
	const owner = {};
	const controls: unknown[] = [];
	let rejectedOfferCloses = 0;
	const broker = createFramescaperOpenFxFramePortBroker({
		service: { execute: async (request) => {
			assert.deepEqual(request.inputs.map(({ name, sourceRef }) => [name, sourceRef]), [
				['SourceFrom', 'outgoing'], ['SourceTo', 'incoming'],
			]);
			const output = Uint8Array.from(request.inputs[0]!.rgba, (byte) => 255 - byte);
			return { mode: 'render', rgba: { width: 2, height: 2, pixels: output },
				backend: 'cpu', retriedOnCpu: true, reportsDegradation: true };
		} },
		createMessageChannel: () => {
			const channel = new MessageChannel();
			return { hostPort: channel.port1 as never, helperPort: channel.port2 as never };
		},
		mintOpaqueId: () => 'ab'.repeat(20),
	});
	context.after(() => broker.dispose());
	const sender = { postMessage(_channel: string, offer: unknown, ports: readonly unknown[]) {
		controls.push(offer);
		offerListener?.({ ...(offer as object), requestNonce: 'ff'.repeat(20) } as never, {
			close() { rejectedOfferCloses += 1; },
		} as never);
		offerListener?.(offer as never, ports[0] as never);
		offerListener?.(offer as never, { close() { rejectedOfferCloses += 1; } } as never);
	} };
	const client = createFramescaperOpenFxFramePortClient({
		openSession: async (request) => broker.open(owner, sender, request as never),
		subscribeOffers(listener) { offerListener = listener as never; return () => { offerListener = null; }; },
		mintRequestNonce: () => '01'.repeat(20),
	});
	context.after(() => client.dispose());
	const signal = new AbortController().signal;
	const outgoing = frame(1);
	const incoming = frame(2);
	const result = await client.execute({
		plan: plan(), instanceId: 'effect-transition', context: 'transition', outputOrdinal: 0,
		requestedBackend: 'opengl', inputs: [
			{ name: 'SourceFrom', sourceRef: 'outgoing', rgba: outgoing },
			{ name: 'SourceTo', sourceRef: 'incoming', rgba: incoming },
		], standardParameters: { Transition: 0.25 }, signal,
	});
	assert.equal(result.mode, 'render');
	if (result.mode === 'render') {
		assert.deepEqual([...result.rgba.pixels], [...outgoing.pixels].map((byte) => 255 - byte));
		assert.equal(result.retriedOnCpu, true);
	}
	assert.deepEqual(controls, [{
		protocolVersion: 1, sessionId: 'ab'.repeat(20), requestNonce: '01'.repeat(20),
	}]);
	assert.equal(rejectedOfferCloses, 2);
	assert.equal(JSON.stringify(controls).includes('rgba'), false);
});

test('the broker refuses path fields, descriptor gaps, oversize and concurrent owner sessions', async () => {
	const channels: MessageChannel[] = [];
	const broker = createFramescaperOpenFxFramePortBroker({
		service: { execute: async () => new Promise<never>(() => undefined) },
		createMessageChannel: () => {
			const channel = new MessageChannel(); channels.push(channel);
			return { hostPort: channel.port1 as never, helperPort: channel.port2 as never };
		},
		mintOpaqueId: () => 'cd'.repeat(20),
	});
	const owner = {};
	const sender = { postMessage() {} };
	const request = control();
	assert.throws(() => broker.open(owner, sender, { ...request, path: '/tmp/plugin.ofx' } as never), /closed/iu);
	assert.throws(() => broker.open(owner, sender, { ...request,
		inputs: [{ ...request.inputs[0]!, offset: 1 }],
	} as never), /descriptor/iu);
	broker.open(owner, sender, request as never);
	assert.throws(() => broker.open(owner, sender, request as never), /one active|backpressure/iu);
	assert.equal(broker.disposeOwner(owner), 1);
	for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
});

test('the broker authenticates bounded exact V14 control before creating a data-plane channel', () => {
	let channels = 0;
	let executions = 0;
	const broker = createFramescaperOpenFxFramePortBroker({
		service: { execute: async () => { executions += 1; return new Promise<never>(() => undefined); } },
		createMessageChannel: () => {
			channels += 1;
			const channel = new MessageChannel();
			return { hostPort: channel.port1 as never, helperPort: channel.port2 as never };
		},
		mintOpaqueId: () => 'ce'.repeat(20),
	});
	const owner = {};
	const sender = { postMessage() {} };
	const request = control();
	assert.throws(() => broker.open(owner, sender, {
		...request, planPayload: 'x'.repeat(16 * 1024 * 1024 + 1),
	} as never), /bounded|plan/iu);
	assert.throws(() => broker.open(owner, sender, {
		...request, planPayload: `${request.planPayload}\n`,
	} as never), /canonical|exact/iu);
	assert.equal(channels, 0);
	assert.equal(executions, 0);
	broker.dispose();
});

test('a zero-input Generator uses a closed null ingress binding and bounded output port', async (context) => {
	let listener: ((offer: never, port: never) => void) | null = null;
	let controlValue: unknown;
	const broker = createFramescaperOpenFxFramePortBroker({
		service: { execute: async (request) => {
			assert.deepEqual(request.inputs, []);
			return { mode: 'render', rgba: frame(9), backend: 'cpu', retriedOnCpu: false,
				reportsDegradation: false };
		} },
		createMessageChannel: () => {
			const channel = new MessageChannel();
			return { hostPort: channel.port1 as never, helperPort: channel.port2 as never };
		},
		mintOpaqueId: () => 'ef'.repeat(20),
	});
	context.after(() => broker.dispose());
	const client = createFramescaperOpenFxFramePortClient({
		openSession: async (request) => {
			controlValue = request;
			return broker.open({}, { postMessage(_channel, offer, ports) {
				listener?.(offer as never, ports[0] as never);
			} }, request as never);
		},
		subscribeOffers(value) { listener = value as never; return () => { listener = null; }; },
		mintRequestNonce: () => '02'.repeat(20),
	});
	context.after(() => client.dispose());
	const result = await client.execute({
		plan: plan(), instanceId: 'effect-generator', context: 'generator', outputOrdinal: 0,
		requestedBackend: 'cpu', inputs: [], standardParameters: {}, signal: new AbortController().signal,
	});
	assert.equal(result.mode, 'render');
	assert.equal((controlValue as { inputBinding: unknown }).inputBinding, null);
	assert.deepEqual((controlValue as { inputs: unknown[] }).inputs, []);
});

test('renderer close aborts main execution after ingress, including a zero-input Generator', async (context) => {
	let listener: ((offer: never, port: never) => void) | null = null;
	let executionStarted!: () => void;
	const started = new Promise<void>((resolve) => { executionStarted = resolve; });
	let mainAborted = false;
	const broker = createFramescaperOpenFxFramePortBroker({
		service: { execute: async (request) => {
			executionStarted();
			await new Promise<void>((_resolve, reject) => request.signal?.addEventListener('abort', () => {
				mainAborted = true; reject(request.signal?.reason);
			}, { once: true }));
			throw new Error('unreachable');
		} },
		createMessageChannel: () => {
			const channel = new MessageChannel();
			return { hostPort: channel.port1 as never, helperPort: channel.port2 as never };
		},
		mintOpaqueId: () => '12'.repeat(20),
	});
	context.after(() => broker.dispose());
	const owner = {};
	const client = createFramescaperOpenFxFramePortClient({
		openSession: async (request) => broker.open(owner, { postMessage(_channel, offer, ports) {
			listener?.(offer as never, ports[0] as never);
		} }, request as never),
		subscribeOffers(value) { listener = value as never; return () => { listener = null; }; },
		mintRequestNonce: () => '03'.repeat(20),
	});
	context.after(() => client.dispose());
	const abort = new AbortController();
	const execution = client.execute({
		plan: plan(), instanceId: 'effect-generator', context: 'generator', outputOrdinal: 0,
		requestedBackend: 'cpu', inputs: [], standardParameters: {}, signal: abort.signal,
	});
	await started;
	abort.abort(new Error('renderer cancelled'));
	await assert.rejects(execution, /renderer cancelled/iu);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(mainAborted, true);
});

test('the renderer refuses hostile mode records before they become fallback state', async () => {
	let listener: ((offer: never, port: never) => void) | null = null;
	let closes = 0;
	const sessionId = '76'.repeat(20);
	const requestNonce = '75'.repeat(20);
	const port = {
		onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
		onmessageerror: null as ((event: MessageEvent<unknown>) => void) | null,
		postMessage() {},
		start() {
			setTimeout(() => this.onmessage?.({ data: {
				protocolVersion: 1, type: 'result', sessionId, mode: 'bypass',
				availability: 'missing', reportsDegradation: true, path: '/private/plugin.ofx',
			} } as MessageEvent<unknown>), 0);
		},
		close() { closes += 1; },
	};
	const client = createFramescaperOpenFxFramePortClient({
		openSession: async () => {
			listener?.({ protocolVersion: 1, sessionId, requestNonce } as never, port as never);
			return { protocolVersion: 1, sessionId, requestNonce };
		},
		subscribeOffers(value) { listener = value as never; return () => { listener = null; }; },
		mintRequestNonce: () => requestNonce,
	});
	await assert.rejects(() => client.execute({
		plan: plan(), instanceId: 'effect-generator', context: 'generator', outputOrdinal: 0,
		requestedBackend: 'cpu', inputs: [], standardParameters: {}, signal: new AbortController().signal,
	}), /fallback result|closed record/iu);
	assert.equal(closes, 1);
	client.dispose();
});

function control() {
	const pixels = new Uint8Array(16);
	const sha256 = '37'.repeat(32);
	const exactPlan = plan();
	return {
		protocolVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
		planPayload: canonicalizeNativeMediaPlan(exactPlan),
		planFingerprint: fingerprintNativeMediaPlan(exactPlan).sha256,
		instanceId: 'effect-filter', outputOrdinal: 0, requestedBackend: 'cpu',
		requestNonce: '04'.repeat(20),
		transitionProgress: null,
		inputs: [{ name: 'Source', sourceRef: 'source', width: 2, height: 2,
			offset: 0, byteLength: pixels.byteLength, sha256 }],
		inputBinding: { dataPlaneVersion: 1, transport: 'message-port', streamId: '37'.repeat(20),
			direction: 'host-to-helper', byteLength: pixels.byteLength, sha256,
			maximumChunkBytes: 16 * 1024 * 1024, maximumInFlightChunks: 1 },
	};
}

function frame(value: number) {
	return { width: 2, height: 2, pixels: new Uint8Array(16).fill(value) };
}

function plan(): UnifiedExactRenderPlanV14 {
	const options = framescaperV20Options();
	options.ofxEffects = [{
		schemaVersion: 1, instanceId: 'effect-filter', pluginId: 'net.example.Filter',
		binarySha256: 'a7'.repeat(32), context: 'filter',
		attachment: { kind: 'filter', targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }], parameters: [], customEncodings: {}, enabled: true,
		freshness: { authoredStateSha256: 'a7'.repeat(32), inputIdentitiesSha256: 'a7'.repeat(32),
			renderPlanFingerprintSha256: 'a7'.repeat(32), nativeEffectFingerprintSha256: 'a7'.repeat(32) },
		frozenFallback: null,
	}];
	const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	const original = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const raw = structuredClone(original);
	return createUnifiedExactRenderPlan({
		...raw,
		output: { ...raw.output, canvas: { ...raw.output.canvas, width: 2, height: 2 } },
	}) as UnifiedExactRenderPlanV14;
}
