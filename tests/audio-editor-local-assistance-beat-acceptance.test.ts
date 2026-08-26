/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceBeatReviewSession,
} from '../src/common/editor/controller/local-assistance-beat-acceptance.ts';
import {
	createLocalAssistanceResultAcceptance,
} from '../src/common/editor/controller/local-assistance-result-acceptance.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);
const OUTPUT_SHA256 = '34'.repeat(32);
const BEAT_THIS_REVISION = '1.1.0';

function fence(revision = 4) {
	return {
		projectId: 'project-1', schemaVersion: 30, revision,
		sequenceId: 'main-sequence', occurrenceIds: ['music-clip'],
		sourceId: 'music-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 0, sourceEndFrame: 192_000,
		linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
	};
}

function request(selectionFence = fence(), options: Readonly<{
	modelId?: string;
	version?: string;
	task?: string;
	points?: readonly Readonly<Record<string, unknown>>[];
	tempoProposal?: Readonly<Record<string, unknown>> | null;
}> = {}) {
	return {
		sourceId: 'music-source', operation: 'beat-tracking', selectionFence,
		models: [{
			modelId: options.modelId ?? 'beat-this-small0',
			version: options.version ?? BEAT_THIS_REVISION,
			task: options.task ?? 'beat-tracking', artifactSha256s: [MODEL_SHA256],
		}],
		outputs: [{
			claim: {
				claimVersion: 1, claimId: '1'.repeat(40), jobId: '2'.repeat(40),
				role: 'beat-grid', mediaType: 'application/vnd.soundscaper.beat-grid+json',
				byteLength: 1_024, sha256: OUTPUT_SHA256,
			},
			review: {
				kind: 'beat-grid', schemaVersion: 1, sampleRate: 22_050,
				points: options.points ?? [
					{ sample: 0, kind: 'downbeat', confidence: 0.95 },
					{ sample: 11_025, kind: 'beat', confidence: null },
					{ sample: 22_050, kind: 'beat', confidence: 0.8 },
				],
				tempoProposal: options.tempoProposal === undefined
					? { kind: 'piecewise-held', changes: [
						{ startSample: 0, bpm: 100 },
						{ startSample: 44_100, bpm: 90 },
					] }
					: options.tempoProposal,
			},
		}],
	};
}

function authority(options: Readonly<{
	revision?: number;
	startFrame?: number;
	endFrame?: number;
	tracks?: readonly Readonly<Record<string, unknown>>[];
	tempoMap?: Readonly<Record<string, unknown>>;
}> = {}) {
	const revision = options.revision ?? 4;
	const startFrame = options.startFrame ?? 0;
	const endFrame = options.endFrame ?? startFrame + 192_000;
	return {
		project: {
			id: 'project-1', schemaVersion: 30, revision, sampleRate: 48_000,
			tracks: options.tracks ?? [],
			tempoMap: options.tempoMap ?? {
				mode: 'musical', events: [
					{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
					{ id: 'tempo-body', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
				],
			},
		},
		startFrame, endFrame, sourceStartFrame: 0, sourceEndFrame: 192_000,
		fence: fence(revision),
	};
}

test('the controller result facade exposes explicit Beat review rather than auto-acceptance', () => {
	const current = authority();
	const facade = createLocalAssistanceResultAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => undefined,
	});
	const session = facade.createBeatReviewSession(request());
	assert.equal(session.snapshot().phase, 'review');
	assert.throws(() => facade.acceptValidatedResult(request()), /no project acceptance adapter/iu);
});

test('beat points and tempo are initially unchecked and accept as one atomic ordinary command', async () => {
	const current = authority();
	const commits: Readonly<Record<string, unknown>>[] = [];
	const session = createLocalAssistanceBeatReviewSession({
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: (token) => assert.strictEqual(token, current.project),
		commit: (command) => commits.push(command),
	}, request());
	const review = session.snapshot();

	assert.equal(review.operation, 'beat-tracking');
	assert.equal(review.phase, 'review');
	assert.ok(review.proposals.every(({ selected }) => selected === false));
	assert.deepEqual(review.selectedProposalIds, []);
	assert.deepEqual(review.tempoMapChoice, {
		id: 'beat-grid:tempo-map', kind: 'tempo-map', selected: false,
		enabled: true, disabledReason: null,
		proposal: {
			kind: 'piecewise-held', changes: [
				{ startSample: 0, bpm: 100 }, { startSample: 44_100, bpm: 90 },
			],
		},
	});

	await session.accept([
		review.proposals[0]!.id,
		review.proposals[1]!.id,
		review.tempoMapChoice!.id,
	]);

	assert.equal(commits.length, 1);
	const batch = commits[0] as Readonly<{
		type: string; commands: readonly Readonly<Record<string, unknown>>[];
	}>;
	assert.equal(batch.type, 'batch');
	assert.deepEqual(batch.commands.map(({ type }) => type), [
		'track/add', 'tempo-event/remove', 'tempo-event/update', 'tempo-event/add',
	]);
	const track = batch.commands[0]!.track as Readonly<{
		id: string; name: string; labels: readonly Readonly<Record<string, unknown>>[];
	}>;
	assert.match(track.id, /^assistance-beats:[a-f\d]{64}$/u);
	assert.equal(track.name, 'Beats');
	assert.deepEqual(track.labels.map(({ title, startFrame, endFrame }) => ({
		title, startFrame, endFrame,
	})), [
		{ title: 'Downbeat', startFrame: 0, endFrame: 0 },
		{ title: 'Beat', startFrame: 24_000, endFrame: 24_000 },
	]);
	assert.deepEqual(batch.commands[2], {
		type: 'tempo-event/update', eventId: 'tempo-root', changes: { bpm: { num: 100, den: 1 } },
	});
	assert.deepEqual(batch.commands[3], {
		type: 'tempo-event/add',
		event: { id: 'assistance-beat-tempo:1', beat: { num: 10, den: 3 }, bpm: { num: 90, den: 1 } },
	});
	assert.ok(batch.commands.every(({ type }) => !String(type).includes('signature')
		&& !String(type).toLowerCase().includes('midi')));
	assert.deepEqual(session.snapshot().selectedProposalIds, [
		review.proposals[0]!.id, review.proposals[1]!.id, review.tempoMapChoice!.id,
	]);
});

