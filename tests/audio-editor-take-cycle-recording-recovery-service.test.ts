/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createTakeCycleRecordingService } from '../src/common/editor/controller/take-cycle-recording-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import {
	createTakeCycleRecoveryEnvelope,
	transitionTakeCycleRecoveryEnvelopeMedia,
	transitionTakeCycleRecoveryEnvelopeProject,
	type TakeCycleProjectPublicationEvidence,
	type TakeCycleRecoveryEnvelope,
} from '../src/common/editor/take-cycle-recovery-envelope.ts';
import type { TakeMediaPublicationBinding } from '../src/common/editor/take-media-recovery-journal.ts';
import { TakeCycleRecoveryEnvelopeRepository } from '../src/common/editor/storage/take-cycle-recovery-envelope-repository.ts';

test('restart before media commit cleans every exact stage receipt and removes its envelope', async () => {
	const fixture = await recoveryFixture({ envelope: stagedEnvelope() });
	const plan = await fixture.service.recover({ currentGeneration: 7, decision: 'recover' });

	assert.equal(plan.disposition, 'cleanup-incomplete');
	assert.deepEqual(fixture.events, [
		'inspect-media:media-a',
		'inspect-media:media-b',
		'inspect-project:project-cycle',
		'cleanup-staged:media-a',
		'cleanup-staged:media-b',
		'envelope:remove:envelope-cycle',
	]);
	assert.equal(await fixture.repository.load('project-cycle'), null);
});

test('restart after media commit promotes a staged envelope and replays or discards one lane', async () => {
	const envelope = stagedEnvelope();
	const exactMedia = envelope.entries.map(({ journal }) => journal.binding);
	const recover = await recoveryFixture({ envelope, media: exactMedia });
	const recoverPlan = await recover.service.recover({ currentGeneration: 7, decision: 'recover' });
	assert.equal(recoverPlan.disposition, 'replay-published');
	assert.deepEqual(recover.events.slice(-2), [
		'replay-project:lane-cycle',
		'envelope:remove:envelope-cycle',
	]);
	assert.deepEqual(recover.project.current, targetEvidence(envelope));

	const discard = await recoveryFixture({ envelope, media: exactMedia });
	const discardPlan = await discard.service.recover({ currentGeneration: 7, decision: 'discard' });
	assert.equal(discardPlan.disposition, 'discard-uncommitted');
	assert.deepEqual(discard.events.slice(-3), [
		'cleanup-published:media-a',
		'cleanup-published:media-b',
		'envelope:remove:envelope-cycle',
	]);
	assert.equal(discard.media.size, 0);
});

test('mixed durable media is deterministically discarded without a partial project replay', async () => {
	const envelope = stagedEnvelope();
	const fixture = await recoveryFixture({
		envelope,
		media: [envelope.entries[0]!.journal.binding],
	});
	const plan = await fixture.service.recover({ currentGeneration: 7, decision: 'recover' });

	assert.equal(plan.disposition, 'cleanup-incomplete');
	assert.equal(fixture.events.includes('replay-project:lane-cycle'), false);
	assert.equal(fixture.events.includes('cleanup-published:media-a'), true);
	assert.equal(fixture.events.includes('cleanup-staged:media-b'), true);
	assert.equal(await fixture.repository.load('project-cycle'), null);
});

test('restart during or after project publication settles without replaying or deleting media', async () => {
	for (const envelope of [stagedEnvelope(), publishedEnvelope(), committedEnvelope()]) {
		const fixture = await recoveryFixture({
			envelope,
			media: envelope.entries.map(({ journal }) => journal.binding),
			projectEvidence: targetEvidence(envelope),
		});
		const plan = await fixture.service.recover({ currentGeneration: 7, decision: 'recover' });
		assert.equal(plan.disposition, 'settle-committed');
		assert.equal(fixture.events.some((event) => event.startsWith('replay-project:')), false);
		assert.equal(fixture.events.some((event) => event.startsWith('cleanup-')), false);
		assert.equal(fixture.media.size, 2);
		assert.equal(await fixture.repository.load('project-cycle'), null);
	}

	const envelope = publishedEnvelope();
	const discard = await recoveryFixture({
		envelope,
		media: envelope.entries.map(({ journal }) => journal.binding),
		projectEvidence: targetEvidence(envelope),
	});
	await assert.rejects(
		discard.service.recover({ currentGeneration: 7, decision: 'discard' }),
		/Cannot discard cycle media referenced by the exact target project/u,
	);
	assert.ok(await discard.repository.load('project-cycle'));
});

test('replay project revision/digest evidence is verified before envelope removal', async () => {
	const envelope = publishedEnvelope();
	const fixture = await recoveryFixture({
		envelope,
		media: envelope.entries.map(({ journal }) => journal.binding),
		replayEvidence: { ...targetEvidence(envelope), sha256: '99'.repeat(32) },
	});
	await assert.rejects(
		fixture.service.recover({ currentGeneration: 7, decision: 'recover' }),
		/project evidence does not match the exact target publication fence/u,
	);
	assert.ok(await fixture.repository.load('project-cycle'));
	assert.equal(fixture.events.some((event) => event.startsWith('envelope:remove:')), false);
});

