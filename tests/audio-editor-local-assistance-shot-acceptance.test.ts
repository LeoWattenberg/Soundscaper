/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceResultAcceptance,
} from '../src/common/editor/controller/local-assistance-result-acceptance.ts';
import {
	createLocalAssistanceShotAcceptance,
} from '../src/common/editor/controller/local-assistance-shot-acceptance.ts';

const FENCE = Object.freeze({
	projectId: 'project-1', schemaVersion: 31, revision: 7, sequenceId: 'main-sequence',
	occurrenceIds: Object.freeze(['video-clip']), sourceId: 'video-source',
	sourceSha256: 'ab'.repeat(32), sourceStartFrame: 20, sourceEndFrame: 120,
	linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
});

const TRANSNET_MODEL = Object.freeze({
	modelId: 'transnetv2', version: '1.0.0', task: 'shot-detection',
	artifactSha256s: Object.freeze(['12'.repeat(32)]),
});

function reviewed(boundaries = [
	{ sourceFrame: 24, presentationTick: '90090', score: 0.425 },
	{ sourceFrame: 120, presentationTick: '450450', score: 0.9 },
], options: Readonly<{
	detector?: 'ffmpeg-scdet' | 'transnetv2';
	models?: readonly Readonly<Record<string, unknown>>[];
}> = {}) {
	const detector = options.detector ?? 'ffmpeg-scdet';
	return Object.freeze({
		sourceId: 'video-source', operation: 'shot-detection', selectionFence: FENCE,
		models: Object.freeze(options.models ?? (detector === 'transnetv2' ? [TRANSNET_MODEL] : [])),
		outputs: Object.freeze([Object.freeze({
			claim: Object.freeze({
				claimVersion: 1, claimId: '1'.repeat(40), jobId: '2'.repeat(40),
				role: 'shot-boundaries',
				mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
				byteLength: 512, sha256: '34'.repeat(32),
			}),
			review: Object.freeze({
				kind: 'shot-boundaries', schemaVersion: 1, detector,
				timescale: 90_000, sourceFrameCount: 240, boundaries: Object.freeze(boundaries),
			}),
		})]),
	});
}

function accurateReviewed(boundaries = [
	{ sourceFrame: 24, presentationTick: '90090', score: 0.425 },
	{ sourceFrame: 120, presentationTick: '450450', score: 0.9 },
], options: Readonly<{
	models?: readonly Readonly<Record<string, unknown>>[];
}> = {}) {
	return reviewed(boundaries, { detector: 'transnetv2', ...options });
}

function authority(timelineAnnotations: readonly Readonly<Record<string, unknown>>[] = []) {
	const project = Object.freeze({
		id: 'project-1', schemaVersion: 31, revision: 7, sampleRate: 48_000,
		tempoMap: Object.freeze({
			mode: 'musical', events: Object.freeze([Object.freeze({
				beat: Object.freeze({ num: 0, den: 1 }), bpm: Object.freeze({ num: 120, den: 1 }),
			})]),
		}),
		timelineAnnotations: Object.freeze(timelineAnnotations),
	});
	return Object.freeze({
		project,
		source: Object.freeze({ id: 'video-source', sourceFrameCount: 240 }),
		clip: Object.freeze({
			id: 'video-clip', sequenceId: 'main-sequence', sequenceStartFrame: 10,
			sequenceFrameCount: 100, sourceInFrame: 20, sourceFrameCount: 100,
		}),
		track: Object.freeze({ id: 'video-track', type: 'video', clipIds: Object.freeze(['video-clip']) }),
		sequence: Object.freeze({ id: 'main-sequence', rate: Object.freeze({ num: 24, den: 1 }) }),
		sourceStartFrame: 20, sourceEndFrame: 120, fence: FENCE,
	});
}

test('reviewed cuts inside the exact occurrence become one stable F31 marker batch', async () => {
	let current = authority();
	const commits: Readonly<Record<string, unknown>>[] = [];
	const acceptance = createLocalAssistanceResultAcceptance({
		currentAuthority: () => current as never,
		currentVideoAuthority: () => current as never,
		captureProject: () => current.project,
		assertProject: (token) => assert.strictEqual(token, current.project),
		commit: (command) => { commits.push(command); },
	});

	await acceptance.acceptValidatedResult(reviewed());

	assert.equal(commits.length, 1);
	const command = commits[0] as Readonly<{ type: string; commands: readonly Readonly<Record<string, unknown>>[] }>;
	assert.equal(command.type, 'batch');
	assert.equal(command.commands.length, 1,
		'the boundary at the selected source end is outside the occurrence');
	const add = command.commands[0] as Readonly<{ type: string; annotation: Readonly<Record<string, unknown>> }>;
	assert.equal(add.type, 'timeline-annotation/add');
	assert.equal(add.annotation.kind, 'marker');
	assert.equal(add.annotation.anchor, 'sample');
	assert.equal(add.annotation.sequenceId, 'main-sequence');
	assert.equal(add.annotation.positionFrame, 28_000);
	assert.equal(add.annotation.name, 'Shot 1');
	assert.equal(add.annotation.color, 'orange');
	assert.match(String(add.annotation.id), /^assistance-shot:/u);
	assert.match(String(add.annotation.batchId), /^assistance-shot-batch:/u);

	current = authority([add.annotation]);
	await acceptance.acceptValidatedResult(reviewed([
		{ sourceFrame: 48, presentationTick: '180180', score: 0.75 },
	]));
	const replacement = commits[1] as Readonly<{
		type: string; commands: readonly Readonly<Record<string, unknown>>[];
	}>;
	assert.equal(replacement.type, 'batch');
	assert.equal(replacement.commands[0]?.type, 'timeline-annotation/remove-many');
	assert.deepEqual(replacement.commands[0]?.annotationIds, [add.annotation.id]);
	assert.equal(replacement.commands[1]?.type, 'timeline-annotation/add');
});

