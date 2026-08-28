/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceReactionReviewSession,
} from '../src/common/editor/controller/local-assistance-reaction-acceptance.ts';
import {
	createLocalAssistanceResultAcceptance,
} from '../src/common/editor/controller/local-assistance-result-acceptance.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);
const OUTPUT_SHA256 = '34'.repeat(32);

function fence(revision = 4) {
	return Object.freeze({
		schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
		projectId: 'project-1', revision,
		sequenceId: 'main-sequence', occurrenceIds: Object.freeze(['voice-clip']),
		sourceId: 'voice-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 0, sourceEndFrame: 240_000,
		linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
	});
}

function authority(
	revision = 4,
	tracks: readonly Readonly<Record<string, unknown>>[] = [],
) {
	return Object.freeze({
		project: Object.freeze({
			id: 'project-1', schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
			revision, sampleRate: 48_000,
			tracks: Object.freeze([...tracks]),
		}),
		startFrame: 48_000, endFrame: 288_000,
		sourceStartFrame: 0, sourceEndFrame: 240_000,
		fence: fence(revision),
	});
}

function request(selectionFence = fence()): Record<string, unknown> {
	return {
		sourceId: 'voice-source', operation: 'audio-tagging', selectionFence,
		models: [{
			modelId: 'panns-cnn10', version: '1.0.0', task: 'audio-tagging',
			artifactSha256s: [MODEL_SHA256],
		}],
		outputs: [{
			claim: {
				claimVersion: 1, claimId: 'a'.repeat(40), jobId: 'b'.repeat(40),
				role: 'audio-tags', mediaType: 'application/vnd.soundscaper.audio-tags+json',
				byteLength: 256, sha256: OUTPUT_SHA256,
			},
			review: {
				kind: 'audio-tags', schemaVersion: 1, sampleRate: 32_000,
				windowSamples: 32_000,
				windows: [
					{ startSample: 0,
						scores: { laughter: 0.8, applause: 0, cheering: 0 } },
					{ startSample: 64_000,
						scores: { laughter: 0.7, applause: 0, cheering: 0 } },
					{ startSample: 128_000,
						scores: { laughter: 0, applause: 0.9, cheering: 0 } },
				],
			},
		}],
	};
}

test('reaction review begins unselected and accepts only the explicit subset as one owned track', async () => {
	const current = authority();
	const commands: Readonly<Record<string, unknown>>[] = [];
	const acceptance = createLocalAssistanceResultAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: (token) => { assert.equal(token, current.fence); },
		commit: (command) => commands.push(command),
	});
	const session = acceptance.createReactionReviewSession(request());
	const snapshot = session.snapshot();
	assert.equal(snapshot.operation, 'audio-tagging');
	assert.equal(snapshot.phase, 'review');
	assert.ok(snapshot.proposals.every(({ selected }) => selected === false));
	assert.deepEqual(snapshot.selectedProposalIds, []);

	await session.accept([snapshot.proposals[0]!.id]);

	assert.equal(commands.length, 1);
	const add = commands[0] as Readonly<{
		type: string;
		track: Readonly<{ id: string; name: string;
			labels: readonly Readonly<Record<string, unknown>>[] }>;
	}>;
	assert.equal(add.type, 'track/add');
	assert.match(add.track.id, /^assistance-reactions:[a-f0-9]{64}$/u);
	assert.equal(add.track.name, 'Reactions');
	assert.deepEqual(add.track.labels.map(({ title, startFrame, endFrame }) => ({
		title, startFrame, endFrame,
	})), [{ title: 'Laughter', startFrame: 48_000, endFrame: 192_000 }]);
	assert.deepEqual(session.snapshot().selectedProposalIds, [snapshot.proposals[0]!.id]);
});

test('empty acceptance and rejection are mutation-free decisions', async () => {
	const current = authority();
	let commits = 0;
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	};
	const empty = createLocalAssistanceReactionReviewSession(dependencies, request());
	await empty.accept([]);
	assert.equal(empty.snapshot().phase, 'accepted');
	assert.equal(commits, 0);

	const rejected = createLocalAssistanceReactionReviewSession(dependencies, request());
	await rejected.reject();
	assert.equal(rejected.snapshot().phase, 'rejected');
	assert.equal(commits, 0);
});

test('a reaction rerun replaces the whole owned track in one atomic batch', async () => {
	let current = authority();
	const commands: Readonly<Record<string, unknown>>[] = [];
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: (command: Readonly<Record<string, unknown>>) => {
			commands.push(command);
			const add = command.type === 'track/add'
				? command
				: (command.commands as readonly Readonly<Record<string, unknown>>[]).at(-1)!;
			current = authority(current.project.revision + 1,
				[add.track as Readonly<Record<string, unknown>>]);
		},
	};
	const first = createLocalAssistanceReactionReviewSession(dependencies, request());
	await first.accept([first.snapshot().proposals[0]!.id]);
	const second = createLocalAssistanceReactionReviewSession(dependencies, request(current.fence));
	await second.accept([second.snapshot().proposals[1]!.id]);

	assert.equal(commands.length, 2);
	assert.equal(commands[1]?.type, 'batch');
	const rows = commands[1]?.commands as readonly Readonly<Record<string, unknown>>[];
	assert.deepEqual(rows.map(({ type }) => type), ['track/remove', 'track/add']);
	const replacement = rows[1]?.track as Readonly<{
		labels: readonly Readonly<Record<string, unknown>>[];
	}>;
	assert.deepEqual(replacement.labels.map(({ title }) => title), ['Applause']);
});