test('stale durable generations fail before media inspection or mutation', async () => {
	const fixture = await recoveryFixture({ envelope: stagedEnvelope() });
	await assert.rejects(
		fixture.service.recover({ currentGeneration: 8, decision: 'recover' }),
		/Stale take cycle envelope generation 7; current generation is 8/u,
	);
	assert.equal(fixture.events.some(isMutationEvent), false);
	assert.ok(await fixture.repository.load('project-cycle'));

	const clean = await recoveryFixture();
	const plan = await clean.service.recover({ currentGeneration: 7, decision: 'recover' });
	assert.equal(plan.disposition, 'clean');
	assert.deepEqual(clean.events, []);
});

test('cancellation after cleanup leaves an idempotently recoverable envelope', async () => {
	const envelope = publishedEnvelope();
	const pending = deferred<void>();
	const abort = new AbortController();
	const fixture = await recoveryFixture({
		envelope,
		media: envelope.entries.map(({ journal }) => journal.binding),
		cleanupPublished: async () => pending.promise,
	});
	const operation = fixture.service.recover(
		{ currentGeneration: 7, decision: 'discard' },
		{ signal: abort.signal },
	);
	await until(() => fixture.events.includes('cleanup-published:media-a'));
	abort.abort(new DOMException('Recovery cancelled.', 'AbortError'));
	pending.resolve();
	await assert.rejects(operation, /Recovery cancelled/u);
	assert.ok(await fixture.repository.load('project-cycle'));
	assert.equal(fixture.media.has('media-a'), false);
	assert.equal(fixture.events.some((event) => event.startsWith('envelope:remove:')), false);

	const retryPlan = await fixture.service.recover({ currentGeneration: 7, decision: 'discard' });
	assert.equal(retryPlan.disposition, 'discard-uncommitted');
	assert.equal(await fixture.repository.load('project-cycle'), null);
});

test('project-generation loss during inspection performs no cleanup, replay, or removal', async () => {
	const envelope = publishedEnvelope();
	const fixture = await recoveryFixture({
		envelope,
		media: envelope.entries.map(({ journal }) => journal.binding),
		inspectMedia: async (_binding, currentFixture) => {
			currentFixture.projectGeneration.activate('project-b');
		},
	});
	await assert.rejects(
		fixture.service.recover({ currentGeneration: 7, decision: 'recover' }),
		/active editor project changed/u,
	);
	assert.equal(fixture.events.some(isMutationEvent), false);
	assert.ok(await fixture.repository.load('project-cycle'));
});

function isMutationEvent(event: string): boolean {
	return /^(?:cleanup-|replay-|envelope:remove:)/u.test(event);
}

interface RecoveryFixtureOptions {
	readonly envelope?: TakeCycleRecoveryEnvelope;
	readonly media?: readonly TakeMediaPublicationBinding[];
	readonly projectEvidence?: TakeCycleProjectPublicationEvidence;
	readonly replayEvidence?: TakeCycleProjectPublicationEvidence;
	cleanupPublished?(fixture: RecoveryFixture): Promise<void>;
	inspectMedia?(binding: TakeMediaPublicationBinding, fixture: RecoveryFixture): Promise<void>;
}

interface RecoveryFixture {
	readonly service: ReturnType<typeof createTakeCycleRecordingService>;
	readonly projectGeneration: EditorProjectGeneration;
	readonly repository: TakeCycleRecoveryEnvelopeRepository;
	readonly project: { current: TakeCycleProjectPublicationEvidence };
	readonly media: Map<string, TakeMediaPublicationBinding>;
	readonly events: string[];
}

async function recoveryFixture(options: RecoveryFixtureOptions = {}): Promise<RecoveryFixture> {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('project-cycle');
	const events: string[] = [];
	const rawRepository = new TakeCycleRecoveryEnvelopeRepository(keyValuePort(new Map()));
	const repository = Object.assign(Object.create(Object.getPrototypeOf(rawRepository)) as TakeCycleRecoveryEnvelopeRepository, {
		load: rawRepository.load.bind(rawRepository),
		create: rawRepository.create.bind(rawRepository),
		replace: rawRepository.replace.bind(rawRepository),
		async remove(envelope: TakeCycleRecoveryEnvelope) {
			events.push(`envelope:remove:${envelope.envelopeId}`);
			return rawRepository.remove(envelope);
		},
	});
	if (options.envelope) await repository.create(options.envelope);
	const initial = options.envelope ?? stagedEnvelope();
	const project = { current: options.projectEvidence ?? baseEvidence(initial) };
	const media = new Map((options.media ?? []).map((binding) => [binding.mediaId, binding]));
	const fixtureRef: { current: RecoveryFixture | null } = { current: null };
	const service = createTakeCycleRecordingService({
		lifetime,
		recoveryRepository: repository,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		prepareProjectPublication: async () => { throw new Error('not used by recovery'); },
		createMediaStageReceipt: async () => { throw new Error('not used by recovery'); },
		stageMedia: async () => { throw new Error('not used by recovery'); },
		publishMedia: async () => { throw new Error('not used by recovery'); },
		publishProject: async () => { throw new Error('not used by recovery'); },
		async inspectMedia({ binding }) {
			events.push(`inspect-media:${binding.mediaId}`);
			await options.inspectMedia?.(binding, fixtureRef.current!);
			return media.get(binding.mediaId) ?? null;
		},
		async inspectProject({ envelope }) {
			events.push(`inspect-project:${envelope.projectFence.projectId}`);
			return project.current;
		},
		async cleanupStagedMedia({ action }) {
			events.push(`cleanup-staged:${action.binding.mediaId}`);
			return true;
		},
		async cleanupPublishedMedia({ action }) {
			events.push(`cleanup-published:${action.binding.mediaId}`);
			media.delete(action.binding.mediaId);
			await options.cleanupPublished?.(fixtureRef.current!);
			return true;
		},
		async replayProjectCommit({ action }) {
			events.push(`replay-project:${action.envelope.captureRequest.laneId}`);
			const evidence = options.replayEvidence ?? targetEvidence(action.envelope);
			if (!options.replayEvidence) project.current = evidence;
			return evidence;
		},
	});
	const fixture: RecoveryFixture = { service, projectGeneration, repository, project, media, events };
	fixtureRef.current = fixture;
	return fixture;
}

