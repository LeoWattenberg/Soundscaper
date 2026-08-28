/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AssistanceProposalStaleError,
	createAssistanceProposalSession,
	type AssistanceSelectionFence,
} from '../src/common/editor/assistance/proposal-session.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function fence(overrides: Partial<AssistanceSelectionFence> = {}): AssistanceSelectionFence {
	return {
		projectId: 'project-a',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		revision: 7,
		sequenceId: 'sequence-a',
		occurrenceIds: ['clip-a'],
		sourceId: 'source-a',
		sourceSha256: SHA_A,
		sourceStartFrame: 100,
		sourceEndFrame: 900,
		linkMembershipSha256: SHA_B,
		timingAuthoritySha256: SHA_C,
		...overrides,
	};
}

test('selection fences require an exact family-qualified v1 identity before other fields', () => {
	assert.throws(() => createAssistanceProposalSession({
		operation: 'speech-recognition',
		fence: { ...fence(), schemaFamily: undefined } as never,
		proposals: [{ id: 'proposal-a', kind: 'label', command: {} }],
		currentFence: fence,
		commit: () => undefined,
		discardStaged: () => undefined,
	}), /family/iu);
	assert.throws(() => createAssistanceProposalSession({
		operation: 'speech-recognition',
		fence: Object.defineProperty({ ...fence() }, 'schemaFamily', {
			enumerable: true,
			get: () => 'soundscaper',
		}) as never,
		proposals: [{ id: 'proposal-a', kind: 'label', command: {} }],
		currentFence: fence,
		commit: () => undefined,
		discardStaged: () => undefined,
	}), /data property/iu);
	const numericOnly = { ...fence() } as Record<string, unknown>;
	delete numericOnly.schemaFamily;
	assert.throws(() => createAssistanceProposalSession({
		operation: 'speech-recognition', fence: numericOnly as never,
		proposals: [{ id: 'proposal-a', kind: 'label', command: {} }],
		currentFence: fence, commit: () => undefined, discardStaged: () => undefined,
	}), (error: unknown) => (error as { code?: string }).code === 'REIMPORT_REQUIRED');
});

test('accept commits selected proposal commands in one exact fenced batch', { timeout: 20_000 }, async () => {
	const commits: unknown[] = [];
	let discarded = 0;
	const expected = fence();
	const session = createAssistanceProposalSession({
		operation: 'speech-recognition',
		fence: expected,
		proposals: [
			{ id: 'proposal-a', kind: 'label', command: { type: 'add-label', text: 'Hello' } },
			{ id: 'proposal-b', kind: 'label', command: { type: 'add-label', text: 'World' } },
		],
		assistanceAssets: [{ id: 'transcript-a', kind: 'transcript-v1' }],
		currentFence: () => expected,
		commit: async (batch) => { commits.push(batch); },
		discardStaged: async () => { discarded += 1; },
	});

	await session.accept(['proposal-b', 'proposal-a']);

	assert.equal(session.snapshot().phase, 'accepted');
	assert.equal(commits.length, 1);
	assert.deepEqual(commits[0], {
		fence: expected,
		commands: [
			{ type: 'add-label', text: 'Hello' },
			{ type: 'add-label', text: 'World' },
		],
		assistanceAssets: [{ id: 'transcript-a', kind: 'transcript-v1' }],
	});
	assert.equal(discarded, 0);
});

test('a stale selection refuses publication and discards staged bodies', { timeout: 20_000 }, async () => {
	let commits = 0;
	let discarded = 0;
	const session = createAssistanceProposalSession({
		operation: 'shot-detection',
		fence: fence(),
		proposals: [{ id: 'cut-a', kind: 'annotation', command: { type: 'add-annotation' } }],
		currentFence: () => fence({ revision: 8 }),
		commit: async () => { commits += 1; },
		discardStaged: async () => { discarded += 1; },
	});

	await assert.rejects(session.accept(['cut-a']), AssistanceProposalStaleError);

	assert.equal(session.snapshot().phase, 'failed');
	assert.equal(commits, 0);
	assert.equal(discarded, 1);
});

test('reject and cancel never mutate canonical state', { timeout: 20_000 }, async () => {
	for (const terminal of ['reject', 'cancel'] as const) {
		let commits = 0;
		let discarded = 0;
		const session = createAssistanceProposalSession({
			operation: 'beat-tracking',
			fence: fence(),
			proposals: [{ id: 'beat-a', kind: 'label', command: { type: 'add-label' } }],
			currentFence: () => fence(),
			commit: async () => { commits += 1; },
			discardStaged: async () => { discarded += 1; },
		});

		await session[terminal]();

		assert.equal(session.snapshot().phase, terminal === 'reject' ? 'rejected' : 'cancelled');
		assert.equal(commits, 0);
		assert.equal(discarded, 1);
		assert.equal(session.signal.aborted, terminal === 'cancel');
	}
});

test('commit failure rolls back staged bodies and makes the session terminal', { timeout: 20_000 }, async () => {
	const failure = new Error('atomic command batch failed');
	let discarded = 0;
	const session = createAssistanceProposalSession({
		operation: 'speech-enhancement',
		fence: fence(),
		proposals: [{ id: 'swap-a', kind: 'derived-source', command: { type: 'swap-source' } }],
		currentFence: () => fence(),
		commit: async () => { throw failure; },
		discardStaged: async () => { discarded += 1; },
	});

	await assert.rejects(session.accept(['swap-a']), failure);
	assert.equal(session.snapshot().phase, 'failed');
	assert.equal(discarded, 1);
	await assert.rejects(session.accept(['swap-a']), /no longer accepts decisions/iu);
});

test('the fence and decision sets are closed and bounded', { timeout: 20_000 }, async () => {
	const create = (overrides: Record<string, unknown> = {}) => createAssistanceProposalSession({
		operation: 'speech-recognition',
		fence: fence(),
		proposals: [{ id: 'proposal-a', kind: 'label', command: { type: 'add-label' } }],
		currentFence: () => fence(),
		commit: async () => undefined,
		discardStaged: async () => undefined,
		...overrides,
	});

	assert.throws(() => create({ fence: fence({ sourceEndFrame: 100 }) }), /source range/iu);
	assert.throws(() => create({ fence: { ...fence(), extra: true } }), /selection fence fields/iu);
	assert.throws(() => create({ proposals: [
		{ id: 'proposal-a', kind: 'label', command: {} },
		{ id: 'proposal-a', kind: 'label', command: {} },
	] }), /unique/iu);

	const session = create();
	await assert.rejects(session.accept(['proposal-missing']), /unknown proposal/iu);
	assert.equal(session.snapshot().phase, 'review');
	await session.reject();
});