test('reviewed TransNetV2 cuts emit the same canonical markers and never timeline cuts', async () => {
	const current = authority();
	const commits: Readonly<Record<string, unknown>>[] = [];
	const acceptance = createLocalAssistanceShotAcceptance({
		currentAuthority: () => current as never,
		captureProject: () => current.project,
		assertProject: (token) => assert.strictEqual(token, current.project),
		commit: (command) => commits.push(command),
	});
	await acceptance.acceptValidatedResult(accurateReviewed());
	assert.equal(commits.length, 1);
	const batch = commits[0] as Readonly<{
		type: string; commands: readonly Readonly<Record<string, unknown>>[];
	}>;
	assert.equal(batch.type, 'batch');
	assert.deepEqual(batch.commands.map(({ type }) => type), ['timeline-annotation/add']);
	const annotation = batch.commands[0]?.annotation as Readonly<Record<string, unknown>>;
	assert.equal(annotation.kind, 'marker');
	assert.equal(annotation.positionFrame, 28_000);
	const extensions = annotation.opaqueExtensions as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	assert.equal(extensions['org.soundscaper.assistance-shot-boundaries-v1']?.detector, 'transnetv2');
});

test('shot acceptance binds each detector to its exact model identity and role', async () => {
	const current = authority();
	const acceptance = createLocalAssistanceShotAcceptance({
		currentAuthority: () => current as never,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => undefined,
	});
	for (const [name, candidate] of [
		['missing accurate model', accurateReviewed([], { models: [] })],
		['wrong model identity', accurateReviewed([], { models: [{
			...TRANSNET_MODEL, modelId: 'another-shot-detector',
		}] })],
		['wrong model role', accurateReviewed([], { models: [{
			...TRANSNET_MODEL, task: 'image-text-embedding',
		}] })],
		['wrong model version', accurateReviewed([], { models: [{
			...TRANSNET_MODEL, version: '',
		}] })],
		['wrong model artifact authority', accurateReviewed([], { models: [{
			...TRANSNET_MODEL, artifactSha256s: ['not-a-digest'],
		}] })],
		['model supplied to Fast', reviewed([], { models: [TRANSNET_MODEL] })],
	] as const) await assert.rejects(acceptance.acceptValidatedResult(candidate),
		/model|TransNet|Fast|detector/iu, name);
});

test('accurate shot acceptance rechecks finite ordering and the exact fence before mutation', async () => {
	const current = authority();
	let commits = 0;
	const acceptance = createLocalAssistanceShotAcceptance({
		currentAuthority: () => current as never,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	});
	for (const boundaries of [
		[{ sourceFrame: 24, presentationTick: '90090', score: Number.NaN }],
		[
			{ sourceFrame: 25, presentationTick: '90090', score: 0.8 },
			{ sourceFrame: 24, presentationTick: '90091', score: 0.7 },
		],
	]) await assert.rejects(acceptance.acceptValidatedResult(accurateReviewed(boundaries)),
		/score|ordered/iu);
	await assert.rejects(acceptance.acceptValidatedResult({
		...accurateReviewed(), selectionFence: { ...FENCE, revision: 8 },
	}), /stale|selection/iu);
	assert.equal(commits, 0);
});

test('shot acceptance refuses source mismatch, model authority, stale selection, and annotation overflow', async () => {
	let current = authority();
	const acceptance = createLocalAssistanceShotAcceptance({
		currentAuthority: () => current as never,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => undefined,
	});
	await assert.rejects(acceptance.acceptValidatedResult({
		...reviewed(), models: [{ modelId: 'invented', version: '1', artifactSha256s: ['1'.repeat(64)] }],
	}), /model-free/iu);
	await assert.rejects(acceptance.acceptValidatedResult({
		...reviewed(), outputs: [{ ...reviewed().outputs[0], review: {
			...reviewed().outputs[0]!.review, sourceFrameCount: 241,
		} }],
	}), /source-frame count/iu);
	current = Object.freeze({
		...current, fence: Object.freeze({ ...FENCE, revision: 8 }),
	}) as unknown as typeof current;
	await assert.rejects(acceptance.acceptValidatedResult(reviewed()), /stale|selection/iu);

	const full = Array.from({ length: 4_096 }, (_, index) => Object.freeze({
		id: `manual-${String(index)}`, sequenceId: 'main-sequence', name: '', color: 'auto',
		batchId: null, opaqueExtensions: Object.freeze({}), kind: 'marker', anchor: 'sample',
		positionFrame: index,
	}));
	current = authority(full);
	await assert.rejects(acceptance.acceptValidatedResult(reviewed()), /capacity/iu);
});

test('a valid no-cut result makes no mutation when no owned markers exist', async () => {
	let commits = 0;
	const current = authority();
	const acceptance = createLocalAssistanceShotAcceptance({
		currentAuthority: () => current as never,
		captureProject: () => current.project,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	});
	await acceptance.acceptValidatedResult(reviewed([]));
	assert.equal(commits, 0);
});
