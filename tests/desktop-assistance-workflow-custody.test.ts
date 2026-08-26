/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { AssistanceWorkflowCustody } from '../desktop/assistance-workflow-custody.ts';
import { assistanceWorkflowStageGraph } from '../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

test('workflow jobs own one pathless namespace with authenticated external and producer custody', async () => {
	await withTempDirectory('workflow-custody-', async (directory) => {
		let ordinal = 0;
		const mintId = () => (++ordinal).toString(16).padStart(40, '0');
		const staging = new AssistanceStagingRegistry({ root: join(directory, 'private'), mintId });
		const custody = new AssistanceWorkflowCustody({ staging });
		const { jobId } = await custody.createJob();
		const audio = new TextEncoder().encode('authenticated audio');
		const detectAudio = await custody.stageInput({
			jobId, workflowId: 'transcribe-captions', stageId: 'detect-speech', slotId: 'audio',
			mediaType: 'audio/wav', byteLength: audio.byteLength, bytes: chunks(audio),
		});
		const recognizeAudio = await custody.stageInput({
			jobId, workflowId: 'transcribe-captions', stageId: 'recognize-speech', slotId: 'audio',
			mediaType: 'audio/wav', byteLength: audio.byteLength, bytes: chunks(audio),
		});
		const voiceActivity = await custody.reserveOutput({
			jobId, workflowId: 'transcribe-captions', stageId: 'detect-speech',
			slotId: 'voice-activity', maximumByteLength: 65_536,
		});
		const recognizeVoiceActivity = custody.bindProducer({
			jobId, workflowId: 'transcribe-captions', stageId: 'recognize-speech',
			slotId: 'voice-activity', producerStageId: 'detect-speech',
			producerSlotId: 'voice-activity', producerClaimId: voiceActivity.custody.claimId,
		});
		const transcript = await custody.reserveOutput({
			jobId, workflowId: 'transcribe-captions', stageId: 'recognize-speech',
			slotId: 'transcript', maximumByteLength: 65_536,
		});
		const assembledTranscript = custody.bindProducer({
			jobId, workflowId: 'transcribe-captions', stageId: 'assemble-captions',
			slotId: 'transcript', producerStageId: 'recognize-speech',
			producerSlotId: 'transcript', producerClaimId: transcript.custody.claimId,
		});
		const captions = await custody.reserveOutput({
			jobId, workflowId: 'transcribe-captions', stageId: 'assemble-captions',
			slotId: 'captions', maximumByteLength: 65_536,
		});
		assert.equal(assembledTranscript.custody.claimId, transcript.custody.claimId);
		assert.equal(assembledTranscript.custody.producer?.claimId, transcript.custody.claimId);

		const request = assistanceWorkflowFixture({ jobId,
			inputs: [detectAudio, recognizeAudio, recognizeVoiceActivity, assembledTranscript]
				.map(({ workflowClaim }) => workflowClaim),
			outputs: [voiceActivity, transcript, captions].map(({ workflowClaim }) => workflowClaim),
		});
		assert.deepEqual(custody.validateWorkflow(request), request);
		const stage = assistanceWorkflowStageGraph(request.workflowId)[0]!;
		const resolution = custody.resolveStage({ request, stage, stageIndex: 0, stageCount: 3,
			inputs: [request.inputs[0]!], outputs: [request.outputs[0]!],
			models: [request.models[0]!], signal: new AbortController().signal });
		assert.equal(resolution.outcome, 'resolved');
		assert.deepEqual(resolution.custody.inputClaimIds, [detectAudio.custody.claimId]);

		const staged = await custody.resolveInput(detectAudio.custody, new AbortController().signal);
		assert.equal(staged.claim.sha256, detectAudio.custody.sha256);
		assert.equal(staged.path.includes(jobId), true);
		await assert.rejects(
			custody.resolveInput(assembledTranscript.custody, new AbortController().signal),
			/producer.*authenticated|output/iu,
		);
		const outputPath = await custody.openOutput(transcript.custody, new AbortController().signal);
		const transcriptBytes = new TextEncoder().encode('{"segments":[]}');
		await writeFile(outputPath, transcriptBytes, { flag: 'r+' });
		const authenticated = await custody.authenticateOutput(transcript.custody, new AbortController().signal);
		const produced = await custody.resolveInput(assembledTranscript.custody, new AbortController().signal);
		assert.equal(produced.claim.sha256, authenticated.sha256);
		assert.equal(produced.path, outputPath);
		const vadBody = new TextEncoder().encode('{"sampleRate":16000,"segments":[]}');
		const vadPath = await custody.openOutput(voiceActivity.custody);
		await writeFile(vadPath, vadBody, { flag: 'r+' });
		await custody.authenticateOutput(voiceActivity.custody);
		const projectedVad = await custody.operationInputClaim(
			recognizeVoiceActivity.workflowClaim, 'speech-recognition',
		);
		assert.equal(projectedVad.role, 'voice-activity');
		assert.equal(projectedVad.mediaType, 'application/json');
		const captionsReservation = custody.outputReservationForClaim(captions.workflowClaim);
		assert.equal(captionsReservation.claimId, captions.custody.claimId);
		const captionsPath = await staging.resolveOutputReservationPathForMain(
			jobId, captionsReservation,
		);
		await writeFile(captionsPath, new TextEncoder().encode('{"cues":[]}'), { flag: 'r+' });
		const captionsClaim = await staging.authenticateOutput(jobId, captionsReservation);
		assert.deepEqual(await custody.recordAuthenticatedOutputForClaim(
			captions.workflowClaim, captionsClaim,
		),
			captionsClaim);
		const review = await custody.openAuthenticatedOutput(
			captions.workflowClaim, new AbortController().signal,
		);
		assert.deepEqual(review.workflowClaim, captions.workflowClaim);
		assert.deepEqual(review.claim, captionsClaim);
		assert.equal(review.path, captionsPath);
		await writeFile(captionsPath, new Uint8Array(captionsClaim.byteLength).fill(120), { flag: 'r+' });
		await assert.rejects(custody.openAuthenticatedOutput(captions.workflowClaim),
			/digest|identity|changed|authenticate/iu);
		await assert.rejects(custody.recordAuthenticatedOutput(captions.custody, captionsClaim),
			/already authenticated/iu);
		assert.equal(await custody.releaseJob(jobId), true);
		assert.equal(await custody.releaseJob(jobId), false);
	});
});

