/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createLocalAssistanceAudioPublicationAcceptance,
} from '../src/common/editor/controller/local-assistance-audio-publication.ts';
import type { AssistanceSelectionFence } from '../src/common/editor/assistance/proposal-session.ts';
import {
	resolveLocalAssistanceSelectedMediaAuthority,
} from '../src/common/editor/controller/local-assistance-selected-media.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const SOURCE_SHA256 = 'ab'.repeat(32);
const DEEPFILTER_ARTIFACTS = Object.freeze(['11'.repeat(32), '22'.repeat(32)]);
const TIGER_ARTIFACTS = Object.freeze(['33'.repeat(32), '44'.repeat(32)]);

type DataRecord = Readonly<Record<string, unknown>>;

function fence(revision = 7, sourceStartFrame = 12_000, sourceEndFrame = 12_004) {
	return Object.freeze({
		projectId: 'project-1', schemaVersion: 30, revision,
		sequenceId: 'main-sequence', occurrenceIds: Object.freeze(['dialogue-clip']),
		sourceId: 'dialogue-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame, sourceEndFrame,
		linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
	});
}

function authority(revision = 7, options: Readonly<{
	startFrame?: number;
	endFrame?: number;
	avLinkId?: string | null;
}> = {}) {
	const startFrame = options.startFrame ?? 24_000;
	const endFrame = options.endFrame ?? 24_004;
	const sourceStartFrame = 12_000 + startFrame - 24_000;
	const sourceEndFrame = sourceStartFrame + endFrame - startFrame;
	const source = Object.freeze({
		kind: 'audio', id: 'dialogue-source', storageKey: 'dialogue-source',
		name: 'Original dialogue', mimeType: 'audio/wav', contentSha256: SOURCE_SHA256,
		frameCount: 96_000, channelCount: 2, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		opaqueExtensions: Object.freeze({}),
	});
	const clip = Object.freeze({
		kind: 'audio', id: 'dialogue-clip', sourceId: source.id, title: 'Original dialogue',
		timelineStartFrame: 12_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		durationFrames: 48_000, reversed: false, speedRatio: 1, pitchCents: 0,
		stretchToTempo: false, anchor: 'sample', warpMap: null,
		avLinkId: options.avLinkId ?? null,
	});
	const track = Object.freeze({
		type: 'audio', id: 'dialogue-track', name: 'Dialogue', clipIds: Object.freeze([clip.id]),
	});
	const project = Object.freeze({
		id: 'project-1', schemaVersion: 30, revision, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', sources: Object.freeze([source]),
		clips: Object.freeze([clip]), tracks: Object.freeze([track]),
		projectBin: Object.freeze({ clips: Object.freeze([]) }),
		sequences: Object.freeze([Object.freeze({ id: 'main-sequence', trackIds: [track.id] })]),
	});
	return Object.freeze({ project, source, clip, track, startFrame, endFrame,
		sourceStartFrame, sourceEndFrame, fence: fence(revision, sourceStartFrame, sourceEndFrame) });
}

async function wave(
	sampleRate: number,
	values: readonly (readonly number[])[],
): Promise<Readonly<{ bytes: Blob; sha256: string; frameCount: number; channelCount: number }>> {
	const encoded = encodeWav(values.map((channel) => Float32Array.from(channel)), {
		sampleRate, bitDepth: 32, float: true, dither: false,
	});
	const bytes = new Blob([encoded.slice().buffer], { type: 'audio/wav' });
	return Object.freeze({
		bytes, sha256: bytesToHex(sha256(new Uint8Array(await bytes.arrayBuffer()))),
		frameCount: values[0]!.length, channelCount: values.length,
	});
}

function model(operation: 'speech-enhancement' | 'source-separation') {
	return operation === 'speech-enhancement'
		? Object.freeze({ modelId: 'deepfilternet3', version: '3.0.0', task: operation,
			artifactSha256s: DEEPFILTER_ARTIFACTS })
		: Object.freeze({ modelId: 'tiger-dnr', version: '1.0.0', task: operation,
			artifactSha256s: TIGER_ARTIFACTS });
}

