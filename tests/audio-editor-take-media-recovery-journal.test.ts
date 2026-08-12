/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeMediaPublicationJournal,
	normalizeTakeMediaPublicationJournal,
	planTakeMediaRecovery,
	transitionTakeMediaPublicationJournal,
	type TakeMediaPublicationBinding,
	type TakeMediaPublicationJournal,
} from '../src/common/editor/take-media-recovery-journal.ts';

const SHA256 = 'ab'.repeat(32);

function binding(overrides: Partial<TakeMediaPublicationBinding> = {}): TakeMediaPublicationBinding {
	return {
		generation: 7,
		groupId: 'group-7',
		laneId: 'lane-7',
		takeId: 'take-7',
		mediaId: 'media-7',
		byteLength: 48_000,
		sha256: SHA256,
		...overrides,
	};
}

function staged(): TakeMediaPublicationJournal {
	return createTakeMediaPublicationJournal({ journalId: 'journal-7', binding: binding() });
}

function published(): TakeMediaPublicationJournal {
	return transitionTakeMediaPublicationJournal(staged(), {
		event: 'media-published', currentGeneration: 7, evidence: binding(),
	});
}

function committed(): TakeMediaPublicationJournal {
	return transitionTakeMediaPublicationJournal(published(), {
		event: 'project-committed', currentGeneration: 7, evidence: binding(),
	});
}

test('publication journals capture one immutable generation, identity, size, and digest contract', () => {
	const journal = staged();
	assert.deepEqual(journal, {
		journalId: 'journal-7',
		state: 'staged',
		binding: binding(),
	});
	assert.equal(Object.isFrozen(journal), true);
	assert.equal(Object.isFrozen(journal.binding), true);
	assert.deepEqual(normalizeTakeMediaPublicationJournal(journal), journal);

	assert.throws(
		() => createTakeMediaPublicationJournal({
			journalId: 'journal-7', binding: binding({ sha256: SHA256.toUpperCase() }),
		}),
		/canonical lowercase SHA-256/u,
	);
	assert.throws(
		() => createTakeMediaPublicationJournal({
			journalId: 'journal-7', binding: binding({ byteLength: 0 }),
		}),
		/byteLength must be a positive safe integer/u,
	);
	assert.throws(
		() => createTakeMediaPublicationJournal({
			journalId: 'take-7', binding: binding(),
		}),
		/journal and media identities must be globally distinct/u,
	);
	assert.throws(
		() => normalizeTakeMediaPublicationJournal({ ...journal, state: 'unknown' }),
		/state must be staged, published, or committed/u,
	);
});

test('publication transitions are ordered, evidence-bound, and replay-idempotent', () => {
	const initial = staged();
	const mediaPublished = transitionTakeMediaPublicationJournal(initial, {
		event: 'media-published', currentGeneration: 7, evidence: binding(),
	});
	assert.equal(mediaPublished.state, 'published');
	assert.deepEqual(transitionTakeMediaPublicationJournal(mediaPublished, {
		event: 'media-published', currentGeneration: 7, evidence: binding(),
	}), mediaPublished);

	const projectCommitted = transitionTakeMediaPublicationJournal(mediaPublished, {
		event: 'project-committed', currentGeneration: 7, evidence: binding(),
	});
	assert.equal(projectCommitted.state, 'committed');
	assert.deepEqual(transitionTakeMediaPublicationJournal(projectCommitted, {
		event: 'project-committed', currentGeneration: 7, evidence: binding(),
	}), projectCommitted);
	assert.deepEqual(transitionTakeMediaPublicationJournal(projectCommitted, {
		event: 'media-published', currentGeneration: 7, evidence: binding(),
	}), projectCommitted);
	assert.throws(
		() => transitionTakeMediaPublicationJournal(initial, {
			event: 'project-committed', currentGeneration: 7, evidence: binding(),
		}),
		/cannot commit before media publication/u,
	);
	assert.equal(Object.isFrozen(mediaPublished), true);
	assert.equal(Object.isFrozen(projectCommitted), true);
});

test('transitions reject stale generations and every mismatched evidence field', () => {
	assert.throws(
		() => transitionTakeMediaPublicationJournal(staged(), {
			event: 'media-published', currentGeneration: 8, evidence: binding(),
		}),
		/Stale take media journal generation 7; current generation is 8/u,
	);
	for (const [overrides, message] of [
		[{ generation: 8 }, /evidence generation does not match/u],
		[{ groupId: 'other-group' }, /evidence identity does not match/u],
		[{ laneId: 'other-lane' }, /evidence identity does not match/u],
		[{ takeId: 'other-take' }, /evidence identity does not match/u],
		[{ mediaId: 'other-media' }, /evidence identity does not match/u],
		[{ byteLength: 48_001 }, /evidence byteLength does not match/u],
		[{ sha256: 'cd'.repeat(32) }, /evidence digest does not match/u],
	] as const) {
		assert.throws(
			() => transitionTakeMediaPublicationJournal(staged(), {
				event: 'media-published', currentGeneration: 7,
				evidence: binding(overrides),
			}),
			message,
		);
	}
});

