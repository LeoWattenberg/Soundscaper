/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import {
	createTakeCycleRecordingService,
	type TakeCycleFinalizationRequest,
	type TakeCyclePassOperation,
	type TakeCycleProjectPublicationOperation,
} from '../src/common/editor/controller/take-cycle-recording-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type {
	TakeCycleProjectPublicationEvidence,
	TakeCycleRecoveryEnvelope,
} from '../src/common/editor/take-cycle-recovery-envelope.ts';
import type { TakeMediaPublicationBinding } from '../src/common/editor/take-media-recovery-journal.ts';
import { TakeCycleRecoveryEnvelopeRepository } from '../src/common/editor/storage/take-cycle-recovery-envelope-repository.ts';

const SHA_A = 'ab'.repeat(32);
const SHA_B = 'cd'.repeat(32);

function request(): TakeCycleFinalizationRequest {
	return {
		publicationGeneration: 7,
		lanes: [
			{
				envelopeId: 'envelope-lane-a',
				groupId: 'group-cycle', laneId: 'lane-a',
				loopStartSample: 100, loopEndSample: 200,
				captureSpans: [
					{ startSample: 100, endSample: 150 },
					{ startSample: 150, endSample: 260 },
					{ startSample: 260, endSample: 330 },
				],
				interrupted: true,
				publications: [
					publication('a-1', 100, SHA_A),
					publication('a-2', 100, SHA_A),
					publication('a-3', 30, SHA_A),
				],
			},
			{
				envelopeId: 'envelope-lane-b',
				groupId: 'group-cycle', laneId: 'lane-b',
				loopStartSample: 100, loopEndSample: 200,
				captureSpans: [{ startSample: 100, endSample: 300 }],
				interrupted: false,
				publications: [
					publication('b-1', 100, SHA_B),
					publication('b-2', 100, SHA_B),
				],
			},
		],
	};
}

function publication(id: string, byteLength: number, sha256: string) {
	const [lane, pass] = id.split('-');
	return {
		journalId: `journal-${id}`,
		laneId: pass === '1' ? `lane-${lane}` : `lane-${id}`,
		takeId: `take-${id}`,
		mediaId: `media-${id}`,
		byteLength,
		sha256,
	};
}

test('multi-input finalization persists one exact envelope and one project publication per lane', async () => {
	const fixture = serviceFixture();
	const result = await fixture.service.finalize(request());

	assert.deepEqual(result.lanes.map(({ laneId, status, committedPasses }) => ({
		laneId, status, committedPasses: committedPasses.map(({ takeId }) => takeId),
	})), [
		{ laneId: 'lane-a', status: 'committed', committedPasses: ['take-a-1', 'take-a-2', 'take-a-3'] },
		{ laneId: 'lane-b', status: 'committed', committedPasses: ['take-b-1', 'take-b-2'] },
	]);
	assert.equal(Object.isFrozen(result), true);
	assert.deepEqual(fixture.staged[0]?.plan.passes[2], {
		passIndex: 2, laneId: 'lane-a-3', takeId: 'take-a-3',
		captureStartSample: 300, captureEndSample: 330,
		timelineStartSample: 100, timelineEndSample: 130,
		complete: false, interrupted: true,
		fragments: [{
			spanIndex: 2, captureStartSample: 300, captureEndSample: 330,
			timelineStartSample: 100, timelineEndSample: 130,
		}],
	});
	assert.equal(fixture.events.filter((event) => event.startsWith('envelope:create:')).length, 2);
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('project:publish:')), [
		'project:publish:lane-a:3',
		'project:publish:lane-b:2',
	]);
	assert.equal(fixture.project.current.revision, 12);
	assert.equal(await fixture.repository.load('project-a'), null);
	assert.deepEqual([...fixture.media.keys()], [
		'media-a-1', 'media-a-2', 'media-a-3', 'media-b-1', 'media-b-2',
	]);
});

