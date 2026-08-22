/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalizeNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import {
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import type { FramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import {
	bindFramescaperNativeCandidateProjectActions,
} from '../src/framescaper/editor-native-candidate-project-actions.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV25,
} from '../src/framescaper/editor-project-unified-render-plan-v25.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV26,
} from '../src/framescaper/editor-project-unified-render-plan-v26.ts';
import type {
	FramescaperImageSequenceNativeAdmissionRequestV25,
} from '../src/framescaper/editor-native-image-sequence-import-v25.ts';
import {
	FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectStoreV25 } from '../src/framescaper/editor-project-store-v25.ts';
import { createFramescaperProjectStoreV26 } from '../src/framescaper/editor-project-store-v26.ts';
import { createFramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { createFramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const PROFILE = FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
const PROXY_ROWS = ['codec-native-ffmpeg-current-set', 'codec-encode-prores-mov-proxy'] as const;
const IMAGE_SEQUENCE_ROWS = [
	'codec-native-ffmpeg-current-set',
	'codec-decode-png-image-sequence',
	'codec-decode-tiff-image-sequence',
	'codec-decode-openexr-image-sequence',
] as const;
const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);

test('the dormant V26 adapter binds all seven actions through queue, history, repository, and proxy lifecycle', async () => {
	const store = createFramescaperProjectStoreV26(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(), id: 'candidate-v26-actions',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	await store.projectRepository.createIfAbsent!(project);
	const owner = Object.freeze({ candidate: 26 });
	const queued: unknown[] = [];
	const proxies: unknown[] = [];
	const cleaned: string[] = [];
	let reattested = 0;
	let proxyAttachment = attachment('22'.repeat(32));
	const binding = await bindFramescaperNativeCandidateProjectActions({
		owner, profile: PROFILE, store, projectId: String(project.id),
		intents: {
			imageSequenceImport: () => imageSequenceSelection(),
			renderQueueEnqueue: (current) => queueRequest(current),
			proxyGenerate: () => ({ sourceId: 'video-source', clearedPolicyRowIds: PROXY_ROWS }),
			proxyAttach: () => ({ sourceId: 'video-source', attachment: proxyAttachment }),
			proxyDetach: () => ({ sourceId: 'video-source' }),
			proxyRelink: () => {
				proxyAttachment = attachment('33'.repeat(32));
				return { sourceId: 'video-source', attachment: proxyAttachment };
			},
			ofFxAdd: () => effect(),
		},
		imageSequence: imageSequencePorts(),
		nativeServices: {
			enqueue: async (request) => { queued.push(request); return {}; },
			scanOpenFxPlugin: async () => openFxPlugin(),
		},
		proxy: {
			enqueueProxy: (job) => { proxies.push(job); return 'proxy-job-1'; },
			reattestAttachment: () => { reattested += 1; return true; },
			cleanupBody: (storageKey) => { cleaned.push(storageKey); },
		},
		now: () => '2026-08-22T18:00:00.000Z',
	});
	const runtime = framescaperNativeProjectActionRuntimeFor(owner);
	assert.equal(runtime, binding.runtime);
	assert.deepEqual(runtime?.surfaces, [
		'image-sequence-import', 'render-queue-enqueue', 'proxy-generate',
		'proxy-attach', 'proxy-detach', 'proxy-relink', 'ofx-add',
	]);
	for (const surface of runtime!.surfaces) await runtime!.run(surface);

	const saved = await store.projectRepository.load(String(project.id)) as FramescaperProjectV26;
	assert.equal((saved.sources as readonly Readonly<Record<string, unknown>>[])
		.some(({ id }) => id === 'sequence-source'), true);
	assert.equal((video(saved).proxyAttachment as Readonly<Record<string, unknown>>)?.sha256, '33'.repeat(32));
	assert.equal(saved.ofxEffects[0]?.instanceId, 'ofx-instance-added');
	assert.equal(saved.revision, Number(project.revision) + 5);
	assert.equal(queued.length, 1);
	assert.equal((queued[0] as Readonly<{ planVersion?: unknown }>).planVersion, 12);
	assert.equal(proxies.length, 1);
	assert.equal(reattested, 2);
	assert.deepEqual(cleaned, [
		`video-proxy-sha256:${'22'.repeat(32)}`,
		`video-timing-sha256:${'44'.repeat(32)}`,
	]);
});

test('V25 advertises no OpenFX action and selected V20 cannot receive a candidate binding', async () => {
	const store = createFramescaperProjectStoreV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, {
		indexedDB: null,
	});
	const project = createFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, {
		...framescaperV20Options(), id: 'candidate-v25-actions',
		videoTransitionsByTrackId: { 'video-track': [] },
	});
	await store.projectRepository.createIfAbsent!(project);
	const v25Owner = Object.freeze({ candidate: 25 });
	const options = baseOptions(v25Owner, store, project);
	const queuedVersions: unknown[] = [];
	const binding = await bindFramescaperNativeCandidateProjectActions({
		...options,
		nativeServices: { enqueue: async (request) => {
			queuedVersions.push(request.planVersion);
			return {};
		}, scanOpenFxPlugin: async () => openFxPlugin() },
	});
	assert.deepEqual(binding.runtime.surfaces, [
		'image-sequence-import', 'render-queue-enqueue', 'proxy-generate',
		'proxy-attach', 'proxy-detach', 'proxy-relink',
	]);
	await binding.runtime.run('render-queue-enqueue');
	assert.deepEqual(queuedVersions, [11]);
	await assert.rejects(() => binding.runtime.run('ofx-add'), /unavailable/u);

	const selectedOwner = Object.freeze({ selected: 20 });
	await assert.rejects(() => bindFramescaperNativeCandidateProjectActions({
		...options, owner: selectedOwner, profile: FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
	}), /only.*dormant V25\/V26/iu);
	assert.equal(framescaperNativeProjectActionRuntimeFor(selectedOwner), null);
});