async function output(
	operation: 'speech-enhancement' | 'source-separation',
	slotId: 'enhanced-audio' | 'dialogue' | 'music' | 'effects',
	claimId: string,
	values: readonly (readonly number[])[],
) {
	const sampleRate = operation === 'speech-enhancement' ? 48_000 : 44_100;
	const result = await wave(sampleRate, values);
	return {
		slotId,
		claim: {
			claimVersion: 1, claimId, jobId: '9'.repeat(40),
			role: operation === 'speech-enhancement' ? 'enhanced-audio' : 'separated-audio',
			mediaType: 'audio/wav', byteLength: result.bytes.size, sha256: result.sha256,
		},
		review: {
			kind: 'audio-wave',
			role: operation === 'speech-enhancement' ? 'enhanced-audio' : 'separated-audio',
			sampleRate, channelCount: result.channelCount, frameCount: result.frameCount,
			sampleFormat: 'float32',
		},
		bytes: result.bytes,
	};
}

async function request(
	operation: 'speech-enhancement' | 'source-separation',
	selectionFence: AssistanceSelectionFence = fence(),
) {
	const outputs = operation === 'speech-enhancement'
		? [await output(operation, 'enhanced-audio', '1'.repeat(40), [[0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0]])]
		: await Promise.all([
			output(operation, 'dialogue', '1'.repeat(40), [[0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0]]),
			output(operation, 'music', '2'.repeat(40), [[0, 0.1, 0, 0.1], [0, 0, 0, 0]]),
			output(operation, 'effects', '3'.repeat(40), [[0, 0, 0.2, 0], [0, 0, 0, 0]]),
		]);
	return {
		sourceId: 'dialogue-source', operation, selectionFence,
		models: [model(operation)], outputs,
	};
}

class AudioStore {
	readonly events: string[];
	readonly sources = new Map<string, readonly Float32Array[]>();
	readonly deleted: string[] = [];
	failWriteFor: string | null = null;
	onCommit: (() => void) | null = null;

	constructor(events: string[]) { this.events = events; }

	beginSourceWrite(sourceId: string, metadata: DataRecord) {
		this.events.push(`begin:${sourceId}`);
		assert.equal(metadata.sampleFormat, 'float32');
		const chunks: Float32Array[][] = [];
		let framesWritten = 0;
		let closed = false;
		return Promise.resolve({
			get framesWritten() { return framesWritten; },
			write: (channels: readonly Float32Array[]) => {
				if (closed) throw new Error('writer closed');
				if (this.failWriteFor === sourceId) throw new Error('storage exhausted while writing');
				chunks.push(channels.map((channel) => channel.slice()));
				framesWritten += channels[0]?.length ?? 0;
				return Promise.resolve();
			},
			commit: () => {
				closed = true;
				const channelCount = chunks[0]?.length ?? 0;
				const channels = Array.from({ length: channelCount }, (_, channel) => {
					const result = new Float32Array(framesWritten);
					let offset = 0;
					for (const chunk of chunks) {
						result.set(chunk[channel]!, offset);
						offset += chunk[channel]!.length;
					}
					return result;
				});
				this.sources.set(sourceId, Object.freeze(channels));
				this.onCommit?.();
				return Promise.resolve(Object.freeze({ id: sourceId, frameCount: framesWritten }));
			},
			abort: () => { closed = true; return Promise.resolve(); },
		});
	}

	deleteSource(sourceId: string) {
		this.deleted.push(sourceId);
		this.sources.delete(sourceId);
		return Promise.resolve();
	}
}