test('a failed routed lane is exactly cleaned before the next lane begins', async () => {
	const failure = new Error('lane-a staging failed');
	const fixture = serviceFixture({
		stageMedia: async (operation) => {
			if (operation.plan.laneId === 'lane-a') throw failure;
		},
	});
	const result = await fixture.service.finalize(request());

	assert.equal(result.lanes[0]?.status, 'failed');
	assert.equal(result.lanes[0]?.error, failure);
	assert.equal(result.lanes[1]?.status, 'committed');
	assert.equal(fixture.media.has('media-a-1'), false);
	assert.equal(fixture.stages.size, 0);
	assert.equal(await fixture.repository.load('project-a'), null);
	const removeA = fixture.events.indexOf('envelope:remove:envelope-lane-a');
	const prepareB = fixture.events.indexOf('project:prepare:lane-b');
	assert.ok(removeA >= 0 && prepareB > removeA, 'failed lane ownership settles before the next lane');
});

test('project preparation is released after receipt failure and terminal publication', async () => {
	const fixture = serviceFixture({ receiptFailsForLane: 'lane-a' });
	const result = await fixture.service.finalize(request());

	assert.equal(result.lanes[0]?.status, 'failed');
	assert.equal(result.lanes[1]?.status, 'committed');
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('project:release:')), [
		'project:release:11',
		'project:release:11',
	]);
});

test('a later media failure cleans the committed prefix and staged suffix without publishing a project', async () => {
	const failure = new Error('second media commit failed');
	const fixture = serviceFixture({
		publishMedia: async (operation) => {
			if (operation.pass.takeId === 'take-a-2') throw failure;
		},
	});
	const result = await fixture.service.finalize(request());

	assert.equal(result.lanes[0]?.status, 'failed');
	assert.equal(result.lanes[0]?.error, failure);
	assert.equal(fixture.media.has('media-a-1'), false);
	assert.equal(fixture.events.includes('cleanup-published:media-a-1'), true);
	assert.equal(fixture.events.includes('cleanup-staged:media-a-2'), true);
	assert.equal(fixture.events.includes('project:publish:lane-a:3'), false);
	assert.equal(result.lanes[1]?.status, 'committed');
});

test('a throw after exact project publication reconciles as committed without replay', async () => {
	const crash = new Error('response lost after project publication');
	const fixture = serviceFixture({
		publishProject: async (operation, currentFixture) => {
			currentFixture.project.current = targetEvidence(operation.envelope);
			throw crash;
		},
	});
	const result = await fixture.service.finalize(request());

	assert.equal(result.lanes[0]?.status, 'committed');
	assert.deepEqual(result.lanes[0]?.committedPasses.map(({ takeId }) => takeId), [
		'take-a-1', 'take-a-2', 'take-a-3',
	]);
	assert.equal(fixture.events.some((event) => event.startsWith('replay-project:')), false);
	assert.equal(result.lanes[1]?.status, 'committed');
});

test('all capture plans and global identities validate before project, receipt, or storage work', async () => {
	const fixture = serviceFixture();
	const invalid = request();
	const lanes = [...invalid.lanes];
	lanes[1] = { ...lanes[1]!, publications: [publication('b-1', 100, SHA_B)] };
	await assert.rejects(
		fixture.service.finalize({ ...invalid, lanes }),
		/requires exactly 2 caller-supplied take IDs/u,
	);
	assert.deepEqual(fixture.events, []);

	const collision = request();
	const collisionLanes = [...collision.lanes];
	collisionLanes[1] = {
		...collisionLanes[1]!,
		publications: [
			{ ...publication('b-1', 100, SHA_B), mediaId: 'take-a-1' },
			publication('b-2', 100, SHA_B),
		],
	};
	await assert.rejects(
		fixture.service.finalize({ ...collision, lanes: collisionLanes }),
		/identity take-a-1 is reused across take and media ownership/u,
	);
	assert.deepEqual(fixture.events, []);

	const malformed = request();
	const malformedLanes = [...malformed.lanes];
	malformedLanes[0] = {
		...malformedLanes[0]!,
		publications: [
			{ ...malformedLanes[0]!.publications[0]!, sha256: 'NOT-A-DIGEST' },
			...malformedLanes[0]!.publications.slice(1),
		],
	};
	await assert.rejects(
		fixture.service.finalize({ ...malformed, lanes: malformedLanes }),
		/canonical lowercase SHA-256 digest/u,
	);
	assert.deepEqual(fixture.events, []);
});