test('label-track and tempo decisions are independent and an empty decision is mutation-free', async () => {
	const current = authority();
	const commits: Readonly<Record<string, unknown>>[] = [];
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: (command: Readonly<Record<string, unknown>>) => commits.push(command),
	};
	const labels = createLocalAssistanceBeatReviewSession(dependencies, request());
	await labels.accept([labels.snapshot().proposals[2]!.id]);
	assert.equal(commits[0]?.type, 'track/add');

	const tempo = createLocalAssistanceBeatReviewSession(dependencies, request());
	await tempo.accept([tempo.snapshot().tempoMapChoice!.id]);
	assert.equal(commits[1]?.type, 'batch');
	assert.ok((commits[1]?.commands as readonly Readonly<Record<string, unknown>>[])
		.every(({ type }) => type !== 'track/add' && type !== 'track/remove'));

	const empty = createLocalAssistanceBeatReviewSession(dependencies, request());
	await empty.accept([]);
	assert.equal(commits.length, 2);
	assert.equal(empty.snapshot().phase, 'accepted');
});

test('reject, cancel, unknown, and duplicate choices cannot mutate the project', async () => {
	const current = authority();
	let commits = 0;
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	};
	const rejected = createLocalAssistanceBeatReviewSession(dependencies, request());
	await rejected.reject();
	assert.equal(rejected.snapshot().phase, 'rejected');

	const cancelled = createLocalAssistanceBeatReviewSession(dependencies, request());
	await cancelled.cancel();
	assert.equal(cancelled.snapshot().phase, 'cancelled');
	assert.equal(cancelled.signal.aborted, true);

	const invalid = createLocalAssistanceBeatReviewSession(dependencies, request());
	await assert.rejects(invalid.accept(['beat-grid:beat:unknown']), /unknown/iu);
	assert.equal(invalid.snapshot().phase, 'review');
	const id = invalid.snapshot().proposals[0]!.id;
	await assert.rejects(invalid.accept([id, id]), /unique/iu);
	assert.equal(invalid.snapshot().phase, 'review');
	assert.equal(commits, 0);
});

test('constant and sample-locked proposals preserve held-map mode and exact rational authority', async () => {
	const current = authority({ tempoMap: {
		mode: 'sampleLocked', events: [
			{
				id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 },
				samplePosition: 0,
			},
			{
				id: 'tempo-body', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 },
				samplePosition: 96_000,
			},
		],
	} });
	const commits: Readonly<Record<string, unknown>>[] = [];
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: (command: Readonly<Record<string, unknown>>) => commits.push(command),
	};
	const held = createLocalAssistanceBeatReviewSession(dependencies, request());
	await held.accept([held.snapshot().tempoMapChoice!.id]);
	const heldCommands = commits[0]!.commands as readonly Readonly<Record<string, unknown>>[];
	assert.deepEqual(heldCommands.map(({ type }) => type), [
		'tempo-event/remove', 'tempo-event/update', 'tempo-event/add',
	]);
	assert.deepEqual(heldCommands[2], {
		type: 'tempo-event/add',
		event: {
			id: 'assistance-beat-tempo:1', samplePosition: 96_000, bpm: { num: 90, den: 1 },
		},
	});
	assert.ok(heldCommands.every(({ type }) => type !== 'tempo-map/mode-set'));

	const constant = createLocalAssistanceBeatReviewSession(
		dependencies,
		request(fence(), { tempoProposal: { kind: 'constant', bpm: 128.5 } }),
	);
	await constant.accept([constant.snapshot().tempoMapChoice!.id]);
	const constantCommands = commits[1]!.commands as readonly Readonly<Record<string, unknown>>[];
	assert.deepEqual(constantCommands.at(-1), {
		type: 'tempo-event/update', eventId: 'tempo-root', changes: { bpm: { num: 257, den: 2 } },
	});
	assert.ok(constantCommands.every(({ type }) => type !== 'tempo-map/mode-set'));
});