function harness(currentValue = authority()) {
	let current = currentValue;
	const events: string[] = [];
	const store = new AudioStore(events);
	const commits: DataRecord[] = [];
	let id = 0;
	let preflightFailure: Error | null = null;
	let preflightHook: (() => void) | null = null;
	let commitFailure: Error | null = null;
	const acceptance = createLocalAssistanceAudioPublicationAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.project,
		assertProject: (token) => assert.strictEqual(token, current.project),
		createId: (prefix) => `${prefix}-${String(++id)}`,
		preflightStorage: (bytes, category) => {
			events.push(`preflight:${String(bytes)}:${category}`);
			preflightHook?.();
			return preflightFailure ? Promise.reject(preflightFailure) : Promise.resolve();
		},
		store,
		commit: (command) => {
			if (commitFailure) throw commitFailure;
			commits.push(command);
		},
	});
	return {
		acceptance, commits, events, store,
		setCurrent(value: ReturnType<typeof authority>) { current = value; },
		failPreflight(error: Error) { preflightFailure = error; },
		onPreflight(hook: () => void) { preflightHook = hook; },
		failCommit(error: Error) { commitFailure = error; },
	};
}

test('enhancement authenticates the reviewed Blob before publishing to Project Bin by default', async () => {
	const fixture = harness();
	await fixture.acceptance.acceptValidatedResult(await request('speech-enhancement'));

	assert.equal(fixture.commits.length, 1);
	assert.match(fixture.events[0]!, /^preflight:32:effect$/u);
	assert.match(fixture.events[1]!, /^begin:assistance-enhanced-/u);
	const batch = fixture.commits[0] as Readonly<{ type: string; commands: readonly DataRecord[] }>;
	assert.equal(batch.type, 'batch');
	assert.deepEqual(batch.commands.map(({ type }) => type), ['source/add', 'project-bin/add']);
	const source = batch.commands[0]!.source as DataRecord;
	assert.equal(source.name, 'Enhanced Dialogue');
	assert.equal(source.contentSha256,
		(await request('speech-enhancement')).outputs[0]!.claim.sha256);
	assert.equal(source.sampleRate, 48_000);
	assert.equal(source.channelCount, 2);
	assert.equal(source.frameCount, 4);
	const binClip = batch.commands[1]!.clip as DataRecord;
	assert.equal(binClip.sourceId, source.id);
	assert.equal(binClip.sourceDurationFrames, 4);
	assert.equal(binClip.durationFrames, 4);
	assert.equal(fixture.store.sources.get(String(source.id))?.[0]?.[2],
		Float32Array.from([0.3])[0]);
	assert.ok(batch.commands.every(({ type }) => type !== 'source/remove'));
});