test('finalization snapshots mutable publication descriptors before its first await', async () => {
	const fixture = serviceFixture();
	const input = request();
	const first = input.lanes[0]!.publications[0] as {
		mediaId: string;
		byteLength: number;
		sha256: string;
	};
	const operation = fixture.service.finalize(input);
	first.mediaId = 'media-tampered';
	first.byteLength = 1;
	first.sha256 = '00'.repeat(32);
	const result = await operation;

	assert.equal(result.lanes[0]?.status, 'committed');
	assert.equal(fixture.media.has('media-a-1'), true);
	assert.equal(fixture.media.has('media-tampered'), false);
});

test('cancellation and project switching retain one exact envelope for restart recovery', async () => {
	const pending = deferred<void>();
	const abort = new AbortController();
	const cancelled = serviceFixture({ stageMedia: async () => pending.promise });
	const operation = cancelled.service.finalize(request(), { signal: abort.signal });
	await until(() => cancelled.events.includes('stage:take-a-1'));
	abort.abort(new DOMException('Cycle finalization cancelled.', 'AbortError'));
	pending.resolve();
	await assert.rejects(operation, /Cycle finalization cancelled/u);
	assert.equal((await cancelled.repository.load('project-a'))?.envelopeId, 'envelope-lane-a');
	assert.equal(cancelled.events.some((event) => event.startsWith('cleanup-')), false);
	assert.equal(cancelled.events.includes('project:prepare:lane-b'), false);

	const switched = serviceFixture({
		stageMedia: async (_operation, currentFixture) => {
			currentFixture.projectGeneration.activate('project-b');
		},
	});
	await assert.rejects(switched.service.finalize(request()), /active editor project changed/u);
	assert.equal((await switched.repository.load('project-a'))?.envelopeId, 'envelope-lane-a');
});

test('cleanup ownership refusal is terminal and never starts another lane', async () => {
	const fixture = serviceFixture({
		stageMedia: async () => { throw new Error('stage failed'); },
		cleanupStaged: async () => false,
	});
	await assert.rejects(
		fixture.service.finalize(request()),
		/failed and exact recovery did not settle/u,
	);
	assert.equal(fixture.events.includes('project:prepare:lane-b'), false);
	assert.equal((await fixture.repository.load('project-a'))?.envelopeId, 'envelope-lane-a');
});

interface FixtureOverrides {
	receiptFailsForLane?: string;
	stageMedia?(operation: TakeCyclePassOperation, fixture: Fixture): Promise<void>;
	publishMedia?(operation: TakeCyclePassOperation, fixture: Fixture): Promise<void>;
	publishProject?(
		operation: TakeCycleProjectPublicationOperation,
		fixture: Fixture,
	): Promise<TakeCycleProjectPublicationEvidence>;
	cleanupStaged?(fixture: Fixture): Promise<boolean>;
}

interface Fixture {
	readonly service: ReturnType<typeof createTakeCycleRecordingService>;
	readonly projectGeneration: EditorProjectGeneration;
	readonly repository: TakeCycleRecoveryEnvelopeRepository;
	readonly project: { current: TakeCycleProjectPublicationEvidence };
	readonly media: Map<string, TakeMediaPublicationBinding>;
	readonly stages: Set<string>;
	readonly staged: TakeCyclePassOperation[];
	readonly events: string[];
}

