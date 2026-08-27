/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createLocalAssistanceGuidedWorkflowPreparation,
	type LocalAssistanceAggregateCustodyPort,
} from '../../src/common/editor/controller/local-assistance-guided-preparation.ts';
import {
	assistanceWorkflowCustodySlotSpec,
	createAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
} from '../../src/common/editor/assistance/workflow-custody-v1.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

export const JOB_ID = '01'.repeat(20);
export const SOURCE_SHA256 = 'ab'.repeat(32);
export const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;

type StageInputRequest = Parameters<LocalAssistanceAggregateCustodyPort['stageInput']>[0];
type ReserveOutputRequest = Parameters<LocalAssistanceAggregateCustodyPort['reserveOutput']>[0];
type BindProducerRequest = Parameters<LocalAssistanceAggregateCustodyPort['bindProducer']>[0];

export interface FixtureProject {
	readonly id: string;
	readonly schemaVersion: number;
	readonly revision: number;
	readonly clips: readonly Readonly<Record<string, unknown> & { id: string }>[];
	readonly sources: readonly Readonly<Record<string, unknown> & { id: string }>[];
	readonly [key: string]: unknown;
}

export function preparationFixture(
	projectValue: FixtureProject = project(),
	stale = false,
	transcript?: Readonly<{ storageKey: string; bytes: Uint8Array }>,
) {
	const operations: string[] = [];
	const preflights: number[] = [];
	const stagedBodies = new Map<string, Uint8Array>();
	const custodyEvents: Array<{ kind: 'input' | 'output' | 'producer'; slotId: string }> = [];
	let releases = 0;
	let claimOrdinal = 10;
	const custody: LocalAssistanceAggregateCustodyPort = Object.freeze({
		stageInput: async (request: StageInputRequest) => {
			custodyEvents.push({ kind: 'input', slotId: request.slotId });
			const bytes = new Uint8Array(await request.bytes.arrayBuffer());
			stagedBodies.set(request.slotId, bytes);
			const spec = assistanceWorkflowCustodySlotSpec(
				request.workflowId, request.stageId, 'input', request.slotId,
			);
			const claim = createAssistanceWorkflowCustodyClaimV1({
				custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: (++claimOrdinal).toString(16).padStart(40, '0'),
				role: spec.role, mediaType: request.mediaType,
				byteLength: bytes.byteLength, sha256: bytesToHex(sha256(bytes)), maximumByteLength: null,
			});
			return Object.freeze({ custody: claim, workflowClaim: workflowClaimFromCustodyV1(claim) });
		},
		reserveOutput: async (request: ReserveOutputRequest) => {
			custodyEvents.push({ kind: 'output', slotId: request.slotId });
			const claim = createAssistanceWorkflowCustodyClaimV1({
				custodyVersion: 1, workflowId: request.workflowId, direction: 'output',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: (++claimOrdinal).toString(16).padStart(40, '0'), byteLength: null,
				sha256: null, maximumByteLength: request.maximumByteLength,
			});
			return Object.freeze({ custody: claim, workflowClaim: workflowClaimFromCustodyV1(claim) });
		},
		bindProducer: async (request: BindProducerRequest) => {
			custodyEvents.push({ kind: 'producer', slotId: request.slotId });
			const claim = createAssistanceWorkflowCustodyClaimV1({
				custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: request.producer.claimId, role: request.producer.role,
				mediaType: request.producer.mediaType, byteLength: null, sha256: null,
				maximumByteLength: request.producer.maximumByteLength,
				producer: { stageId: request.producer.stageId, slotId: request.producer.slotId,
					claimId: request.producer.claimId },
			});
			return Object.freeze({ custody: claim, workflowClaim: workflowClaimFromCustodyV1(claim) });
		},
		release: async () => { releases += 1; return true; },
	});
	const preparedFence = {
		projectId: 'project-1', schemaVersion: 30, revision: 4, sequenceId: 'main-sequence',
		occurrenceIds: projectValue.clips.map(({ id }) => id), sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 24_000, sourceEndFrame: 72_000,
		linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
	};
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => projectValue, getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ revision: 4 }),
		assertProject: () => {
			if (stale) throw new DOMException('stale', 'AbortError');
		},
		preflightStorage: async (bytes) => { preflights.push(bytes); },
		currentSelectionFence: () => preparedFence,
		...(transcript ? { loadTranscriptBody: async (storageKey: string) => {
			if (storageKey !== transcript.storageKey) return null;
			return Uint8Array.from(transcript.bytes);
		} } : {}),
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'voice-source',
				label: 'Voice', mediaKind: 'audio', operations: [] }] }),
			prepareSelectedMedia: async ({ operation }) => {
				operations.push(operation);
				const sampleRate = operation === 'source-separation' ? 44_100 : 48_000;
				const wav = encodeWav([
					Float32Array.of(0.25, 0, -0.25), Float32Array.of(-0.25, 0, 0.25),
				], { sampleRate, bitDepth: 32, float: true, dither: false });
				return { sourceId: 'voice-source', operation, selectionFence: preparedFence,
					inputs: [{ role: 'audio', mediaType: 'audio/wav',
						bytes: new Blob([wav.slice().buffer], { type: 'audio/wav' }) }],
					outputs: operation === 'source-separation'
						? ['dialogue', 'music', 'effects'].map((slotId) => ({ slotId,
							role: 'separated-audio', mediaType: 'audio/wav',
							maximumByteLength: MAXIMUM_OUTPUT_BYTES }))
						: [{ slotId: 'enhanced-audio', role: 'enhanced-audio', mediaType: 'audio/wav',
							maximumByteLength: MAXIMUM_OUTPUT_BYTES }],
				};
			},
		},
	});
	return { preparation, custody, custodyEvents, operations, preflights, stagedBodies,
		get releases() { return releases; } };
}

export function project(): FixtureProject {
	return {
		id: 'project-1', schemaVersion: 30, revision: 4, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', subsequences: [], multicameraGroups: [],
		assistanceAssets: [],
		sources: [{ id: 'voice-source', kind: 'audio', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'voice-clip', kind: 'audio', sourceId: 'voice-source', sequenceId: 'main-sequence',
			avLinkId: null, reversed: false, speedRatio: 1, pitchCents: 0,
			stretchToTempo: false, warpMap: null }],
		tracks: [{ id: 'voice-track', type: 'audio', clipIds: ['voice-clip'] }],
	};
}

export function transcriptAssetFixture() {
	const transcriptBytes = new TextEncoder().encode(JSON.stringify({
		schemaVersion: 1, sourceId: 'voice-source', sampleRate: 48_000, language: 'en',
		modelId: 'parakeet-tdt-0.6b-v2', segments: [{ startFrame: 24_000, endFrame: 48_000,
			text: 'Selected words for editorial generation', words: [], speaker: null }],
	}));
	const transcriptSha256 = bytesToHex(sha256(transcriptBytes));
	const storageKey = `assistance-transcript-sha256:${transcriptSha256}`;
	const transcriptProject: FixtureProject = { ...project(), assistanceAssets: [{
		id: 'transcript-1', kind: 'transcript-v1', sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 96_000,
		sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: ['90'.repeat(32)], body: { storageKey,
			mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
			byteLength: transcriptBytes.byteLength, sha256: transcriptSha256 },
	}] };
	return { transcriptBytes, transcriptSha256, storageKey, transcriptProject };
}

export function model(modelId: string, version: string, task: string, ordinal: number) {
	return Object.freeze({ modelId, version, task,
		artifactSha256s: Object.freeze([ordinal.toString(16).padStart(64, '0')]) });
}