test('the single acceptance command applies and undoes without losing the original source', async () => {
	const originalSource = createAudioSource({
		id: 'dialogue-source', storageKey: 'dialogue-source', name: 'Original dialogue',
		frameCount: 96_000, channelCount: 2, sampleRate: 48_000,
		contentSha256: SOURCE_SHA256,
	});
	const originalClip = createAudioClip({
		id: 'dialogue-clip', sourceId: originalSource.id, title: 'Original dialogue',
		timelineStartFrame: 12_000, sourceStartFrame: 0,
		sourceDurationFrames: 48_000, durationFrames: 48_000,
	});
	const originalTrack = createAudioTrack({
		id: 'dialogue-track', name: 'Dialogue', clipIds: [originalClip.id],
	});
	const original = createCurrentAudioEditorProject({
		id: 'project-1', title: 'Assistance publication', now: '2026-08-26T12:00:00.000Z',
		sampleRate: 48_000, sources: [originalSource], clips: [originalClip], tracks: [originalTrack],
		sequences: [{ id: 'main-sequence', trackIds: [originalTrack.id] }],
		primarySequenceId: 'main-sequence',
		selection: { startFrame: 24_000, endFrame: 24_004,
			trackIds: [originalTrack.id], clipIds: [originalClip.id] },
	});
	type CurrentHistory = ReturnType<typeof createEditorHistory> & {
		present: AudioEditorProjectCurrent;
	};
	let history = createEditorHistory(original) as CurrentHistory;
	const selectedDependencies = {
		getProject: () => history.present,
		getSelectedClipId: () => originalClip.id,
		captureProject: () => history.present,
		assertProject: (token: unknown) => assert.strictEqual(token, history.present),
		renderDryTrackRange: async () => [new Float32Array(4), new Float32Array(4)],
	};
	const store = new AudioStore([]);
	let id = 0;
	const acceptance = createLocalAssistanceAudioPublicationAcceptance({
		currentAuthority: () => resolveLocalAssistanceSelectedMediaAuthority(selectedDependencies),
		captureProject: () => history.present,
		assertProject: (token) => assert.strictEqual(token, history.present),
		createId: (prefix) => `${prefix}-${String(++id)}`,
		preflightStorage: () => Promise.resolve(), store,
		commit: (command) => {
			history = executeEditorCommand(history, command as AudioEditorCommand, {
				now: '2026-08-26T12:01:00.000Z',
			}) as CurrentHistory;
		},
	});
	const selected = resolveLocalAssistanceSelectedMediaAuthority(selectedDependencies);
	await acceptance.acceptValidatedResult(await request('speech-enhancement', selected.fence));
	assert.equal(history.present.sources.length, 2);
	assert.equal(history.present.projectBin.clips.length, 1);
	assert.ok(history.present.sources.some(({ id }) => id === originalSource.id));

	history = undoEditorCommand(history, { now: '2026-08-26T12:02:00.000Z' }) as CurrentHistory;
	assert.deepEqual(history.present.sources, original.sources);
	assert.deepEqual(history.present.clips, original.clips);
	assert.deepEqual(history.present.tracks, original.tracks);
	assert.deepEqual(history.present.projectBin, original.projectBin);
	const replacementSelection = resolveLocalAssistanceSelectedMediaAuthority(selectedDependencies);
	await acceptance.acceptValidatedResult(
		await request('speech-enhancement', replacementSelection.fence),
		{ placement: 'replace-selection' },
	);
	assert.equal(history.present.projectBin.clips.length, 0);
	assert.equal(history.present.sources.length, 2);
	assert.equal(history.present.clips.length, 3);
	assert.ok(history.present.sources.some(({ id }) => id === originalSource.id));
	history = undoEditorCommand(history, { now: '2026-08-26T12:02:30.000Z' }) as CurrentHistory;
	assert.deepEqual(history.present.sources, original.sources);
	assert.deepEqual(history.present.clips, original.clips);
	assert.deepEqual(history.present.tracks, original.tracks);

	const separationSelection = resolveLocalAssistanceSelectedMediaAuthority(selectedDependencies);
	await acceptance.acceptValidatedResult(
		await request('source-separation', separationSelection.fence),
		{ placement: 'project-bin-and-muted-tracks' },
	);
	assert.equal(history.present.sources.length, 4);
	assert.equal(history.present.projectBin.clips.length, 3);
	assert.deepEqual(history.present.tracks.slice(-3).map(({ name, mute }) => ({ name, mute })), [
		{ name: 'Dialogue', mute: true }, { name: 'Music', mute: true }, { name: 'Effects', mute: true },
	]);
	history = undoEditorCommand(history, { now: '2026-08-26T12:03:00.000Z' }) as CurrentHistory;
	assert.deepEqual(history.present.sources, original.sources);
	assert.deepEqual(history.present.clips, original.clips);
	assert.deepEqual(history.present.tracks, original.tracks);
	assert.deepEqual(history.present.projectBin, original.projectBin);
});

