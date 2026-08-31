/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { deriveUnifiedExactOfxAbsentFreshnessV26 } from '../src/common/editor/native-ofx-freshness-authority.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import {
	createFramescaperOpenFxFrameExecutionService,
} from '../desktop/framescaper-openfx-frame-execution.ts';
import type { FramescaperOpenFxExecutionRequestV1 } from '../desktop/openfx-main-execution-request.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const SHA = 'a7'.repeat(32);

test('main reopens exact canonical V14 authority and resolves the enabled fingerprint itself', async () => {
	const fixture = requestFixture();
	const observed: FramescaperOpenFxExecutionRequestV1[] = [];
	const projectEffects: unknown[] = [];
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => [plugin()] as never,
		supportedGpuBackends: () => ['opengl'],
		currentProject: (_plan, effect) => {
			projectEffects.push(effect);
			return Boolean(effect && typeof effect === 'object'
				&& (effect as unknown as Record<string, unknown>).instanceId === 'ofx-1');
		},
		timingAssets: async () => [],
		execute: async (request) => {
			observed.push(request);
			return { mode: 'render', rgba: new Uint8Array(fixture.frameBytes).fill(23),
				availability: 'available', authoredStatePreserved: true,
				backend: 'cpu', retriedOnCpu: true, reportsDegradation: true,
				output: { streamId: 'ab'.repeat(20), byteLength: fixture.frameBytes, sha256: SHA },
			};
		},
	});
	const result = await service.execute(fixture.request);
	assert.equal(observed[0]?.pluginHandle, 'opaque-main-handle');
	assert.equal(observed[0]?.instanceId, 'ofx-1');
	assert.equal(observed[0]?.inputs[0]?.sourceRef, 'video-source');
	assert.equal(projectEffects.length, 1);
	assert.equal(result.mode, 'render');
	if (result.mode === 'render') {
		assert.equal(result.rgba.pixels[0], 23);
		assert.equal(result.retriedOnCpu, true);
	}
});

test('main refuses renderer-authored handles, changed fingerprints, input identities and noncanonical plans', async () => {
	const fixture = requestFixture();
	let inventory = [plugin()] as never;
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => inventory,
		supportedGpuBackends: () => [],
		currentProject: () => true,
		timingAssets: async () => [],
		execute: async () => bypass('missing'),
	});
	await assert.rejects(() => service.execute({ ...fixture.request,
		inputs: [{ ...fixture.request.inputs[0]!, sourceRef: 'forged-source' }],
	}), /named planes|identity/iu);
	inventory = [{ ...plugin(), binarySha256: 'b8'.repeat(32) }] as never;
	assert.deepEqual(await service.execute(fixture.request), {
		mode: 'bypass', availability: 'fingerprint-changed', reportsDegradation: true,
	});
	inventory = [plugin()] as never;
	await assert.rejects(() => service.execute({ ...fixture.request,
		planPayload: `${fixture.request.planPayload}\n`,
	}), /canonical/iu);
	await assert.rejects(() => service.execute({ ...fixture.request,
		inputs: [{ ...fixture.request.inputs[0]!, rgba: new Uint8Array(3) }],
	}), /RGBA/iu);
});

test('main projects unavailable execution without mutating the exact authored plan', async () => {
	const fixture = requestFixture();
	const before = fixture.request.planPayload;
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => [plugin()] as never,
		supportedGpuBackends: () => [],
		currentProject: () => true,
		timingAssets: async () => [],
		execute: async () => bypass('quarantined'),
	});
	assert.deepEqual(await service.execute(fixture.request), {
		mode: 'bypass', availability: 'quarantined', reportsDegradation: true,
	});
	assert.equal(fixture.request.planPayload, before);
});

test('a canonical same-revision forged effect is refused before missing-plugin fallback', async () => {
	const fixture = requestFixture();
	const raw = JSON.parse(fixture.request.planPayload) as unknown as {
		nodes: Array<{ kind: string; state?: { pluginId: string } }>;
	};
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect?.state) throw new Error('OpenFX fixture node is unavailable.');
	effect.state.pluginId = 'net.example.Forged';
	const plan = createUnifiedExactRenderPlan(raw);
	let inventories = 0;
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => { inventories += 1; return []; },
		supportedGpuBackends: () => [],
		currentProject: (_plan, authored) => authored.pluginId === 'net.example.Filter',
		timingAssets: async () => [],
		execute: async () => bypass('missing'),
	});
	await assert.rejects(() => service.execute({
		...fixture.request,
		planPayload: canonicalizeNativeMediaPlan(plan),
		planFingerprint: fingerprintNativeMediaPlan(plan).sha256,
	}), /current baseline project revision/iu);
	assert.equal(inventories, 0, 'fallback resolution cannot precede exact authored-effect authority');
});

