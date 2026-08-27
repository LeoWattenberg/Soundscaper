/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAssistanceAdvancedWorkflowPreparation } from
	'../src/common/editor/controller/local-assistance-advanced-workflow-preparation.ts';
import {
	createAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import type { AssistanceWorkflowProgressV1 } from
	'../src/common/editor/assistance/workflow.ts';
import type { AssistanceOperation } from '../src/common/editor/assistance/operation.ts';
import type { LocalAssistanceBridge, LocalAssistanceModel } from
	'../src/common/editor/ui/local-assistance-bridge.ts';
import type {
	LocalAssistanceWorkflowBridge,
	LocalAssistanceWorkflowCustodyBridge,
} from '../src/common/editor/ui/local-assistance-workflow-bridge.ts';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from
	'../src/common/editor/ui/local-assistance-preparation.ts';

const JOB_ID = 'a1'.repeat(20);
const MODEL = Object.freeze({ modelId: 'speech-model', version: '1.0.0',
	task: 'speech-recognition', artifactSha256s: Object.freeze(['1b'.repeat(32)]) });
const TRANSCRIPT = Object.freeze({ language: 'en', segments: Object.freeze([Object.freeze({
	startSeconds: 0, endSeconds: 1, text: 'Workflow review.', words: Object.freeze([]), speaker: null,
})]) });

test('the Advanced surface executes, reviews, and accepts only through one workflow-v1 job', async () => {
	const fixture = advancedFixture();
	const store = createLocalAssistanceAdvancedWorkflowSessionStore(fixture);
	store.connect();
	await store.load();
	store.selectSource('source-a');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	assert.equal(store.getSnapshot().canRun, true,
		'the workflow request owns the only native consent dialog');
	await store.run();
	const snapshot = store.getSnapshot();
	assert.equal(snapshot.phase, 'completed');
	assert.equal(snapshot.canReview, true);
	assert.equal(snapshot.canAccept, true);
	assert.equal(snapshot.result?.operation, 'speech-recognition');
	assert.equal(snapshot.result?.outputs[0]?.review.kind, 'transcript');
	assert.deepEqual(fixture.calls, [
		'models', 'workflow:create', 'selected:prepare', 'workflow:stage:audio',
		'workflow:reserve:transcript', 'workflow:run:advanced:speech-recognition',
		'workflow:read:transcript', 'workflow:release',
	]);
	assert.equal(fixture.operationCalls, 0, 'the compatible operation-v1 API remains untouched');
	await store.accept();
	assert.equal(store.getSnapshot().phase, 'accepted');
	assert.equal(fixture.accepted.length, 1);
	assert.deepEqual(fixture.aggregateChecks, ['advanced:speech-recognition']);
	const accepted = fixture.accepted[0] as Readonly<Record<string, unknown>>;
	assert.equal(accepted.operation, 'speech-recognition');
	await store.dispose();
});

test('Advanced acceptance preserves reviewed output when aggregate authority is stale', async () => {
	const fixture = advancedFixture();
	const store = createLocalAssistanceAdvancedWorkflowSessionStore(fixture);
	store.connect();
	await store.load();
	store.selectSource('source-a');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	await store.run();
	fixture.aggregateCurrent = false;
	await store.accept();
	assert.equal(store.getSnapshot().phase, 'completed');
	assert.equal(store.getSnapshot().canAccept, true);
	assert.match(store.getSnapshot().error ?? '', /aggregate fence is stale/iu);
	assert.equal(fixture.accepted.length, 0);
	fixture.aggregateCurrent = true;
	await store.accept();
	assert.equal(store.getSnapshot().phase, 'accepted');
	assert.equal(fixture.accepted.length, 1);
	await store.dispose();
});

test('Advanced workflow progress and cancellation stay correlated to the aggregate job', async () => {
	let releaseRun: (() => void) | null = null;
	const fixture = advancedFixture(async (request, emit) => {
		emit({ contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId,
			sequence: 0, stageId: request.stageIds[0]!, stageIndex: 0, stageCount: 1,
			phase: 'running', completed: 1, total: 4 });
		await new Promise<void>((resolve) => { releaseRun = resolve; });
		return { contractVersion: 1 as const, jobId: request.jobId,
			workflowId: request.workflowId, outcome: 'consent-declined' as const };
	});
	const store = createLocalAssistanceAdvancedWorkflowSessionStore(fixture);
	store.connect();
	await store.load();
	store.selectSource('source-a');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	const running = store.run();
	await waitFor(() => releaseRun !== null);
	assert.deepEqual(store.getSnapshot().progress, { contractVersion: 1, jobId: JOB_ID,
		operation: 'speech-recognition', sequence: 0, phase: 'running', completed: 1, total: 4 });
	const cancelling = store.cancel();
	await waitFor(() => fixture.calls.includes('workflow:cancel'));
	(releaseRun as (() => void) | null)?.();
	await Promise.all([running, cancelling]);
	assert.equal(store.getSnapshot().phase, 'cancelled');
	assert.equal(fixture.calls.filter((call) => call === 'workflow:cancel').length, 1);
	assert.equal(fixture.calls.filter((call) => call === 'workflow:release').length, 1);
	await store.dispose();
});

test('Advanced workflow progress ignores stale sequences and regressive phases', async () => {
	const fixture = advancedFixture(async (request, emit) => {
		const progress = (sequence: number, phase: AssistanceWorkflowProgressV1['phase']) => emit({
			contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId,
			sequence, stageId: request.stageIds[0]!, stageIndex: 0, stageCount: 1,
			phase, completed: null, total: null,
		});
		progress(2, 'running');
		progress(1, 'finalizing');
		progress(3, 'loading-model');
		return { contractVersion: 1 as const, jobId: request.jobId,
			workflowId: request.workflowId, outcome: 'consent-declined' as const };
	});
	const store = createLocalAssistanceAdvancedWorkflowSessionStore(fixture);
	const acceptedProgress: NonNullable<ReturnType<typeof store.getSnapshot>['progress']>[] = [];
	store.subscribe(() => {
		const progress = store.getSnapshot().progress;
		if (progress) acceptedProgress.push(progress);
	});
	store.connect();
	await store.load();
	store.selectSource('source-a');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	await store.run();
	assert.deepEqual(store.getSnapshot().progress, null,
		'terminal cancellation clears progress after accepting only the forward event');
	assert.deepEqual(acceptedProgress.map(({ sequence, phase }) => ({ sequence, phase })), [
		{ sequence: 2, phase: 'running' },
	]);
	await store.dispose();
});

test('Advanced review does not offer project acceptance without a matching adapter', async () => {
	const fixture = advancedFixture(undefined, {
		operation: 'audio-tagging',
		model: Object.freeze({ modelId: 'tag-model', version: '1.0.0', task: 'audio-tagging',
			artifactSha256s: Object.freeze(['6a'.repeat(32)]) }),
		outputRole: 'audio-tags',
		outputMediaType: 'application/vnd.soundscaper.audio-tags+json',
		outputValue: { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
			windows: [{ startSample: 0,
				scores: { laughter: 0.75, applause: 0.2, cheering: 0 } }] },
	});
	const store = createLocalAssistanceAdvancedWorkflowSessionStore(fixture);
	store.connect();
	await store.load();
	store.selectSource('source-a');
	store.selectOperation('audio-tagging');
	store.selectModel('tag-model');
	await store.run();
	assert.equal(store.getSnapshot().phase, 'completed');
	assert.equal(store.getSnapshot().canReview, true);
	assert.equal(store.getSnapshot().canAccept, false);
	await assert.rejects(store.accept(), /No reviewed proposal is ready/u);
	assert.equal(fixture.accepted.length, 0);
	await store.dispose();
});

interface AdvancedFixtureOptions {
	readonly operation?: AssistanceOperation;
	readonly model?: LocalAssistanceModel;
	readonly outputRole?: 'transcript' | 'audio-tags';
	readonly outputMediaType?: string;
	readonly outputValue?: unknown;
}

function advancedFixture(
	runOverride?: (
		request: Parameters<NonNullable<LocalAssistanceBridge['workflow']>['run']>[0],
		emit: (progress: AssistanceWorkflowProgressV1) => void,
	) => Promise<Awaited<ReturnType<NonNullable<LocalAssistanceBridge['workflow']>['run']>>>,
	options: AdvancedFixtureOptions = {},
) {
	const calls: string[] = [];
	const accepted: unknown[] = [];
	const operation = options.operation ?? 'speech-recognition';
	const model = options.model ?? MODEL;
	const outputRole = options.outputRole ?? 'transcript';
	const outputMediaType = options.outputMediaType
		?? 'application/vnd.soundscaper.transcript+json';
	const outputValue = options.outputValue ?? TRANSCRIPT;
	let operationCalls = 0;
	let aggregateCurrent = true;
	const aggregateChecks: string[] = [];
	let ordinal = 0;
	let progress: ((value: AssistanceWorkflowProgressV1) => void) | null = null;
	const custody: LocalAssistanceWorkflowCustodyBridge = Object.freeze({
		async stageInput(request: Readonly<Record<string, unknown>>) {
			calls.push(`workflow:stage:${String(request.slotId)}`);
			return handle(request, 'input', ++ordinal, (request.bytes as Blob).size);
		},
		async reserveOutput(request: Readonly<Record<string, unknown>>) {
			calls.push(`workflow:reserve:${String(request.slotId)}`);
			return handle(request, 'output', ++ordinal, Number(request.maximumByteLength));
		},
		async bindProducer() { throw new Error('Advanced has no producer stages.'); },
		async release() { calls.push('workflow:release'); return true; },
	});
	const workflow: LocalAssistanceWorkflowBridge = Object.freeze({ custody,
		async createJob() { calls.push('workflow:create');
			return { contractVersion: 1 as const, jobId: JOB_ID }; },
		async run(request: Parameters<LocalAssistanceWorkflowBridge['run']>[0]) {
			calls.push(`workflow:run:${request.workflowId}`);
			if (runOverride) return runOverride(request, (value) => progress?.(value));
			return { contractVersion: 1 as const, jobId: request.jobId,
				workflowId: request.workflowId, outcome: 'completed' as const,
				result: { contractVersion: 1 as const, jobId: request.jobId,
					workflowId: request.workflowId, stageIds: request.stageIds,
					outputs: request.outputs } };
		},
		async cancel(jobId: string) { calls.push('workflow:cancel');
			return { contractVersion: 1 as const, jobId, outcome: 'cancelled' as const }; },
		async readOutput(request: Parameters<
			NonNullable<LocalAssistanceWorkflowBridge['readOutput']>
			>[0]) {
			calls.push(`workflow:read:${request.claim.slotId}`);
			return new Blob([JSON.stringify(outputValue)], { type: outputMediaType });
		},
		onProgress(listener: Parameters<LocalAssistanceWorkflowBridge['onProgress']>[0]) {
			progress = listener; return () => { progress = null; };
		},
	});
	const bridge: LocalAssistanceBridge = Object.freeze({
		models: async () => { calls.push('models'); return [model]; },
		createJob: async () => { operationCalls += 1; throw new Error('operation-v1 create'); },
		stageInput: async () => { operationCalls += 1; throw new Error('operation-v1 stage'); },
		reserveOutput: async () => { operationCalls += 1; throw new Error('operation-v1 reserve'); },
		run: async () => { operationCalls += 1; throw new Error('operation-v1 run'); },
		cancel: async () => { operationCalls += 1; throw new Error('operation-v1 cancel'); },
		readOutput: async () => { operationCalls += 1; throw new Error('operation-v1 read'); },
		release: async () => { operationCalls += 1; throw new Error('operation-v1 release'); },
		onProgress: () => { operationCalls += 1; return () => undefined; },
		workflow,
	});
	const project = Object.freeze({ id: 'project-a', schemaVersion: 30, revision: 2,
		clips: Object.freeze([{ id: 'clip-a', kind: 'audio', sourceId: 'source-a',
			sequenceId: 'main', avLinkId: null, reversed: false, speedRatio: 1,
			pitchCents: 0, stretchToTempo: false, warpMap: null }]),
		sources: Object.freeze([{ id: 'source-a', kind: 'audio', sampleRate: 48_000 }]),
		assistanceAssets: Object.freeze([]) });
	const fence = Object.freeze({ projectId: 'project-a', schemaVersion: 30, revision: 2,
		sequenceId: 'main', occurrenceIds: Object.freeze(['clip-a']), sourceId: 'source-a',
		sourceSha256: '2c'.repeat(32), sourceStartFrame: 0, sourceEndFrame: 48_000,
		linkMembershipSha256: '3d'.repeat(32), timingAuthoritySha256: '4e'.repeat(32) });
	const advanced = createLocalAssistanceAdvancedWorkflowPreparation({ getProject: () => project,
		captureProject: () => project, assertProject: (token) => assert.equal(token, project),
		preflightStorage: async () => undefined, selected: {
			prepareSelectedMedia: async () => { calls.push('selected:prepare'); return {
				sourceId: 'source-a', operation, selectionFence: fence,
				inputs: [{ role: 'audio', mediaType: 'audio/wav',
					bytes: new Blob(['audio'], { type: 'audio/wav' }) }],
				outputs: [{ role: outputRole, mediaType: outputMediaType, maximumByteLength: 4096 }],
			}; },
		},
	});
	const preparationValue = Object.freeze({
		listSelectedMedia: async () => ({ sources: [{ sourceId: 'source-a', label: 'Interview',
			mediaKind: 'audio', operations: [operation] }] }),
		prepareSelectedMedia: async (request: Parameters<
			LocalAssistanceSelectedMediaPreparationPort['prepareSelectedMedia']
		>[0]) => advancedFixturePrepared(request, fence),
		prepareAdvancedWorkflow: advanced.prepareAdvancedWorkflow,
		acceptValidatedResult: async (request: Parameters<
			NonNullable<LocalAssistanceSelectedMediaPreparationPort['acceptValidatedResult']>
		>[0]) => { accepted.push(request); },
		assertCurrentWorkflowFence: async (workflowValue: unknown) => {
			const workflow = workflowValue as Readonly<Record<string, unknown>>;
			aggregateChecks.push(String(workflow.workflowId));
			if (!aggregateCurrent) throw new DOMException('aggregate fence is stale', 'AbortError');
		},
	});
	const preparation: LocalAssistanceSelectedMediaPreparationPort = preparationValue;
	return { bridge, preparation, calls, accepted, aggregateChecks,
		get aggregateCurrent() { return aggregateCurrent; },
		set aggregateCurrent(value: boolean) { aggregateCurrent = value; },
		get operationCalls() { return operationCalls; } };
}

function advancedFixturePrepared(request: Readonly<Record<string, unknown>>, fence: unknown) {
	return { sourceId: request.sourceId, operation: request.operation, selectionFence: fence,
		inputs: [{ role: 'audio', mediaType: 'audio/wav',
			bytes: new Blob(['audio'], { type: 'audio/wav' }) }],
		outputs: [{ role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
			maximumByteLength: 4096 }] };
}

function handle(
	request: Readonly<Record<string, unknown>>, direction: 'input' | 'output',
	ordinal: number, bytes: number,
) {
	const custody = createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1,
		workflowId: request.workflowId as never, direction, jobId: String(request.jobId),
		stageId: String(request.stageId), slotId: String(request.slotId),
		claimId: ordinal.toString(16).padStart(40, '0'),
		...(direction === 'input' ? { byteLength: bytes, sha256: '5f'.repeat(32),
			maximumByteLength: null } : { byteLength: null, sha256: null,
			maximumByteLength: bytes }) });
	return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let count = 0; count < 100 && !predicate(); count += 1) await new Promise(setImmediate);
	assert.equal(predicate(), true, 'expected asynchronous workflow state');
}