test('enhancement can replace only the exact unlinked selected range as one undoable batch', async () => {
	const fixture = harness(authority(7, { startFrame: 24_001, endFrame: 24_003 }));
	const selected = authority(7, { startFrame: 24_001, endFrame: 24_003 });
	const value = await request('speech-enhancement', selected.fence);
	value.outputs[0]!.review.frameCount = 2;
	value.outputs[0]!.bytes = (await output(
		'speech-enhancement', 'enhanced-audio', '1'.repeat(40), [[0.25, 0.5], [0, 0]],
	)).bytes;
	value.outputs[0]!.claim.byteLength = value.outputs[0]!.bytes.size;
	value.outputs[0]!.claim.sha256 = bytesToHex(sha256(
		new Uint8Array(await value.outputs[0]!.bytes.arrayBuffer()),
	));
	fixture.setCurrent(selected);

	await fixture.acceptance.acceptValidatedResult(value, { placement: 'replace-selection' });
	const batch = fixture.commits[0] as Readonly<{ type: string; commands: readonly DataRecord[] }>;
	assert.deepEqual(batch.commands.map(({ type }) => type), [
		'source/add', 'range/lift-delete', 'clip/add',
	]);
	const deletion = batch.commands[1]!;
	assert.deepEqual(deletion.trackIds, ['dialogue-track']);
	assert.deepEqual(deletion.clipIds, ['dialogue-clip']);
	assert.equal(deletion.startFrame, 24_001);
	assert.equal(deletion.endFrame, 24_003);
	assert.ok(Object.hasOwn(deletion.splitClipIds as object, 'dialogue-clip'));
	const replacement = batch.commands[2]!.clip as DataRecord;
	assert.equal(replacement.timelineStartFrame, 24_001);
	assert.equal(replacement.durationFrames, 2);
	assert.equal(replacement.sourceDurationFrames, 2);
	assert.equal(replacement.avLinkId, null);
	assert.ok(batch.commands.every(({ type }) => type !== 'project-bin/add'
		&& type !== 'source/remove'));
});

test('TIGER publishes exact D/M/E slots and optionally places three aligned muted tracks atomically', async () => {
	for (const placement of ['project-bin', 'project-bin-and-muted-tracks'] as const) {
		const fixture = harness();
		await fixture.acceptance.acceptValidatedResult(
			await request('source-separation'), { placement },
		);
		assert.equal(fixture.commits.length, 1);
		assert.match(fixture.events[0]!, /^preflight:96:effect$/u);
		const batch = fixture.commits[0] as Readonly<{ type: string; commands: readonly DataRecord[] }>;
		const sourceCommands = batch.commands.filter(({ type }) => type === 'source/add');
		assert.deepEqual(sourceCommands.map(({ source }) => (source as DataRecord).name), [
			'Dialogue', 'Music', 'Effects',
		]);
		assert.equal(batch.commands.filter(({ type }) => type === 'project-bin/add').length, 3);
		const tracks = batch.commands.filter(({ type }) => type === 'track/add');
		const clips = batch.commands.filter(({ type }) => type === 'clip/add');
		assert.equal(tracks.length, placement === 'project-bin' ? 0 : 3);
		assert.equal(clips.length, placement === 'project-bin' ? 0 : 3);
		for (const command of tracks) {
			assert.equal((command.track as DataRecord).mute, true);
			assert.equal(command.sequenceId, 'main-sequence');
		}
		for (const command of clips) {
			const clip = command.clip as DataRecord;
			assert.equal(clip.timelineStartFrame, 24_000);
			assert.equal(clip.durationFrames, 4);
			assert.equal(clip.sourceDurationFrames, 4);
		}
	}
});