test('stale render requests and incomplete V26 intent ports fail before mutation', async () => {
	const store = createFramescaperProjectStoreV26(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(), id: 'candidate-v26-hostile',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	await store.projectRepository.createIfAbsent!(project);
	const owner = Object.freeze({ candidate: 'hostile' });
	const options = baseOptions(owner, store, project, {
		renderQueueEnqueue: (current: Readonly<Record<string, unknown>>) => ({
			...queueRequest(current), projectRevision: Number(current.revision) + 1,
		}),
	});
	const binding = await bindFramescaperNativeCandidateProjectActions({
		...options, profile: PROFILE,
		intents: { ...options.intents, ofFxAdd: () => effect() },
	});
	await assert.rejects(() => binding.runtime.run('render-queue-enqueue'), /stale|another project/u);
	assert.equal((await store.projectRepository.load(String(project.id)))?.revision, project.revision);

	const incompleteOwner = Object.freeze({ candidate: 'incomplete' });
	await assert.rejects(() => bindFramescaperNativeCandidateProjectActions({
		...options, owner: incompleteOwner, profile: PROFILE,
		intents: { ...options.intents, ofFxAdd: undefined },
	}), /intent ofFxAdd|OpenFX intent/iu);
	assert.equal(framescaperNativeProjectActionRuntimeFor(incompleteOwner), null);

	const extraOwner = Object.freeze({ candidate: 'extra-intent' });
	await assert.rejects(() => bindFramescaperNativeCandidateProjectActions({
		...options, owner: extraOwner, profile: PROFILE,
		intents: {
			...options.intents, ofFxAdd: () => effect(), unexpected: () => null,
		} as unknown as typeof options.intents,
	}), /exact method record/u);
	assert.equal(framescaperNativeProjectActionRuntimeFor(extraOwner), null);
});

test('a proxy candidate is reattested before attach can mutate history or storage', async () => {
	const store = createFramescaperProjectStoreV26(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(), id: 'candidate-v26-proxy-attestation',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	await store.projectRepository.createIfAbsent!(project);
	const owner = Object.freeze({ candidate: 'proxy-attestation' });
	const options = baseOptions(owner, store, project, {
		proxyAttach: () => ({ sourceId: 'video-source', attachment: attachment('77'.repeat(32)) }),
	});
	const binding = await bindFramescaperNativeCandidateProjectActions({
		...options, profile: PROFILE,
		intents: { ...options.intents, ofFxAdd: () => effect() },
		proxy: { ...options.proxy, reattestAttachment: () => false },
	});
	await assert.rejects(() => binding.runtime.run('proxy-attach'), /could not be reattested/u);
	const saved = await store.projectRepository.load(String(project.id)) as FramescaperProjectV26;
	assert.equal(saved.revision, project.revision);
	assert.equal(video(saved).proxyAttachment, null);
});

test('direct candidate queue, proxy, and OpenFX calls remain fail-closed behind runtime evidence', async () => {
	const store = createFramescaperProjectStoreV26(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(), id: 'candidate-v26-runtime-gate',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	await store.projectRepository.createIfAbsent!(project);
	let intents = 0;
	const options = baseOptions(Object.freeze({ candidate: 'runtime-gate' }), store, project, {
		renderQueueEnqueue: () => { intents += 1; return null; },
		proxyGenerate: () => { intents += 1; return null; },
	});
	const binding = await bindFramescaperNativeCandidateProjectActions({
		...options, profile: PROFILE,
		intents: { ...options.intents, ofFxAdd: () => { intents += 1; return null; } },
		imageSequence: {
			...options.imageSequence,
			capabilities: () => createNativeMediaCapabilitySnapshotV1({
				masterEnabled: false,
				entries: [
					{ domain: 'queue' as const, id: 'persistent-render-queue' },
					{ domain: 'codec' as const, id: 'encode-mov-prores-proxy' },
					{ domain: 'ofx' as const, id: 'isolated-host' },
				].map((entry) => ({ ...entry, policyCleared: true, buildSupported: true,
					probeSucceeded: true, selfTestPassed: true, userEnabled: true })),
			}),
		},
	});
	for (const surface of ['render-queue-enqueue', 'proxy-generate', 'ofx-add'] as const) {
		await assert.rejects(() => binding.runtime.run(surface), /unavailable.*native runtime/iu);
	}
	assert.equal(intents, 0);
});

test('V26 Add OFX binds authored state to the exact pathless enabled scan result', async () => {
	const store = createFramescaperProjectStoreV26(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(), id: 'candidate-v26-ofx-fingerprint',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	await store.projectRepository.createIfAbsent!(project);
	let scans = 0;
	const options = baseOptions(Object.freeze({ candidate: 'ofx-fingerprint' }), store, project);
	const binding = await bindFramescaperNativeCandidateProjectActions({
		...options, profile: PROFILE,
		intents: { ...options.intents, ofFxAdd: () => effect() },
		nativeServices: {
			enqueue: async () => ({}),
			scanOpenFxPlugin: async () => { scans += 1; return openFxPlugin({ binarySha256: SHA_B }); },
		},
	});
	await assert.rejects(() => binding.runtime.run('ofx-add'), /fingerprint|selected binary/iu);
	assert.equal(scans, 1);
	const saved = await store.projectRepository.load(String(project.id)) as FramescaperProjectV26;
	assert.equal(saved.revision, project.revision);
	assert.deepEqual(saved.ofxEffects, []);
});

test('candidate render queue authoring refuses an earlier-generation plan before enqueue', async () => {
	const store = createFramescaperProjectStoreV26(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(), id: 'candidate-v26-plan-generation',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	await store.projectRepository.createIfAbsent!(project);
	let enqueued = 0;
	const owner = Object.freeze({ candidate: 'plan-generation' });
	const options = baseOptions(owner, store, project, {
		renderQueueEnqueue: (current: Readonly<Record<string, unknown>>) => {
			const legacy = legacyQueueRequest(current);
			return { ...legacy, planVersion: 12 as const, derivedInputStageId: null };
		},
	});
	const binding = await bindFramescaperNativeCandidateProjectActions({
		...options, profile: PROFILE,
		intents: { ...options.intents, ofFxAdd: () => effect() },
		nativeServices: {
			enqueue: async () => { enqueued += 1; return {}; },
			scanOpenFxPlugin: async () => openFxPlugin(),
		},
	});
	await assert.rejects(
		() => binding.runtime.run('render-queue-enqueue'),
		/V26.*V12|render plan.*12/iu,
	);
	assert.equal(enqueued, 0);
});

function baseOptions(
	owner: object,
	store: ReturnType<typeof createFramescaperProjectStoreV25> | ReturnType<typeof createFramescaperProjectStoreV26>,
	project: Readonly<Record<string, unknown>>,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	return {
		owner, profile: FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, store,
		projectId: String(project.id),
		intents: {
			imageSequenceImport: () => null,
			renderQueueEnqueue: (current: Readonly<Record<string, unknown>>) => queueRequest(current),
			proxyGenerate: () => null,
			proxyAttach: () => null,
			proxyDetach: () => null,
			proxyRelink: () => null,
			...overrides,
		},
		imageSequence: imageSequencePorts(),
		nativeServices: {
			enqueue: async () => ({}), scanOpenFxPlugin: async () => openFxPlugin(),
		},
		proxy: {
			enqueueProxy: () => 'proxy-job', reattestAttachment: () => true,
			cleanupBody: () => undefined,
		},
	};
}

function queueRequest(project: Readonly<Record<string, unknown>>) {
	const schemaVersion = Number(project.schemaVersion);
	const timingViews = new Map<string, Readonly<Record<string, unknown>>>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind !== 'video') continue;
		const sequence = source.imageSequence as Readonly<Record<string, unknown>> | null | undefined;
		timingViews.set(String(source.id), Object.freeze({
			kind: 'cfr', rate: source.frameRate,
			frameCount: Number(source.sourceFrameCount ?? sequence?.frameCount),
		}));
	}
	const authority = {
		sequenceId: 'main-sequence', sampleStart: 0, sampleDuration: 48_000,
		outputRate: { num: 10, den: 1 },
		format: { container: 'mp4' as const, extension: 'mp4' as const, mimeType: 'video/mp4' as const },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		canvas: {
			width: 1_920, height: 1_080, fit: 'contain' as const, pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		quality: 'balanced' as const, includeAudio: false, audioLayout: null,
		timingViews,
		visualFreshnessByModelId: new Map(),
	};
	const plan = schemaVersion === 25
		? createFramescaperProjectUnifiedExactRenderPlanV25(
			FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, project, authority,
		)
		: createFramescaperProjectUnifiedExactRenderPlanV26(PROFILE, project, authority);
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	return {
		taskKind: 'encoded-export' as const,
		planVersion: envelope.planVersion,
		derivedInputStageId: null,
		planFingerprint: envelope.fingerprint,
		planPayload: canonicalizeNativeMediaPlan(plan),
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: 'ab'.repeat(16), relativeDestination: 'candidate.mov',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 64 * 1_024 * 1_024,
			scratchBytes: 1_024 * 1_024, minimumFreeBytes: 0, hardwareBackend: null,
		},
		recoveryClass: 'atomic-restart' as const,
	};
}

function legacyQueueRequest(project: Readonly<Record<string, unknown>>) {
	const plan = nativeQueueKeyedPlanV7();
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	return {
		taskKind: 'encoded-export' as const,
		planVersion: 7 as const,
		derivedInputStageId: 'cd'.repeat(20),
		planFingerprint: envelope.fingerprint,
		planPayload: canonicalizeNativeMediaPlan(plan),
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [
			{ sourceId: 'source-a', sha256: '12'.repeat(32) },
			{ sourceId: 'source-b', sha256: '34'.repeat(32) },
		],
		rootGrantId: 'ab'.repeat(16), relativeDestination: 'candidate.mov',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 64 * 1_024 * 1_024,
			scratchBytes: 1_024, minimumFreeBytes: 0, hardwareBackend: null,
		},
		recoveryClass: 'atomic-restart' as const,
	};
}

function imageSequenceSelection() {
	const files = Array.from({ length: 10 }, (_, index) => {
		const bytes = new Uint8Array(index + 1).fill(index + 1);
		return Object.freeze({
			name: `shot_${String(index + 1).padStart(4, '0')}.png`,
			byteLength: bytes.byteLength,
			chunks: () => Object.freeze([bytes.slice()]),
		});
	});
	return Object.freeze({
		sourceId: 'sequence-source', projectBinClipId: 'sequence-bin', name: 'Sequence',
		frameRate: { num: 10, den: 1 }, files: Object.freeze(files),
	});
}

function imageSequencePorts() {
	return {
		capabilities: () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
		entries: [
			{ domain: 'operation' as const, id: 'image-sequence-import' },
			{ domain: 'queue' as const, id: 'persistent-render-queue' },
			{ domain: 'codec' as const, id: 'encode-mov-prores-proxy' },
			{ domain: 'ofx' as const, id: 'isolated-host' },
		].map((entry) => ({
			...entry, policyCleared: true, buildSupported: true,
			probeSucceeded: true, selfTestPassed: true, userEnabled: true,
		})),
		}),
		clearedPolicyRowIds: () => IMAGE_SEQUENCE_ROWS,
		createSourcePackWriter: () => ({
			write: () => undefined, commit: () => undefined, discard: () => undefined,
		}),
		publishInventory: () => undefined,
		cleanupInventory: () => undefined,
		admit: (request: FramescaperImageSequenceNativeAdmissionRequestV25) => {
			return {
				kind: request.kind, admitted: true,
				projectId: request.projectId, projectRevision: request.projectRevision,
				sourceId: request.sourceId, inventorySha256: request.inventory.sha256,
				sourcePackSha256: request.sourcePack.sha256,
				characteristics: normalizeVideoSourceCharacteristicsV25({
					backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
					hasAlpha: true, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgba',
					chromaFormat: '4:4:4', alphaMode: 'straight',
					alphaInterpretation: 'transparency',
					colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'full' },
				}),
			};
		},
	};
}