function serviceFixture(overrides: FixtureOverrides = {}): Fixture {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('project-a');
	const values = new Map<string, unknown>();
	const rawRepository = new TakeCycleRecoveryEnvelopeRepository(keyValuePort(values));
	const project = { current: {
		projectId: 'project-a', revision: 10, sha256: '01'.repeat(32),
	} };
	const media = new Map<string, TakeMediaPublicationBinding>();
	const stages = new Set<string>();
	const staged: TakeCyclePassOperation[] = [];
	const events: string[] = [];
	const fixtureRef: { current: Fixture | null } = { current: null };
	const repository = Object.assign(Object.create(Object.getPrototypeOf(rawRepository)) as TakeCycleRecoveryEnvelopeRepository, {
		load: rawRepository.load.bind(rawRepository),
		async create(envelope: TakeCycleRecoveryEnvelope) {
			events.push(`envelope:create:${envelope.envelopeId}`);
			return rawRepository.create(envelope);
		},
		async replace(expected: TakeCycleRecoveryEnvelope, next: TakeCycleRecoveryEnvelope) {
			events.push(`envelope:replace:${expected.state}->${next.state}`);
			return rawRepository.replace(expected, next);
		},
		async remove(envelope: TakeCycleRecoveryEnvelope) {
			events.push(`envelope:remove:${envelope.envelopeId}`);
			return rawRepository.remove(envelope);
		},
	});
	const service = createTakeCycleRecordingService({
		lifetime,
		recoveryRepository: repository,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		prepareProjectPublication(operation) {
			events.push(`project:prepare:${operation.plan.laneId}`);
			const targetProjectDocument = serializeScapeProjectDocument({
				id: 'project-a',
				revision: project.current.revision + 1,
				priorSha256: project.current.sha256,
				laneId: operation.plan.laneId,
				takeIds: operation.plan.passes.map(({ takeId }) => takeId),
			});
			return {
				projectFence: {
					projectId: 'project-a',
					baseRevision: project.current.revision,
					baseSha256: project.current.sha256,
					targetRevision: project.current.revision + 1,
					targetSha256: digest(targetProjectDocument),
				},
				targetProjectDocument,
			};
		},
		createMediaStageReceipt(operation) {
			events.push(`receipt:${operation.pass.takeId}`);
			if (operation.plan.laneId === overrides.receiptFailsForLane) {
				throw new Error('stage receipt failed');
			}
			return Object.freeze({
				version: 1 as const,
				sourceId: operation.publication.mediaId,
				sourceToken: `${operation.publication.mediaId}:pending:write-owned`,
			});
		},
		async stageMedia(operation) {
			operation.ownership.assertCurrent();
			staged.push(operation);
			stages.add(operation.envelope.entries[operation.entryIndex]!.stageReceipt.sourceToken);
			events.push(`stage:${operation.pass.takeId}`);
			await overrides.stageMedia?.(operation, fixtureRef.current!);
		},
		async publishMedia(operation) {
			operation.ownership.assertCurrent();
			events.push(`media:publish:${operation.pass.takeId}`);
			await overrides.publishMedia?.(operation, fixtureRef.current!);
			const entry = operation.envelope.entries[operation.entryIndex]!;
			stages.delete(entry.stageReceipt.sourceToken);
			media.set(entry.journal.binding.mediaId, entry.journal.binding);
			return entry.journal.binding;
		},
		async publishProject(operation) {
			events.push(`project:publish:${operation.plan.laneId}:${String(operation.envelope.entries.length)}`);
			if (overrides.publishProject) return overrides.publishProject(operation, fixtureRef.current!);
			project.current = targetEvidence(operation.envelope);
			return project.current;
		},
		inspectMedia: async ({ binding }) => media.get(binding.mediaId) ?? null,
		inspectProject: async () => project.current,
		async cleanupStagedMedia({ action }) {
			events.push(`cleanup-staged:${action.binding.mediaId}`);
			const allowed = await overrides.cleanupStaged?.(fixtureRef.current!) ?? true;
			if (allowed) stages.delete(action.stageReceipt.sourceToken);
			return allowed;
		},
		async cleanupPublishedMedia({ action }) {
			events.push(`cleanup-published:${action.binding.mediaId}`);
			const current = media.get(action.binding.mediaId);
			if (current && JSON.stringify(current) !== JSON.stringify(action.binding)) return false;
			media.delete(action.binding.mediaId);
			return true;
		},
		async replayProjectCommit({ action }) {
			events.push(`replay-project:${action.envelope.captureRequest.laneId}`);
			project.current = targetEvidence(action.envelope);
			return project.current;
		},
		releaseProjectPreparation({ projectFence }) {
			events.push(`project:release:${String(projectFence.targetRevision)}`);
		},
	});
	const fixture: Fixture = {
		service, projectGeneration, repository, project, media, stages, staged, events,
	};
	fixtureRef.current = fixture;
	return fixture;
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
