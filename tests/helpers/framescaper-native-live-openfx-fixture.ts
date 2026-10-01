/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createNativeMediaPlanEnvelopeV2 } from '../../src/common/editor/native-media-plan-envelope-v2.ts';
import { framescaperOpenFxPluginProjectionV1 } from '../../src/common/editor/native-ofx-service-contract.ts';
import { createNativeQueueRecordV3 } from '../../src/common/editor/native-queue-record-v3.ts';
import { nativeRgbaFramePackV1ByteLength } from '../../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { createUnifiedExactRenderPlan } from '../../src/common/editor/unified-exact-render-plan.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../../src/framescaper/editor-project-native-media.ts';
import type {
	FramescaperNativeRenderDeliveryRequestNativeMedia,
} from '../../src/framescaper/editor-native-project-action-requests.ts';
import { framescaperV20Options } from './framescaper-model-fixture.ts';

export const STAGE_ID = 'ab'.repeat(20);
export const OWNER = Object.freeze({ renderer: 28 });
const OPENFX_SHA = 'a1'.repeat(32);
const OPENFX_HANDLE = '12'.repeat(20);
export const SOURCE_BYTES = Uint8Array.of(1, 2, 3, 4);
const SOURCE_SHA = createHash('sha256').update(SOURCE_BYTES).digest('hex');

export function liveFixture(
	withOpenFx = false,
	delivery?: FramescaperNativeRenderDeliveryRequestNativeMedia,
) {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).filter(({ kind }) => kind === 'video')
		.map((source) => ({
			...source, contentSha256: SOURCE_SHA, width: 2, height: 2, sourceFrameCount: 1, frameRate: { num: 1, den: 1 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
		}));
	options.clips = (options.clips as Array<Record<string, unknown>>).filter(({ kind }) => kind === 'video')
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 }));
	options.projectBin = { clips: ((options.projectBin as { clips: Array<Record<string, unknown>> }).clips)
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })) };
	options.tracks = (options.tracks as Array<Record<string, unknown>>).filter(({ type }) => type === 'video');
	options.sequences = [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }];
	if (withOpenFx) options.ofxEffects = [openFxEffect()];
	const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	const created = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project, delivery), delivery,
	);
	let plan = created;
	if (withOpenFx) {
		const raw = structuredClone(created) as unknown as Record<string, unknown>;
		const output = raw.output as Record<string, unknown>;
		output.canvas = { ...(output.canvas as Record<string, unknown>), width: 2, height: 2 };
		const validated = createUnifiedExactRenderPlan(raw);
		if (validated.version !== 14) throw new Error('OpenFX fixture plan is not V14.');
		plan = validated as typeof created;
	}
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	const carrierByteLength = nativeRgbaFramePackV1ByteLength({
		width: envelope.summary.width, height: envelope.summary.height,
		frameCount: envelope.summary.outputFrameCount,
	});
	return { project, plan, envelope, carrierByteLength };
}

export function openFxEffect() {
	return {
		schemaVersion: 1, instanceId: 'ofx-instance', pluginId: 'net.example.Filter',
		binarySha256: OPENFX_SHA, context: 'filter',
		attachment: { kind: 'filter', targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }], parameters: [],
		customEncodings: {}, enabled: true,
		freshness: {
			authoredStateSha256: OPENFX_SHA, inputIdentitiesSha256: 'b2'.repeat(32),
			renderPlanFingerprintSha256: 'c3'.repeat(32), nativeEffectFingerprintSha256: 'd4'.repeat(32),
		}, frozenFallback: null,
	};
}

export function openFxPlugin() {
	return framescaperOpenFxPluginProjectionV1({
		pluginHandle: OPENFX_HANDLE, pluginId: 'net.example.Filter', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: OPENFX_SHA,
		supportedContexts: ['filter'], parameters: [], components: ['RGBA'], pixelDepths: ['byte'],
		threading: 'instance-safe', state: 'enabled', quarantined: false,
	});
}

export function byteDescriptor(bytes: Uint8Array) {
	return Object.freeze({
		byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

export function beginRequest(fixture: ReturnType<typeof liveFixture>) {
	return Object.freeze({
		liveRenderVersion: 1 as const, schemaFamily: 'framescaper' as const,
		schemaVersion: 1 as const, planVersion: 14 as const,
		planFingerprint: fixture.envelope.fingerprint,
		planPayload: JSON.stringify(fixture.plan), projectId: fixture.project.id,
		projectRevision: fixture.project.revision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: SOURCE_SHA }],
		restartJobId: null,
		carrierByteLength: fixture.carrierByteLength, audio: null,
	});
}

export function claimRequest(fixture: ReturnType<typeof liveFixture>) {
	const begin = beginRequest(fixture);
	return Object.freeze({
		schemaFamily: begin.schemaFamily, schemaVersion: begin.schemaVersion,
		derivedInputStageId: STAGE_ID, planVersion: 14 as const,
		planFingerprint: begin.planFingerprint, planPayload: begin.planPayload,
		projectId: begin.projectId, projectRevision: begin.projectRevision,
		inputFingerprints: begin.inputFingerprints,
	});
}

export function queueRecord(
	fixture: ReturnType<typeof liveFixture>,
	taskKind: 'encoded-export' | 'image-sequence-export' | 'proxy-generation' = 'encoded-export',
) {
	return createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: STAGE_ID, taskKind, plan: fixture.plan,
		projectId: String(fixture.project.id), projectRevision: Number(fixture.project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: SOURCE_SHA }],
		rootGrantId: 'cd'.repeat(16), relativeDestination: taskKind === 'image-sequence-export'
			? 'renders/live-png' : 'renders/live.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 32 * 1024 ** 3, minimumFreeBytes: 0, hardwareBackend: null },
		...(taskKind === 'image-sequence-export'
			? { recoveryClass: 'verified-frame-checkpoint' as const } : {}),
		position: 0, createdAtMs: 1,
	});
}
