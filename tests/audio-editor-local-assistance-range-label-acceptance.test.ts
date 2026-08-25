/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceRangeLabelAcceptance,
} from '../src/common/editor/controller/local-assistance-range-label-acceptance.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);

function fence(revision = 4) {
	return Object.freeze({
		projectId: 'project-1', schemaVersion: 30, revision,
		sequenceId: 'main-sequence', occurrenceIds: Object.freeze(['voice-clip']),
		sourceId: 'voice-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 36_000, sourceEndFrame: 84_000,
		linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
	});
}

function authority(
	revision = 4,
	tracks: readonly Readonly<Record<string, unknown>>[] = [],
) {
	return Object.freeze({
		project: Object.freeze({
			id: 'project-1', schemaVersion: 30, revision, sampleRate: 48_000,
			tracks: Object.freeze([...tracks]),
		}),
		startFrame: 48_000, endFrame: 96_000,
		sourceStartFrame: 36_000, sourceEndFrame: 84_000,
		fence: fence(revision),
	});
}

function model(modelId: string, task: string) {
	return Object.freeze({
		modelId, version: '1.0.0', task, artifactSha256s: Object.freeze([MODEL_SHA256]),
	});
}

function claim(role: 'voice-activity' | 'speaker-turns') {
	return Object.freeze({
		claimVersion: 1, claimId: 'a'.repeat(40), jobId: 'b'.repeat(40), role,
		mediaType: `application/vnd.soundscaper.${role}+json`, byteLength: 128,
		sha256: '34'.repeat(32),
	});
}

function voiceRequest(selectionFence = fence()) {
	return Object.freeze({
		sourceId: 'voice-source', operation: 'voice-activity-detection', selectionFence,
		models: Object.freeze([model('silero-vad-v6', 'voice-activity-detection')]),
		outputs: Object.freeze([Object.freeze({
			claim: claim('voice-activity'),
			review: Object.freeze({
				kind: 'voice-activity', sampleRate: 16_000,
				segments: Object.freeze([{ startSample: 4_000, sampleCount: 8_000 }]),
			}),
		})]),
	});
}

function diarizationRequest(selectionFence = fence()) {
	return Object.freeze({
		sourceId: 'voice-source', operation: 'speaker-diarization', selectionFence,
		models: Object.freeze([
			model('speech-3d-speaker-eres2net', 'speaker-embedding'),
			model('pyannote-segmentation-3.0', 'speaker-segmentation'),
		]),
		outputs: Object.freeze([Object.freeze({
			claim: claim('speaker-turns'),
			review: Object.freeze({
				kind: 'speaker-turns', sampleRate: 16_000,
				turns: Object.freeze([
					{ startSample: 0, sampleCount: 8_000, speakerId: 0 },
					{ startSample: 4_000, sampleCount: 8_000, speakerId: 1 },
				]),
			}),
		})]),
	});
}

test('accepted VAD creates one stable silence label track in selected timeline coordinates', async () => {
	const current = authority();
	const commands: Readonly<Record<string, unknown>>[] = [];
	const acceptance = createLocalAssistanceRangeLabelAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: (token) => { assert.equal(token, current.fence); },
		commit: (command) => commands.push(command),
	});

	await acceptance.acceptValidatedResult(voiceRequest());

	assert.equal(commands.length, 1);
	const add = commands[0] as Readonly<{ type: string; track: Readonly<Record<string, unknown>> }>;
	assert.equal(add.type, 'track/add');
	assert.match(String(add.track.id), /^assistance-vad-silences:[a-f0-9]{64}$/u);
	assert.equal(add.track.name, 'Silences');
	assert.deepEqual((add.track.labels as readonly Readonly<Record<string, unknown>>[]).map((label) => ({
		title: label.title, startFrame: label.startFrame, endFrame: label.endFrame,
	})), [
		{ title: 'Silence', startFrame: 48_000, endFrame: 60_000 },
		{ title: 'Silence', startFrame: 84_000, endFrame: 96_000 },
	]);
});

test('accepted diarization preserves overlapping anonymous speaker regions', async () => {
	const current = authority();
	let command: Readonly<Record<string, unknown>> | null = null;
	const acceptance = createLocalAssistanceRangeLabelAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: (value) => { command = value; },
	});

	await acceptance.acceptValidatedResult(diarizationRequest());

	assert.ok(command);
	const add = command as unknown as Readonly<{
		type: string; track: Readonly<{ labels: readonly Readonly<Record<string, unknown>>[] }>;
	}>;
	assert.equal(add.type, 'track/add');
	assert.deepEqual(add.track.labels.map((label) => ({
		title: label.title, startFrame: label.startFrame, endFrame: label.endFrame,
	})), [
		{ title: 'Speaker 1', startFrame: 48_000, endFrame: 72_000 },
		{ title: 'Speaker 2', startFrame: 60_000, endFrame: 84_000 },
	]);
});

test('a rerun replaces only its owned stable label track in one batch', async () => {
	let current = authority();
	const commands: Readonly<Record<string, unknown>>[] = [];
	const acceptance = createLocalAssistanceRangeLabelAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		commit: (value) => {
			commands.push(value);
			const add = value.type === 'track/add'
				? value
				: (value.commands as readonly Readonly<Record<string, unknown>>[]).at(-1)!;
			current = authority(current.project.revision + 1,
				[add.track as Readonly<Record<string, unknown>>]);
		},
	});

	await acceptance.acceptValidatedResult(voiceRequest());
	await acceptance.acceptValidatedResult(voiceRequest(current.fence));

	assert.equal(commands.length, 2);
	assert.equal(commands[1]?.type, 'batch');
	assert.deepEqual((commands[1]?.commands as readonly Readonly<Record<string, unknown>>[])
		.map(({ type }) => type), ['track/remove', 'track/add']);
});

test('stale authority and incompatible model sets refuse without mutation', async () => {
	let current = authority();
	let commits = 0;
	const acceptance = createLocalAssistanceRangeLabelAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => { current = authority(5); },
		commit: () => { commits += 1; },
	});
	await assert.rejects(acceptance.acceptValidatedResult(voiceRequest()), /no longer matches/iu);
	assert.equal(commits, 0);

	const wrong = { ...diarizationRequest(fence(5)), models: [model('only-one', 'speaker-embedding')] };
	await assert.rejects(acceptance.acceptValidatedResult(wrong), /model set/iu);
	assert.equal(commits, 0);
});
