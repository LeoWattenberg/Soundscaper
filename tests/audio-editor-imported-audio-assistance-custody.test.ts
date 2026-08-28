/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceWorkflowCustodyClaimV1,
	assistanceWorkflowCustodySlotSpec,
	workflowClaimFromCustodyV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	createLocalAssistanceGuidedWorkflowPreparation,
	type LocalAssistanceAggregateCustodyPort,
} from '../src/common/editor/controller/local-assistance-guided-preparation.ts';
import {
	createLocalAssistanceSelectedMediaPreparation,
	resolveLocalAssistanceSelectedMediaAuthority,
} from '../src/common/editor/controller/local-assistance-selected-media.ts';
import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

const JOB_ID = '01'.repeat(20);

test('ordinary audio import reaches consent-ready aggregate assistance custody', async () => {
	const fixture = importFixture();
	await fixture.service.importFile(audioFile());
	const source = command(fixture.committed, 'source/add').source as Record<string, unknown>;
	const clip = command(fixture.committed, 'clip/add').clip as Record<string, unknown>;
	const track = command(fixture.committed, 'track/add').track as Record<string, unknown>;
	assert.match(String(source.contentSha256), /^[a-f0-9]{64}$/u);
	assert.equal(source.byteLength, 20);

	const project = {
		...fixture.project,
		sources: [{ ...source, kind: 'audio' }],
		clips: [{ ...clip, kind: 'audio', sequenceId: 'main-sequence', avLinkId: null,
			reversed: false, speedRatio: 1, pitchCents: 0, stretchToTempo: false,
			anchor: 'sample', warpMap: null }],
		tracks: [{ ...track, clipIds: [clip.id] }],
		selection: { startFrame: 0, endFrame: 4 },
	};
	const selectedDependencies = {
		getProject: () => project,
		getSelectedClipId: () => String(clip.id),
		captureProject: () => ({ revision: 4 }),
		assertProject: () => undefined,
		renderDryTrackRange: async () => fixture.channels,
	};
	const selected = createLocalAssistanceSelectedMediaPreparation(selectedDependencies);
	const custody = custodyFixture();
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => project, getSelectedClipId: () => String(clip.id),
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined,
		currentSelectionFence: () => resolveLocalAssistanceSelectedMediaAuthority(
			selectedDependencies,
		).fence,
		selected,
	});
	const result = await preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'enhance-dialogue',
		settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		models: [{ modelId: 'deepfilternet3', version: '3.0.0',
			task: 'speech-enhancement', artifactSha256s: ['1'.padStart(64, '0')] }],
		custody: custody.port, signal: new AbortController().signal,
	});

	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.equal(result.workflow.fence.sourceRanges[0]?.sourceSha256, source.contentSha256);
	assert.equal(result.workflow.inputs[0]?.slotId, 'audio');
	assert.equal(custody.events[0], 'input:audio');
	assert.ok(custody.staged.get('audio')?.byteLength);
});

test('ordinary audio import removes a publication with stale storage digest evidence', async () => {
	const fixture = importFixture({ sha256: '0'.repeat(64), byteLength: 20 });
	await assert.rejects(
		fixture.service.importFile(audioFile()),
		/storage content digest disagrees/iu,
	);
	assert.equal(fixture.committed, null);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
});