test('stale fences, model bindings, claims, and colliding track state refuse before mutation', async () => {
	let current = authority();
	let commits = 0;
	const mutable = request();
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	};
	const changedModel = createLocalAssistanceReactionReviewSession(dependencies, mutable);
	((mutable.models as Record<string, unknown>[])[0]!.artifactSha256s as string[])[0] = '56'.repeat(32);
	await assert.rejects(changedModel.accept([changedModel.snapshot().proposals[0]!.id]),
		/no longer matches|model/iu);
	assert.equal(commits, 0);

	const changedClaimRequest = request();
	const changedClaim = createLocalAssistanceReactionReviewSession(dependencies, changedClaimRequest);
	(((changedClaimRequest.outputs as Record<string, unknown>[])[0]!.claim as Record<string, unknown>)).sha256
		= '78'.repeat(32);
	await assert.rejects(changedClaim.accept([changedClaim.snapshot().proposals[0]!.id]),
		/no longer matches|claim/iu);
	assert.equal(commits, 0);

	const stale = createLocalAssistanceReactionReviewSession(dependencies, request());
	current = authority(5);
	await assert.rejects(stale.accept([stale.snapshot().proposals[0]!.id]), /no longer matches/iu);
	assert.equal(commits, 0);

	current = authority();
	const changedAtCommitRequest = request();
	const changedAtCommit = createLocalAssistanceReactionReviewSession({
		...dependencies,
		assertProject: () => {
			(((changedAtCommitRequest.outputs as Record<string, unknown>[])[0]!
				.claim as Record<string, unknown>)).sha256 = '9a'.repeat(32);
		},
	}, changedAtCommitRequest);
	await assert.rejects(changedAtCommit.accept([changedAtCommit.snapshot().proposals[0]!.id]),
		/no longer matches/iu);
	assert.equal(commits, 0);
});

test('unknown or duplicate subset choices never reach the command port', async () => {
	const current = authority();
	let commits = 0;
	const session = createLocalAssistanceReactionReviewSession({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	}, request());
	await assert.rejects(session.accept(['reaction:unknown:0:1']), /unknown/iu);
	assert.equal(session.snapshot().phase, 'review');
	const id = session.snapshot().proposals[0]!.id;
	await assert.rejects(session.accept([id, id]), /unique/iu);
	assert.equal(commits, 0);
});

test('wrong model roles, output claims, and out-of-selection windows fail before review', () => {
	const current = authority();
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: () => undefined,
	};
	const wrongModel = request();
	(wrongModel.models as Record<string, unknown>[])[0]!.task = 'speech-recognition';
	assert.throws(() => createLocalAssistanceReactionReviewSession(dependencies, wrongModel),
		/audio-tagging model/iu);
	const substituteModel = request();
	(substituteModel.models as Record<string, unknown>[])[0]!.modelId = 'substitute-tagger';
	assert.throws(() => createLocalAssistanceReactionReviewSession(dependencies, substituteModel),
		/audio-tagging model/iu);
	const wrongClaim = request();
	((wrongClaim.outputs as Record<string, unknown>[])[0]!.claim as Record<string, unknown>).role
		= 'recognized-text';
	assert.throws(() => createLocalAssistanceReactionReviewSession(dependencies, wrongClaim),
		/output claim/iu);
	const outside = request();
	const review = (outside.outputs as Record<string, unknown>[])[0]!.review as Record<string, unknown>;
	(review.windows as Record<string, unknown>[]).push({
		startSample: 160_000, scores: { laughter: 1, applause: 0, cheering: 0 },
	});
	assert.throws(() => createLocalAssistanceReactionReviewSession(dependencies, outside),
		/exceeds the selected media/iu);
});

test('a stable reaction-track collision is never overwritten', async () => {
	let current = authority();
	let added: Readonly<Record<string, unknown>> | null = null;
	const first = createLocalAssistanceReactionReviewSession({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: (command) => { added = command.track as Readonly<Record<string, unknown>>; },
	}, request());
	await first.accept([first.snapshot().proposals[0]!.id]);
	assert.ok(added);
	const collision = structuredClone(added) as Record<string, unknown>;
	collision.opaqueExtensions = {};
	current = authority(5, [collision]);
	assert.throws(() => createLocalAssistanceReactionReviewSession({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: () => undefined,
	}, request(current.fence)), /owned by another edit/iu);
});