function stagedEnvelope(): TakeCycleRecoveryEnvelope {
	const targetProjectDocument = serializeScapeProjectDocument({
		id: 'project-cycle', revision: 11, takeIds: ['take-a', 'take-b'],
	});
	return createTakeCycleRecoveryEnvelope({
		envelopeId: 'envelope-cycle', generation: 7,
		captureRequest: {
			groupId: 'group-cycle', laneId: 'lane-cycle',
			laneIds: ['lane-cycle', 'lane-cycle-b'],
			loopStartSample: 0, loopEndSample: 100,
			captureSpans: [{ startSample: 0, endSample: 200 }],
			takeIds: ['take-a', 'take-b'], interrupted: false,
		},
		publications: ['a', 'b'].map((id) => ({
			journalId: `journal-${id}`,
			laneId: id === 'a' ? 'lane-cycle' : 'lane-cycle-b',
			mediaId: `media-${id}`,
			byteLength: 100,
			sha256: `${id === 'a' ? 'ab' : 'cd'}`.repeat(32),
			stageReceipt: {
				version: 1,
				sourceId: `media-${id}`,
				sourceToken: `media-${id}:pending:write-receipt-${id}`,
			},
		})),
		projectFence: {
			projectId: 'project-cycle',
			baseRevision: 10,
			baseSha256: '12'.repeat(32),
			targetRevision: 11,
			targetSha256: digest(targetProjectDocument),
		},
		targetProjectDocument,
	});
}

function publishedEnvelope(): TakeCycleRecoveryEnvelope {
	let envelope = stagedEnvelope();
	for (let entryIndex = 0; entryIndex < envelope.entries.length; entryIndex += 1) {
		envelope = transitionTakeCycleRecoveryEnvelopeMedia(envelope, {
			entryIndex, currentGeneration: 7,
			evidence: envelope.entries[entryIndex]!.journal.binding,
		});
	}
	return envelope;
}

function committedEnvelope(): TakeCycleRecoveryEnvelope {
	const envelope = publishedEnvelope();
	return transitionTakeCycleRecoveryEnvelopeProject(envelope, {
		currentGeneration: 7, evidence: targetEvidence(envelope),
	});
}

function baseEvidence(envelope: TakeCycleRecoveryEnvelope): TakeCycleProjectPublicationEvidence {
	return {
		projectId: envelope.projectFence.projectId,
		revision: envelope.projectFence.baseRevision,
		sha256: envelope.projectFence.baseSha256,
	};
}

function targetEvidence(envelope: TakeCycleRecoveryEnvelope): TakeCycleProjectPublicationEvidence {
	return {
		projectId: envelope.projectFence.projectId,
		revision: envelope.projectFence.targetRevision,
		sha256: envelope.projectFence.targetSha256,
	};
}

function digest(document: string): string {
	return digestScapeBytes(new TextEncoder().encode(document));
}

function keyValuePort(values: Map<string, unknown>) {
	return {
		get: (key: string) => structuredClone(values.get(key)),
		putIfAbsent(key: string, value: unknown) {
			if (values.has(key)) return false;
			values.set(key, structuredClone(value));
			return true;
		},
		replaceIfCurrent(key: string, expected: unknown, replacement: unknown) {
			if (JSON.stringify(values.get(key)) !== JSON.stringify(expected)) return false;
			values.set(key, structuredClone(replacement));
			return true;
		},
		deleteIfCurrent(key: string, expected: unknown) {
			if (JSON.stringify(values.get(key)) !== JSON.stringify(expected)) return false;
			values.delete(key);
			return true;
		},
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((settle) => { resolve = settle; });
	return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await Promise.resolve();
	assert.equal(predicate(), true, 'expected asynchronous checkpoint was not reached');
}