function importFixture(storageEvidence: Record<string, unknown> = {}) {
	const channels = [Float32Array.of(0.25, 0, -0.25, 0.5)];
	const deletedSources: string[] = [];
	let committed: Record<string, unknown> | null = null;
	let id = 0;
	const project = {
		id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
		revision: 4, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', sequences: [{ id: 'main-sequence',
			rate: { num: 30, den: 1 } }], subsequences: [], multicameraGroups: [],
		assistanceAssets: [], metadata: {}, sources: [], clips: [], tracks: [],
	};
	const audio = {
		length: 4, numberOfChannels: 1, sampleRate: 48_000,
		getChannelData: () => channels[0]!,
	};
	const runtime: ProjectImportRuntime = {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32 * 1024 * 1024,
		SOURCE_CHUNK_FRAMES: 65_536,
		audioBufferChannels: () => channels,
		bufferFromChannels: async () => audio,
		cacheSourceBuffer: () => undefined,
		canonicalizeBuffer: async () => audio,
		commit: (value: Record<string, unknown>) => { committed = value; },
		copy: { timelineFramesFinite: 'Frames must be finite.', audioTrackNotFound: 'Track missing.',
			track: 'Track' },
		createAddClipCommand: (trackId: string, value: unknown) => ({ type: 'clip/add', trackId, clip: value }),
		createAddSourceCommand: (value: unknown) => ({ type: 'source/add', source: value }),
		createAddTrackCommand: (value: unknown) => ({ type: 'track/add', track: value }),
		createStableId: (prefix: string) => `${prefix}-${++id}`,
		editingBlocked: () => false,
		engine: { getAudioContext: async () => ({}), decodeAudioData: async () => audio },
		ffmpeg: { decode: async () => ({ channels, sampleRate: 48_000 }) },
		findTrack: () => null,
		generateWaveformPeaks: async () => ({ levels: [] }),
		importVideoFile: async () => { throw new Error('Video import is outside this fixture.'); },
		inspectEncodedAudioSampleRate: () => 48_000,
		inspectWavBlobPcm: async () => null,
		isAudioEditorEngineSupported: () => true,
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isLegacyBlockFile: () => false,
		isWavFile: () => false,
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		preflightStorage: async () => undefined,
		getProject: () => project,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => undefined,
		retireSourceChunkProvider: () => undefined,
		setStatus: () => undefined,
		sourceBuffers: new Map(), sourcePcmBytes: () => 0, sourcePeaks: new Map(),
		state: { importing: false },
		store: {
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: async () => storageEvidence,
				abort: async () => undefined,
			}),
			saveAnalysis: async () => undefined,
			deleteSource: async (sourceId: string) => { deletedSources.push(sourceId); },
		},
		streamWavBlobPcm: async () => undefined,
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => undefined,
		writeBuffer: async (writer: { write(value: readonly Float32Array[]): Promise<void> }) => {
			await writer.write(channels);
		},
	};
	return { channels, deletedSources, project, service: createProjectImportService(runtime),
		get committed() { return committed; } };
}

function custodyFixture() {
	const events: string[] = [];
	const staged = new Map<string, Uint8Array>();
	let ordinal = 10;
	const port: LocalAssistanceAggregateCustodyPort = Object.freeze({
		stageInput: async (
			request: Parameters<LocalAssistanceAggregateCustodyPort['stageInput']>[0],
		) => {
			events.push(`input:${request.slotId}`);
			const bytes = new Uint8Array(await request.bytes.arrayBuffer());
			staged.set(request.slotId, bytes);
			const spec = assistanceWorkflowCustodySlotSpec(
				request.workflowId, request.stageId, 'input', request.slotId,
			);
			const claim = createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1,
				workflowId: request.workflowId, direction: 'input', jobId: request.jobId,
				stageId: request.stageId, slotId: request.slotId,
				claimId: (++ordinal).toString(16).padStart(40, '0'), role: spec.role,
				mediaType: request.mediaType, byteLength: bytes.byteLength,
				sha256: bytesToHex(sha256(bytes)), maximumByteLength: null });
			return { custody: claim, workflowClaim: workflowClaimFromCustodyV1(claim) };
		},
		reserveOutput: async (
			request: Parameters<LocalAssistanceAggregateCustodyPort['reserveOutput']>[0],
		) => {
			events.push(`output:${request.slotId}`);
			const claim = createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1,
				workflowId: request.workflowId, direction: 'output', jobId: request.jobId,
				stageId: request.stageId, slotId: request.slotId,
				claimId: (++ordinal).toString(16).padStart(40, '0'), byteLength: null,
				sha256: null, maximumByteLength: request.maximumByteLength });
			return { custody: claim, workflowClaim: workflowClaimFromCustodyV1(claim) };
		},
		bindProducer: async () => { throw new Error('Enhancement has no producer-bound input.'); },
		release: async () => true,
	});
	return { events, port, staged };
}

function audioFile() {
	return { name: 'voice.mp3', type: 'audio/mpeg', size: 8,
		arrayBuffer: async () => new ArrayBuffer(8) };
}

function command(batch: Record<string, unknown> | null, type: string): Record<string, unknown> {
	assert.ok(batch);
	const commands = batch.commands as readonly Record<string, unknown>[];
	const value = commands.find((candidate) => candidate.type === type);
	assert.ok(value);
	return value;
}