test('tempo application is disabled away from sequence zero or when a held change is not exact', async () => {
	const shifted = authority({ startFrame: 48_000 });
	const shiftedSession = createLocalAssistanceBeatReviewSession({
		currentAuthority: () => shifted,
		captureProject: () => shifted.project,
		assertProject: () => undefined,
		commit: () => undefined,
	}, request());
	assert.equal(shiftedSession.snapshot().tempoMapChoice?.enabled, false);
	assert.match(String(shiftedSession.snapshot().tempoMapChoice?.disabledReason), /sequence frame zero/iu);
	await assert.rejects(
		shiftedSession.accept([shiftedSession.snapshot().tempoMapChoice!.id]),
		/disabled|sequence frame zero/iu,
	);
	assert.equal(shiftedSession.snapshot().phase, 'review');

	const current = authority();
	const inexact = createLocalAssistanceBeatReviewSession({
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => undefined,
	}, request(fence(), { tempoProposal: {
		kind: 'piecewise-held', changes: [
			{ startSample: 0, bpm: 120 }, { startSample: 1, bpm: 90 },
		],
	} }));
	assert.equal(inexact.snapshot().tempoMapChoice?.enabled, false);
	assert.match(String(inexact.snapshot().tempoMapChoice?.disabledReason), /exactly representable/iu);
});

test('exact Beat This identity, authenticated role, bounds, and current request are enforced', async () => {
	const current = authority();
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => undefined,
	};
	for (const invalid of [
		request(fence(), { modelId: 'beatnet' }),
		request(fence(), { version: '1.0.0' }),
		request(fence(), { task: 'audio-tagging' }),
	]) {
		assert.throws(() => createLocalAssistanceBeatReviewSession(dependencies, invalid),
			/Beat This|beat-tracking model identity/iu);
	}
	assert.doesNotThrow(() => createLocalAssistanceBeatReviewSession(
		dependencies, request(fence(), { modelId: 'beat-this-final0' }),
	));

	const wrongRole = request();
	wrongRole.outputs[0]!.claim.role = 'audio-tags';
	assert.throws(() => createLocalAssistanceBeatReviewSession(dependencies, wrongRole), /claim/iu);
	const outside = request(fence(), { points: [{
		sample: 88_200, kind: 'beat', confidence: 1,
	}] });
	assert.throws(() => createLocalAssistanceBeatReviewSession(dependencies, outside),
		/exceeds the selected media/iu);

	const mutable = request();
	const session = createLocalAssistanceBeatReviewSession(dependencies, mutable);
	mutable.models[0]!.artifactSha256s[0] = '56'.repeat(32);
	await assert.rejects(session.accept([session.snapshot().proposals[0]!.id]),
		/no longer matches/iu);
});

test('fence, tempo-map, and owned-track state are revalidated before one replacement commit', async () => {
	let current = authority();
	const commits: Readonly<Record<string, unknown>>[] = [];
	const dependencies = {
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: (command: Readonly<Record<string, unknown>>) => commits.push(command),
	};
	const first = createLocalAssistanceBeatReviewSession(dependencies, request());
	await first.accept([first.snapshot().proposals[0]!.id]);
	const added = commits[0]!.track as Readonly<Record<string, unknown>>;

	current = authority({ revision: 5, tracks: [added] });
	const rerun = createLocalAssistanceBeatReviewSession(dependencies, request(fence(5)));
	await rerun.accept([rerun.snapshot().proposals[1]!.id]);
	assert.equal(commits[1]?.type, 'batch');
	assert.deepEqual((commits[1]?.commands as readonly Readonly<Record<string, unknown>>[])
		.map(({ type }) => type), ['track/remove', 'track/add']);

	current = authority();
	const staleFence = createLocalAssistanceBeatReviewSession(dependencies, request());
	current = authority({ revision: 5 });
	await assert.rejects(staleFence.accept([staleFence.snapshot().proposals[0]!.id]),
		/no longer matches/iu);

	current = authority();
	const staleTempo = createLocalAssistanceBeatReviewSession(dependencies, request());
	current = authority({ tempoMap: {
		mode: 'musical', events: [
			{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 121, den: 1 } },
		],
	} });
	await assert.rejects(staleTempo.accept([staleTempo.snapshot().tempoMapChoice!.id]),
		/no longer matches/iu);
});

test('a colliding unowned Beats track refuses before review', () => {
	const collision = { id: 'placeholder', type: 'label', name: 'Manual', labels: [] };
	const initial = authority();
	const seed = createLocalAssistanceBeatReviewSession({
		currentAuthority: () => initial,
		captureProject: () => initial.project,
		assertProject: () => undefined,
		commit: () => undefined,
	}, request());
	const expectedId = seed.snapshot().trackId;
	const current = authority({ tracks: [{ ...collision, id: expectedId }] });
	assert.throws(() => createLocalAssistanceBeatReviewSession({
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => undefined,
	}, request()), /owned by another edit/iu);
});