test('staged recovery cleans only the owned stage and then removes its journal', () => {
	const plan = planTakeMediaRecovery([staged()], {
		currentGeneration: 7,
		decision: 'recover',
		mediaEvidence: null,
		projectEvidence: null,
	});
	assert.deepEqual(plan, {
		kind: 'take-media-recovery', disposition: 'cleanup-staged',
		journalId: 'journal-7', generation: 7,
		actions: [
			{ kind: 'cleanup-staged-media', journalId: 'journal-7', binding: binding() },
			{ kind: 'remove-recovery-journal', journalId: 'journal-7', generation: 7 },
		],
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.actions), true);
	assert.equal(Object.isFrozen(plan.actions[0]), true);
});

test('published recovery explicitly replays the project commit or discards owned media', () => {
	const recover = planTakeMediaRecovery([published()], {
		currentGeneration: 7,
		decision: 'recover',
		mediaEvidence: binding(),
		projectEvidence: null,
	});
	assert.deepEqual(recover, {
		kind: 'take-media-recovery', disposition: 'replay-published',
		journalId: 'journal-7', generation: 7,
		actions: [
			{ kind: 'replay-project-commit', journalId: 'journal-7', binding: binding() },
			{ kind: 'remove-recovery-journal', journalId: 'journal-7', generation: 7 },
		],
	});

	const discard = planTakeMediaRecovery([published()], {
		currentGeneration: 7,
		decision: 'discard',
		mediaEvidence: binding(),
		projectEvidence: null,
	});
	assert.deepEqual(discard.actions, [
		{ kind: 'cleanup-published-media', journalId: 'journal-7', binding: binding() },
		{ kind: 'remove-recovery-journal', journalId: 'journal-7', generation: 7 },
	]);
	assert.equal(discard.disposition, 'discard-published');
});

test('committed evidence settles either a lagging published journal or a committed journal', () => {
	for (const journal of [published(), committed()]) {
		const plan = planTakeMediaRecovery([journal], {
			currentGeneration: 7,
			decision: 'recover',
			mediaEvidence: binding(),
			projectEvidence: binding(),
		});
		assert.deepEqual(plan, {
			kind: 'take-media-recovery', disposition: 'settle-committed',
			journalId: 'journal-7', generation: 7,
			actions: [
				{ kind: 'remove-recovery-journal', journalId: 'journal-7', generation: 7 },
			],
		});
	}
});

test('recovery rejects stale, mismatched, unowned, and ambiguous observations', () => {
	assert.throws(
		() => planTakeMediaRecovery([published()], {
			currentGeneration: 8, decision: 'recover',
			mediaEvidence: binding(), projectEvidence: null,
		}),
		/Stale take media journal generation/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([published()], {
			currentGeneration: 7, decision: 'recover',
			mediaEvidence: binding({ sha256: 'cd'.repeat(32) }), projectEvidence: null,
		}),
		/evidence digest does not match/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([staged()], {
			currentGeneration: 7, decision: 'recover',
			mediaEvidence: binding(), projectEvidence: null,
		}),
		/Ambiguous staged recovery/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([published()], {
			currentGeneration: 7, decision: 'recover',
			mediaEvidence: null, projectEvidence: null,
		}),
		/Ambiguous published recovery/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([committed()], {
			currentGeneration: 7, decision: 'recover',
			mediaEvidence: binding(), projectEvidence: null,
		}),
		/Ambiguous committed recovery/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([published(), committed()], {
			currentGeneration: 7, decision: 'recover',
			mediaEvidence: binding(), projectEvidence: binding(),
		}),
		/Ambiguous take media recovery: 2 active journals/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([], {
			currentGeneration: 7, decision: 'recover',
			mediaEvidence: binding(), projectEvidence: null,
		}),
		/Ambiguous take media recovery evidence has no owning journal/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([committed()], {
			currentGeneration: 7, decision: 'discard',
			mediaEvidence: binding(), projectEvidence: binding(),
		}),
		/Cannot discard take media referenced by committed project evidence/u,
	);
	assert.throws(
		() => planTakeMediaRecovery([published()], {
			currentGeneration: 7, decision: 'discard',
			mediaEvidence: binding(), projectEvidence: binding(),
		}),
		/Cannot discard take media referenced by committed project evidence/u,
	);
});

test('a clean inventory yields an immutable no-op recovery plan', () => {
	assert.deepEqual(planTakeMediaRecovery([], {
		currentGeneration: 7,
		decision: 'recover',
		mediaEvidence: null,
		projectEvidence: null,
	}), {
		kind: 'take-media-recovery', disposition: 'clean',
		journalId: null, generation: 7, actions: [],
	});
});