function video(project: FramescaperProjectV26) {
	const source = (project.sources as readonly Readonly<Record<string, unknown>>[])
		.find(({ id }) => id === 'video-source') as unknown as {
		readonly proxyAttachment: unknown;
	};
	if (!source) throw new Error('Video source is missing.');
	return source;
}

function attachment(proxySha: string) {
	const timingSha = '44'.repeat(32);
	return {
		kind: 'video-proxy-attachment' as const, version: 1 as const,
		rule: 'exact-original-generation-proxy-content-and-timing-v1' as const,
		storageKey: `video-proxy-sha256:${proxySha}`, mimeType: 'video/quicktime',
		byteLength: 1_000, sha256: proxySha, originalSha256: '12'.repeat(32),
		originalAuthorityKind: 'owned' as const,
		generatorId: 'framescaper-media-host', generatorVersion: 1,
		recipeId: 'framescaper-native-prores-proxy-mov-v1', recipeVersion: 1,
		timingBackendId: 'framescaper-media-host',
		timingRule: 'exact-presentation-boundaries-v1' as const,
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1' as const,
			storageKey: `video-timing-sha256:${timingSha}`, sha256: timingSha,
			sourceSha256: proxySha, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1' as const,
	};
}

function effect() {
	return {
		schemaVersion: 1 as const, instanceId: 'ofx-instance-added', pluginId: 'net.example.Blur',
		binarySha256: SHA_A, context: 'filter' as const,
		attachment: { kind: 'filter' as const, targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }],
		parameters: [{ name: 'radius', type: 'double' as const, value: [2], keyframes: [] }],
		customEncodings: {}, enabled: true,
		freshness: {
			authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
			renderPlanFingerprintSha256: SHA_C, nativeEffectFingerprintSha256: SHA_D,
		},
		frozenFallback: null,
	};
}

function openFxPlugin(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		pluginHandle: 'ef'.repeat(20), pluginId: 'net.example.Blur', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: SHA_A,
		supportedContexts: ['filter'] as const,
		parameters: [{ name: 'radius', type: 'double' as const, animates: true }],
		components: ['RGBA'] as const, pixelDepths: ['byte'] as const,
		threading: 'fully-safe' as const, state: 'enabled' as const, quarantined: false,
		...overrides,
	};
}
