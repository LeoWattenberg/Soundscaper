/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	createTakeCycleRecoveryEnvelope,
	normalizeTakeCycleRecoveryEnvelope,
	planTakeCycleEnvelopeRecovery,
	transitionTakeCycleRecoveryEnvelopeMedia,
	transitionTakeCycleRecoveryEnvelopeProject,
	type TakeCycleRecoveryEnvelope,
} from '../src/common/editor/take-cycle-recovery-envelope.ts';

const BASE_DIGEST = '12'.repeat(32);
const MEDIA_A_DIGEST = 'ab'.repeat(32);
const MEDIA_B_DIGEST = 'cd'.repeat(32);

test('a durable lane envelope owns the exact cycle plan, stages, and target project publication', () => {
	const envelope = stagedEnvelope();
	assert.equal(Object.isFrozen(envelope), true);
	assert.equal(Object.isFrozen(envelope.entries), true);
	assert.equal(envelope.state, 'staged');
	assert.deepEqual(envelope.captureRequest.captureSpans, [
		{ startSample: 100, endSample: 160 },
		{ startSample: 160, endSample: 330 },
	]);
	assert.deepEqual(envelope.entries.map(({ journal, stageReceipt }) => ({
		takeId: journal.binding.takeId,
		mediaId: journal.binding.mediaId,
		sourceToken: stageReceipt.sourceToken,
	})), [
		{ takeId: 'take-a', mediaId: 'media-a', sourceToken: 'media-a:pending:write-receipt-a' },
		{ takeId: 'take-b', mediaId: 'media-b', sourceToken: 'media-b:pending:write-receipt-b' },
		{ takeId: 'take-c', mediaId: 'media-c', sourceToken: 'media-c:pending:write-receipt-c' },
	]);
	assert.equal(envelope.projectFence.targetRevision, 11);
	assert.equal(envelope.projectFence.targetSha256, digest(envelope.targetProjectDocument));
});

test('media and project transitions are exact, ordered, immutable, and idempotent', () => {
	const staged = stagedEnvelope();
	const first = transitionTakeCycleRecoveryEnvelopeMedia(staged, {
		entryIndex: 0,
		currentGeneration: 7,
		evidence: staged.entries[0]!.journal.binding,
	});
	assert.equal(staged.entries[0]!.journal.state, 'staged');
	assert.equal(first.state, 'staged');
	assert.deepEqual(first.entries.map(({ journal }) => journal.state), ['published', 'staged', 'staged']);

	let published = first;
	for (let entryIndex = 1; entryIndex < first.entries.length; entryIndex += 1) {
		published = transitionTakeCycleRecoveryEnvelopeMedia(published, {
			entryIndex,
			currentGeneration: 7,
			evidence: published.entries[entryIndex]!.journal.binding,
		});
	}
	assert.equal(published.state, 'published');
	const committed = transitionTakeCycleRecoveryEnvelopeProject(published, {
		currentGeneration: 7,
		evidence: targetEvidence(published),
	});
	assert.equal(committed.state, 'committed');
	assert.deepEqual(committed.entries.map(({ journal }) => journal.state), [
		'committed', 'committed', 'committed',
	]);
	assert.deepEqual(transitionTakeCycleRecoveryEnvelopeProject(committed, {
		currentGeneration: 7,
		evidence: targetEvidence(committed),
	}), committed);
	assert.throws(
		() => transitionTakeCycleRecoveryEnvelopeProject(first, {
			currentGeneration: 7, evidence: targetEvidence(first),
		}),
		/Cannot commit a cycle project before every lane media item is published/u,
	);
});

test('normalization rejects corrupted plans, receipts, target documents, and state claims', () => {
	const envelope = stagedEnvelope();
	assert.throws(
		() => normalizeTakeCycleRecoveryEnvelope({
			...envelope,
			captureRequest: { ...envelope.captureRequest, takeIds: ['take-a'] },
		}),
		/requires exactly 3 caller-supplied take IDs/u,
	);
	assert.throws(
		() => normalizeTakeCycleRecoveryEnvelope({
			...envelope,
			entries: envelope.entries.map((entry, index) => index === 0
				? { ...entry, stageReceipt: {
					...entry.stageReceipt,
					sourceId: 'other-media',
					sourceToken: 'other-media:pending:write-receipt-a',
				} }
				: entry),
		}),
		/stage receipt sourceId must equal its exact mediaId/u,
	);
	assert.throws(
		() => normalizeTakeCycleRecoveryEnvelope({
			...envelope,
			targetProjectDocument: envelope.targetProjectDocument.replace('take-c', 'take-x'),
		}),
		/target project digest does not match its publication fence/u,
	);
	assert.throws(
		() => normalizeTakeCycleRecoveryEnvelope({ ...envelope, state: 'published' }),
		/envelope state does not match its journal states/u,
	);
});