test('workflow custody rejects renderer-minted, cross-job, stale, and unreserved producer claims', async () => {
	await withTempDirectory('workflow-custody-refusal-', async (directory) => {
		let ordinal = 0;
		const staging = new AssistanceStagingRegistry({ root: join(directory, 'private'),
			mintId: () => (++ordinal).toString(16).padStart(40, '0') });
		const custody = new AssistanceWorkflowCustody({ staging });
		const { jobId } = await custody.createJob();
		assert.throws(() => custody.bindProducer({
			jobId, workflowId: 'transcribe-captions', stageId: 'assemble-captions',
			slotId: 'transcript', producerStageId: 'recognize-speech', producerSlotId: 'transcript',
			producerClaimId: 'f'.repeat(40),
		}), /producer|reserved/iu);
		await assert.rejects(custody.reserveOutput({
			jobId: 'f'.repeat(40), workflowId: 'transcribe-captions',
			stageId: 'recognize-speech', slotId: 'transcript', maximumByteLength: 65_536,
		}), /job|unknown/iu);
		const transcript = await custody.reserveOutput({
			jobId, workflowId: 'transcribe-captions', stageId: 'recognize-speech',
			slotId: 'transcript', maximumByteLength: 65_536,
		});
		assert.throws(() => custody.validateWorkflow(assistanceWorkflowFixture({ jobId,
			outputs: assistanceWorkflowFixture().outputs.map((claim) => claim.slotId === 'transcript'
				? { ...claim, jobId, claimId: 'e'.repeat(40) } : { ...claim, jobId }),
			inputs: assistanceWorkflowFixture().inputs.map((claim) => ({ ...claim, jobId })),
		})), /custody|claim|staged/iu);
		await custody.releaseJob(jobId);
		await assert.rejects(custody.openAuthenticatedOutput(transcript.workflowClaim),
			/job|released|unknown/iu);
		await assert.rejects(async () => custody.openOutput(
			transcript.custody, new AbortController().signal,
		),
			/job|released|unknown/iu);
	});
});

test('primitive projection maps only closed consumer roles and refuses before staging', async () => {
	await withTempDirectory('workflow-custody-projection-', async (directory) => {
		let ordinal = 0;
		const staging = new AssistanceStagingRegistry({ root: join(directory, 'private'),
			mintId: () => (++ordinal).toString(16).padStart(40, '0') });
		const custody = new AssistanceWorkflowCustody({ staging });
		const { jobId } = await custody.createJob();
		const transcript = new TextEncoder().encode('{"segments":[]}');
		await custody.stageInput({ jobId, workflowId: 'index-transcript',
			stageId: 'chunk-transcript', slotId: 'transcript', mediaType: 'application/json',
			byteLength: transcript.byteLength, bytes: chunks(transcript) });
		const textChunks = await custody.reserveOutput({ jobId, workflowId: 'index-transcript',
			stageId: 'chunk-transcript', slotId: 'text-chunks', maximumByteLength: 4096 });
		const embeddedInput = custody.bindProducer({ jobId, workflowId: 'index-transcript',
			stageId: 'embed-transcript', slotId: 'text-chunks',
			producerStageId: 'chunk-transcript', producerSlotId: 'text-chunks',
			producerClaimId: textChunks.custody.claimId });
		const path = await custody.openOutput(textChunks.custody);
		const body = new TextEncoder().encode('[{"text":"hello"}]');
		await writeFile(path, body, { flag: 'r+' });
		const authenticated = await custody.authenticateOutput(textChunks.custody);
		const beforeRefusal = ordinal;
		await assert.rejects(custody.operationInputClaim(
			embeddedInput.workflowClaim, 'editorial-generation',
		), /consumer operation|not admitted/iu);
		assert.equal(ordinal, beforeRefusal, 'refusal must happen before a new staging claim is minted');
		const projected = await custody.operationInputClaim(
			embeddedInput.workflowClaim, 'text-embedding',
		);
		assert.equal(projected.role, 'transcript');
		assert.equal(projected.mediaType, 'application/json');
		assert.equal(projected.sha256, authenticated.sha256);
		await custody.releaseJob(jobId);
	});
});

async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
	yield bytes.slice();
}

async function withTempDirectory(
	prefix: string,
	operation: (directory: string) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	try { await operation(directory); }
	finally { await rm(directory, { recursive: true, force: true }); }
}