test('audio publication rejects wrong bindings, slots, geometry, digest, NaN, and linked replacement', async (context) => {
	await context.test('model and slots', async () => {
		for (const mutate of [
			(value: Awaited<ReturnType<typeof request>>) => {
				value.models[0] = { ...value.models[0]!, modelId: 'other' } as never;
			},
			(value: Awaited<ReturnType<typeof request>>) => {
				value.models[0] = { ...value.models[0]!, task: 'speech-enhancement' } as never;
			},
			(value: Awaited<ReturnType<typeof request>>) => { value.outputs[2]!.slotId = 'music'; },
		]) {
			const fixture = harness();
			const value = await request('source-separation');
			mutate(value);
			await assert.rejects(fixture.acceptance.acceptValidatedResult(value), /model|slot/iu);
			assert.deepEqual(fixture.events, []);
		}
	});

	await context.test('geometry, digest, and samples', async () => {
		for (const mutate of [
			(value: Awaited<ReturnType<typeof request>>) => { value.outputs[0]!.review.frameCount = 5; },
			(value: Awaited<ReturnType<typeof request>>) => { value.outputs[0]!.claim.sha256 = 'ff'.repeat(32); },
			async (value: Awaited<ReturnType<typeof request>>) => {
				const invalid = await output('speech-enhancement', 'enhanced-audio', '1'.repeat(40),
					[[0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0]]);
				const bytes = new Uint8Array(await invalid.bytes.arrayBuffer());
				new DataView(bytes.buffer).setFloat32(44, Number.NaN, true);
				invalid.bytes = new Blob([bytes], { type: 'audio/wav' });
				invalid.claim.sha256 = bytesToHex(sha256(bytes));
				value.outputs[0] = invalid;
			},
		]) {
			const fixture = harness();
			const value = await request('speech-enhancement');
			await mutate(value);
			await assert.rejects(fixture.acceptance.acceptValidatedResult(value), /geometry|digest|finite/iu);
			assert.equal(fixture.store.sources.size, 0);
		}
	});

	await context.test('linked optional replacement', async () => {
		const fixture = harness(authority(7, { avLinkId: 'linked-av' }));
		await assert.rejects(
			fixture.acceptance.acceptValidatedResult(
				await request('speech-enhancement'), { placement: 'replace-selection' },
			),
			/linked A\/V/iu,
		);
		assert.equal(fixture.commits.length, 0);
	});
});

test('capacity, stale authority, mutable claims, storage failure, and commit refusal leave no publication', async () => {
	{
		const fixture = harness();
		fixture.failPreflight(new Error('quota exhausted'));
		await assert.rejects(
			fixture.acceptance.acceptValidatedResult(await request('speech-enhancement')),
			/quota exhausted/iu,
		);
		assert.equal(fixture.events.filter((event) => event.startsWith('begin:')).length, 0);
	}
	{
		const fixture = harness();
		fixture.onPreflight(() => fixture.setCurrent(authority(8)));
		await assert.rejects(
			fixture.acceptance.acceptValidatedResult(await request('speech-enhancement')),
			/stale|no longer matches/iu,
		);
		assert.equal(fixture.store.sources.size, 0);
	}
	{
		const fixture = harness();
		const value = await request('speech-enhancement');
		fixture.onPreflight(() => { value.outputs[0]!.claim.sha256 = 'aa'.repeat(32); });
		await assert.rejects(
			fixture.acceptance.acceptValidatedResult(value),
			/changed|digest/iu,
		);
		assert.equal(fixture.store.sources.size, 0);
	}
	{
		const fixture = harness();
		fixture.store.failWriteFor = 'assistance-enhanced-audio-1';
		await assert.rejects(
			fixture.acceptance.acceptValidatedResult(await request('speech-enhancement')),
			/storage exhausted/iu,
		);
		assert.equal(fixture.store.sources.size, 0);
		assert.deepEqual(fixture.store.deleted, ['assistance-enhanced-audio-1']);
	}
	{
		const fixture = harness();
		fixture.failCommit(new Error('project commit refused'));
		await assert.rejects(
			fixture.acceptance.acceptValidatedResult(await request('speech-enhancement')),
			/project commit refused/iu,
		);
		assert.equal(fixture.store.sources.size, 0);
		assert.deepEqual(fixture.store.deleted, ['assistance-enhanced-audio-1']);
	}
});