test('main uses only verified GPU support and reports exact CPU degradation otherwise', async () => {
	const fixture = requestFixture();
	let supported = ['opengl'] as const;
	const backends: string[] = [];
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => [plugin()] as never,
		supportedGpuBackends: () => supported,
		currentProject: () => true,
		timingAssets: async () => [],
		execute: async (request) => {
			backends.push(request.requestedBackend);
			return { mode: 'render', rgba: new Uint8Array(fixture.frameBytes),
				availability: 'available', authoredStatePreserved: true,
				backend: request.requestedBackend, retriedOnCpu: false, reportsDegradation: false,
				output: { streamId: 'ab'.repeat(20), byteLength: fixture.frameBytes, sha256: SHA },
			};
		},
	});
	const preferred = await service.execute({
		...fixture.request, requestedBackend: 'supported-preferred',
	});
	assert.equal(preferred.mode === 'render' ? preferred.backend : null, 'opengl');
	supported = [] as never;
	const refused = await service.execute({ ...fixture.request, requestedBackend: 'metal' });
	assert.deepEqual(backends, ['opengl', 'cpu']);
	assert.equal(refused.mode === 'render' ? refused.backend : null, 'cpu');
	assert.equal(refused.mode === 'render' ? refused.retriedOnCpu : false, true);
	assert.equal(refused.reportsDegradation, true);
});

test('the missing-plugin frozen gate derives freshness from the plan, not the authored state', async () => {
	const buildRequest = (freshness: Record<string, unknown>, canvasSize: number) => {
		const options = framescaperV20Options();
		options.ofxEffects = [{
			schemaVersion: 1, instanceId: 'ofx-1', pluginId: 'net.example.Filter', binarySha256: SHA,
			context: 'filter', attachment: { kind: 'filter', targetId: 'video-clip' },
			inputs: [{ name: 'Source', sourceRef: 'video-source' }],
			parameters: [], customEncodings: {}, enabled: true, freshness,
			frozenFallback: {
				externalMediaSourceId: 'video-source', renderedAssetSha256: '12'.repeat(32),
				frameCount: 10, freshness,
			},
		}];
		const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
		const original = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
			FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
			createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
		);
		const raw = structuredClone(original) as unknown as Record<string, unknown>;
		const output = raw.output as Record<string, unknown>;
		output.canvas = { ...(output.canvas as Record<string, unknown>), width: canvasSize, height: canvasSize };
		const plan = createUnifiedExactRenderPlan(raw);
		return {
			plan,
			request: {
				protocolVersion: 1 as const,
				schemaFamily: 'framescaper' as const,
				schemaVersion: 1 as const,
				planPayload: canonicalizeNativeMediaPlan(plan),
				planFingerprint: fingerprintNativeMediaPlan(plan).sha256,
				instanceId: 'ofx-1', outputOrdinal: 0, requestedBackend: 'cpu' as const, transitionProgress: null,
				inputs: [{ name: 'Source', sourceRef: 'video-source', width: canvasSize, height: canvasSize,
					rgba: new Uint8Array(canvasSize * canvasSize * 4).fill(7) }],
			},
		};
	};
	const placeholder = { authoredStateSha256: SHA, inputIdentitiesSha256: SHA,
		renderPlanFingerprintSha256: SHA, nativeEffectFingerprintSha256: SHA };
	const frozenAt = buildRequest(placeholder, 2);
	const derived = deriveUnifiedExactOfxAbsentFreshnessV26(
		frozenAt.plan, 'ofx-1',
	) as unknown as Record<string, unknown>;
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => [],
		supportedGpuBackends: () => [],
		currentProject: () => true,
		timingAssets: async () => [],
		execute: async () => { throw new Error('a missing plug-in cannot execute'); },
	});
	const fresh = await service.execute(buildRequest(derived, 2).request);
	assert.equal(fresh.mode, 'frozen', 'an unedited plan still serves the authored freeze');
	// The authored freshness still agrees with itself, but the plan changed:
	// the frozen frames no longer correspond to it and must not be served.
	const stale = await service.execute(buildRequest(derived, 4).request);
	assert.equal(stale.mode, 'bypass', 'a plan edit must invalidate the frozen fallback');
});

function requestFixture() {
	const options = framescaperV20Options();
	options.ofxEffects = [{
		schemaVersion: 1, instanceId: 'ofx-1', pluginId: 'net.example.Filter', binarySha256: SHA,
		context: 'filter', attachment: { kind: 'filter', targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }], parameters: [], customEncodings: {}, enabled: true,
		freshness: { authoredStateSha256: SHA, inputIdentitiesSha256: SHA,
			renderPlanFingerprintSha256: SHA, nativeEffectFingerprintSha256: SHA }, frozenFallback: null,
	}];
	const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	const original = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const raw = structuredClone(original) as unknown as Record<string, unknown>;
	const output = raw.output as Record<string, unknown>;
	output.canvas = { ...(output.canvas as Record<string, unknown>), width: 2, height: 2 };
	const plan = createUnifiedExactRenderPlan(raw);
	const planPayload = canonicalizeNativeMediaPlan(plan);
	const planFingerprint = fingerprintNativeMediaPlan(plan).sha256;
	return {
		frameBytes: 16,
		request: {
			protocolVersion: 1 as const, schemaFamily: 'framescaper' as const,
			schemaVersion: 1 as const, planPayload, planFingerprint, instanceId: 'ofx-1',
			outputOrdinal: 0, requestedBackend: 'cpu' as const, transitionProgress: null,
			inputs: [{ name: 'Source', sourceRef: 'video-source', width: 2, height: 2,
				rgba: new Uint8Array(16).fill(7) }],
		},
	};
}

function plugin() {
	return {
		pluginHandle: 'opaque-main-handle', pluginId: 'net.example.Filter', binarySha256: SHA,
		state: 'enabled', quarantined: false,
	};
}

function bypass(availability: 'missing' | 'quarantined') {
	return {
		mode: 'bypass' as const, availability, reason: availability,
		authoredStatePreserved: true as const, reportsDegradation: true, frozenFallback: null,
	};
}
