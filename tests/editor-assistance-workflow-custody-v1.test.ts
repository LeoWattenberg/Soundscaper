/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceWorkflowCustodyClaimV1,
	validateAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';

const JOB_ID = '01'.repeat(20);
const CLAIM_ID = '02'.repeat(20);
const SHA256 = '03'.repeat(32);

test('external, reserved, and producer custody bind exact slotted data authority', () => {
	const external = createAssistanceWorkflowCustodyClaimV1({
		custodyVersion: 1, workflowId: 'transcribe-captions', direction: 'input',
		jobId: JOB_ID, stageId: 'detect-speech', slotId: 'audio', claimId: CLAIM_ID,
		role: 'audio', mediaType: 'audio/wav', byteLength: 4_096, sha256: SHA256,
		maximumByteLength: null, producer: null,
	});
	assert.deepEqual(workflowClaimFromCustodyV1(external), {
		claimVersion: 1, direction: 'input', claimId: CLAIM_ID, jobId: JOB_ID,
		stageId: 'detect-speech', slotId: 'audio',
	});

	const output = createAssistanceWorkflowCustodyClaimV1({
		custodyVersion: 1, workflowId: 'transcribe-captions', direction: 'output',
		jobId: JOB_ID, stageId: 'recognize-speech', slotId: 'transcript', claimId: CLAIM_ID,
		role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
		byteLength: null, sha256: null, maximumByteLength: 65_536, producer: null,
	});
	const intermediate = createAssistanceWorkflowCustodyClaimV1({
		custodyVersion: 1, workflowId: 'transcribe-captions', direction: 'input',
		jobId: JOB_ID, stageId: 'assemble-captions', slotId: 'transcript', claimId: CLAIM_ID,
		role: output.role, mediaType: output.mediaType, byteLength: null, sha256: null,
		maximumByteLength: output.maximumByteLength,
		producer: { stageId: output.stageId, slotId: output.slotId, claimId: output.claimId },
	});
	assert.equal(intermediate.claimId, output.claimId);
	assert.equal(Object.isFrozen(intermediate.producer), true);

	const videoAuthority = createAssistanceWorkflowCustodyClaimV1({
		custodyVersion: 1, workflowId: 'index-video', direction: 'input',
		jobId: JOB_ID, stageId: 'sample-shot-frames', slotId: 'video-authority',
		claimId: '9'.repeat(40), role: 'video-authority',
		mediaType: 'application/vnd.soundscaper.video-authority+json',
		byteLength: 4_096, sha256: SHA256, maximumByteLength: null, producer: null,
	});
	assert.equal(videoAuthority.role, 'video-authority');
	assert.equal(videoAuthority.mediaType,
		'application/vnd.soundscaper.video-authority+json');
});

test('custody refuses invented identities, paths, incompatible media, and unsafe producers', () => {
	const base = {
		custodyVersion: 1, workflowId: 'transcribe-captions', direction: 'input',
		jobId: JOB_ID, stageId: 'detect-speech', slotId: 'audio', claimId: CLAIM_ID,
		role: 'audio', mediaType: 'audio/wav', byteLength: 4_096, sha256: SHA256,
		maximumByteLength: null, producer: null,
	};
	assert.throws(() => validateAssistanceWorkflowCustodyClaimV1({ ...base,
		path: '/tmp/audio.wav',
	}), /schema|field/iu);
	assert.throws(() => validateAssistanceWorkflowCustodyClaimV1({ ...base,
		mediaType: 'text/plain',
	}), /media|audio/iu);
	assert.throws(() => validateAssistanceWorkflowCustodyClaimV1({ ...base,
		byteLength: null, sha256: null, maximumByteLength: 4_096,
		producer: { stageId: 'recognize-speech', slotId: 'transcript', claimId: CLAIM_ID },
	}), /producer|earlier|slot/iu);
	assert.throws(() => validateAssistanceWorkflowCustodyClaimV1({ ...base,
		claimId: 'renderer-minted-id',
	}), /claim/iu);
});

test('every deterministic workflow output has one closed custody media contract', async () => {
	const { assistanceWorkflowStageGraph, ASSISTANCE_GUIDED_WORKFLOW_IDS } = await import(
		'../src/common/editor/assistance/workflow.ts'
	);
	let ordinal = 4;
	for (const workflowId of ASSISTANCE_GUIDED_WORKFLOW_IDS) {
		for (const stage of assistanceWorkflowStageGraph(workflowId)) {
			for (const slot of stage.outputSlots) {
				ordinal += 1;
				const claim = createAssistanceWorkflowCustodyClaimV1({
					custodyVersion: 1, workflowId, direction: 'output', jobId: JOB_ID,
					stageId: stage.stageId, slotId: slot.slotId,
					claimId: ordinal.toString(16).padStart(40, '0'),
					byteLength: null, sha256: null, maximumByteLength: 65_536,
				});
				assert.ok(claim.role);
				assert.ok(claim.mediaType);
			}
		}
	}
});
