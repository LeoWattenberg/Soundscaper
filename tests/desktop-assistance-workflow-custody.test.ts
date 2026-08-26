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
			inputs: [detectAudio, recognizeAudio, assembledTranscript].map(({ workflowClaim }) => workflowClaim),
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
		const restaged = await custody.operationInputClaim(
			assembledTranscript.workflowClaim, new AbortController().signal,
		);
		assert.equal(restaged.role, 'transcript');
		assert.equal(restaged.sha256, authenticated.sha256);

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
		await assert.rejects(async () => custody.openOutput(
			transcript.custody, new AbortController().signal,
		),
			/job|released|unknown/iu);
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