test('recovery promotes exact staged media and replays one complete lane project publication', () => {
	const envelope = stagedEnvelope();
	const plan = planTakeCycleEnvelopeRecovery(envelope, {
		currentGeneration: 7,
		decision: 'recover',
		mediaEvidence: envelope.entries.map(({ journal }) => journal.binding),
		projectEvidence: baseEvidence(envelope),
	});
	assert.equal(plan.disposition, 'replay-published');
	assert.deepEqual(plan.actions.map(({ kind }) => kind), [
		'replay-project-commit', 'remove-recovery-envelope',
	]);
	const replay = plan.actions[0];
	assert.equal(replay?.kind, 'replay-project-commit');
	if (replay?.kind === 'replay-project-commit') {
		assert.equal(replay.envelope.state, 'published');
		assert.deepEqual(replay.envelope.entries.map(({ journal }) => journal.state), [
			'published', 'published', 'published',
		]);
	}
});

test('incomplete or discarded lanes clean only exact stage and media ownership before removal', () => {
	const envelope = stagedEnvelope();
	const mediaEvidence = [envelope.entries[0]!.journal.binding, null, null];
	for (const decision of ['recover', 'discard'] as const) {
		const plan = planTakeCycleEnvelopeRecovery(envelope, {
			currentGeneration: 7, decision, mediaEvidence,
			projectEvidence: baseEvidence(envelope),
		});
		assert.equal(plan.disposition, decision === 'recover'
			? 'cleanup-incomplete'
			: 'discard-uncommitted');
		assert.deepEqual(plan.actions.map(({ kind }) => kind), [
			'cleanup-published-media',
			'cleanup-staged-media',
			'cleanup-staged-media',
			'remove-recovery-envelope',
		]);
	}
});

test('an exact target project settles, while stale generations and divergent evidence fail closed', () => {
	const envelope = stagedEnvelope();
	const exactMedia = envelope.entries.map(({ journal }) => journal.binding);
	const settled = planTakeCycleEnvelopeRecovery(envelope, {
		currentGeneration: 7, decision: 'recover', mediaEvidence: exactMedia,
		projectEvidence: targetEvidence(envelope),
	});
	assert.equal(settled.disposition, 'settle-committed');
	assert.deepEqual(settled.actions.map(({ kind }) => kind), ['remove-recovery-envelope']);
	assert.throws(
		() => planTakeCycleEnvelopeRecovery(envelope, {
			currentGeneration: 7, decision: 'discard', mediaEvidence: exactMedia,
			projectEvidence: targetEvidence(envelope),
		}),
		/Cannot discard cycle media referenced by the exact target project/u,
	);
	assert.throws(
		() => planTakeCycleEnvelopeRecovery(envelope, {
			currentGeneration: 8, decision: 'recover', mediaEvidence: exactMedia,
			projectEvidence: targetEvidence(envelope),
		}),
		/Stale take cycle envelope generation 7; current generation is 8/u,
	);
	assert.throws(
		() => planTakeCycleEnvelopeRecovery(envelope, {
			currentGeneration: 7, decision: 'recover', mediaEvidence: exactMedia,
			projectEvidence: { ...baseEvidence(envelope), sha256: '34'.repeat(32) },
		}),
		/does not match the exact base or target publication fence/u,
	);
});

function stagedEnvelope(): TakeCycleRecoveryEnvelope {
	const targetProjectDocument = serializeScapeProjectDocument({
		id: 'project-cycle',
		revision: 11,
		takeIds: ['take-a', 'take-b', 'take-c'],
	});
	return createTakeCycleRecoveryEnvelope({
		envelopeId: 'envelope-lane-cycle',
		generation: 7,
		captureRequest: {
			groupId: 'group-cycle', laneId: 'lane-cycle',
			loopStartSample: 100, loopEndSample: 200,
			captureSpans: [
				{ startSample: 100, endSample: 160 },
				{ startSample: 160, endSample: 330 },
			],
			takeIds: ['take-a', 'take-b', 'take-c'],
			interrupted: true,
		},
		publications: [
			publication('a', 100, MEDIA_A_DIGEST),
			publication('b', 100, MEDIA_B_DIGEST),
			publication('c', 30, MEDIA_A_DIGEST),
		],
		projectFence: {
			projectId: 'project-cycle',
			baseRevision: 10,
			baseSha256: BASE_DIGEST,
			targetRevision: 11,
			targetSha256: digest(targetProjectDocument),
		},
		targetProjectDocument,
	});
}

function publication(id: string, byteLength: number, sha256: string) {
	return {
		journalId: `journal-${id}`,
		mediaId: `media-${id}`,
		byteLength,
		sha256,
		stageReceipt: {
			version: 1 as const,
			sourceId: `media-${id}`,
			sourceToken: `media-${id}:pending:write-receipt-${id}`,
		},
	};
}

function baseEvidence(envelope: TakeCycleRecoveryEnvelope) {
	return {
		projectId: envelope.projectFence.projectId,
		revision: envelope.projectFence.baseRevision,
		sha256: envelope.projectFence.baseSha256,
	};
}

function targetEvidence(envelope: TakeCycleRecoveryEnvelope) {
	return {
		projectId: envelope.projectFence.projectId,
		revision: envelope.projectFence.targetRevision,
		sha256: envelope.projectFence.targetSha256,
	};
}

function digest(document: string): string {
	return digestScapeBytes(new TextEncoder().encode(document));
}
