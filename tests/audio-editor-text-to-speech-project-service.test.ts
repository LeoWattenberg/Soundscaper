/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { createAssistanceTtsScriptBodyPublicationV1 } from '../src/common/editor/assistance/tts-script-body-publication-v1.ts';
import { createTextToSpeechProjectPort } from '../src/common/editor/controller/assistance/local-assistance-text-to-speech-project-service.ts';

function pcm16Wave(samples: readonly number[], sampleRate = 24_000): Blob {
	const bytes = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (const [offset, value] of [['RIFF', 0], ['WAVE', 8], ['fmt ', 12], ['data', 36]] as const) {
		for (let index = 0; index < 4; index += 1) bytes[value + index] = offset.charCodeAt(index);
	}
	view.setUint32(4, bytes.length - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	view.setUint32(40, samples.length * 2, true);
	for (let index = 0; index < samples.length; index += 1) {
		view.setInt16(44 + index * 2, samples[index]!, true);
	}
	return new Blob([bytes], { type: 'audio/wav' });
}

function fixture(options: Readonly<{
	commitFailure?: boolean;
	sourceCommitFailure?: boolean;
	reportedFramesWritten?: number;
	deleteSourceFailure?: Error;
	bodyDiscardFailure?: Error;
	preflightChangesProject?: boolean;
	playheadFrame?: number;
	bodyWriterMissingOwned?: boolean;
	existingBodyMetadata?: unknown;
	existingBodyBytes?: Uint8Array;
	project?: {
		id: string; revision: number; sampleRate: number; primarySequenceId: string;
		sources: Record<string, unknown>[]; clips: Record<string, unknown>[];
		tracks: Record<string, unknown>[]; assistanceAssets: unknown[];
	};
	selectedClipId?: string;
}> = {}) {
	const commands: Record<string, unknown>[] = [];
	const deletedSources: string[] = [];
	let discarded = 0;
	let bytesWritten = 0;
	let bodyAborts = 0;
	let id = 0;
	let project = options.project ?? { id: 'project-1', revision: 1, sampleRate: 48_000,
		primarySequenceId: 'sequence-1', sources: [], clips: [], tracks: [], assistanceAssets: [] };
	const port = createTextToSpeechProjectPort({
		getProject: () => project, getSelectedClipId: () => options.selectedClipId ?? null,
	getPlayheadFrame: () => options.playheadFrame ?? 960,
		createId: (prefix) => `${prefix}-${++id}`,
		commit: (command) => {
			if (options.commitFailure) throw new Error('commit refused');
			commands.push(command);
		},
		preflightStorage: async () => {
			if (options.preflightChangesProject) project = { ...project, revision: project.revision + 1 };
		},
		store: {
			beginSourceWrite: async () => ({
				framesWritten: options.reportedFramesWritten,
				write: (channels: readonly Float32Array[]) => { bytesWritten += channels[0]!.length * 4; },
				commit: () => {
					if (options.sourceCommitFailure) throw new Error('source already exists');
				}, abort: () => undefined,
			}),
			deleteSource: async (sourceId: string) => {
				deletedSources.push(sourceId);
				if (options.deleteSourceFailure) throw options.deleteSourceFailure;
			},
			getMediaAssetMetadata: async () => options.existingBodyMetadata ?? null,
			loadMediaAsset: async () => options.existingBodyBytes ?? null,
			beginMediaAssetWrite: async () => ({ maximumChunkBytes: 1024,
				bytesWritten: 0, write: async () => undefined, commit: async () => ({}),
				abort: async () => { bodyAborts += 1; },
				commitOwned: options.bodyWriterMissingOwned ? undefined : async () => ({ metadata: {}, discardIfCurrent: async () => {
					discarded += 1;
					if (options.bodyDiscardFailure) throw options.bodyDiscardFailure;
					return true;
				} }),
			}),
		},
	});
	return { port, project, commands, deletedSources, get bytesWritten() { return bytesWritten; },
		get bodyAborts() { return bodyAborts; },
		get discarded() { return discarded; } };
}

const REVIEWED = Object.freeze({ audio: pcm16Wave([0, 100, -100, 0]),
	request: Object.freeze({ text: 'Hello\nworld.', language: 'a', voiceId: 'af_heart', speed: 1 }),
	modelId: 'kokoro-82m-v1.0', modelVersion: '1.0.0',
	artifactSha256s: Object.freeze(['a'.repeat(64)]),
});

test('reviewed speech publishes a new track at the playhead with script only in a private asset', async () => {
	const state = fixture();
	assert.equal(await state.port.loadInitial(), null);
	await state.port.accept(REVIEWED);
	assert.equal(state.commands.length, 1);
	const command = state.commands[0]!;
	assert.equal(command.type, 'assistance-asset/upsert');
	assert.equal(command.expectedReference, null);
	const edits = command.commands as readonly Record<string, unknown>[];
	assert.deepEqual(edits.map(({ type }) => type), ['source/add', 'track/add', 'clip/add']);
	assert.equal((edits[2]!.clip as { timelineStartFrame: number }).timelineStartFrame, 960);
	assert.equal((edits[2]!.clip as { durationFrames: number }).durationFrames, 8);
	assert.equal(state.bytesWritten, 16);
	assert.equal(JSON.stringify(command).includes('Hello'), false);
});

test('a rejected project edit rolls back both the persisted audio and private script', async () => {
	const state = fixture({ commitFailure: true });
	assert.equal(await state.port.loadInitial(), null);
	await assert.rejects(state.port.accept(REVIEWED), /commit refused/u);
	assert.equal(state.deletedSources.length, 1);
	assert.equal(state.discarded, 1);
});

test('speech publication reports both rollback failures without hiding the refused edit', async () => {
	const bodyFailure = new Error('body rollback failed');
	const sourceFailure = new Error('source rollback failed');
	const state = fixture({
		commitFailure: true,
		bodyDiscardFailure: bodyFailure,
		deleteSourceFailure: sourceFailure,
	});
	await state.port.loadInitial();

	await assert.rejects(state.port.accept(REVIEWED), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(String(error.cause), /commit refused/u);
		assert.deepEqual(error.errors.slice(1), [bodyFailure, sourceFailure]);
		return true;
	});
	assert.equal(state.discarded, 1);
	assert.equal(state.deletedSources.length, 1);
});

test('speech preflight rejects a changed project before writing any generated source', async () => {
	const state = fixture({ preflightChangesProject: true });
	await state.port.loadInitial();

	await assert.rejects(state.port.accept(REVIEWED), /project changed/u);
	assert.equal(state.bytesWritten, 0);
	assert.deepEqual(state.commands, []);
});

test('speech source rejects a writer that reports a different frame count', async () => {
	const state = fixture({ reportedFramesWritten: 3 });
	await state.port.loadInitial();

	await assert.rejects(state.port.accept(REVIEWED), /changed its frame count/u);
	assert.deepEqual(state.deletedSources, []);
	assert.deepEqual(state.commands, []);
});

test('speech rejects an invalid playhead before storing generated media', async () => {
	const state = fixture({ playheadFrame: -1 });
	await state.port.loadInitial();

	await assert.rejects(state.port.accept(REVIEWED), /playhead is invalid/u);
	assert.equal(state.bytesWritten, 0);
	assert.deepEqual(state.commands, []);
});

test('speech rejects empty audio and valid WAV with the wrong sample rate', async () => {
	const state = fixture();
	await state.port.loadInitial();
	await assert.rejects(state.port.accept({ ...REVIEWED, audio: new Blob() }), /invalid size/u);
	await assert.rejects(state.port.accept({
		...REVIEWED,
		audio: pcm16Wave([0, 100, -100, 0], 48_000),
	}), /24 kHz mono PCM WAV/u);
	assert.equal(state.bytesWritten, 0);
});

test('speech refuses a script writer without owned rollback authority', async () => {
	const state = fixture({ bodyWriterMissingOwned: true });
	await state.port.loadInitial();
	await assert.rejects(state.port.accept(REVIEWED), /lacks owned publication/u);
	assert.equal(state.bodyAborts, 1);
	assert.equal(state.deletedSources.length, 1);
	assert.deepEqual(state.commands, []);
});

test('a refused if-absent source write never deletes the existing source', async () => {
	const state = fixture({ sourceCommitFailure: true });
	await state.port.loadInitial();
	await assert.rejects(state.port.accept(REVIEWED), /source already exists/u);
	assert.deepEqual(state.deletedSources, []);
});

test('regenerating one of two clips sharing speech source retains the old script reference', async () => {
	const digest = 'b'.repeat(64);
	const prior = createAssistanceTtsScriptBodyPublicationV1({
		assetId: 'script-original', text: 'Original voice', language: 'a', voiceId: 'af_heart', speed: 1,
		source: { sourceId: 'source-original', sourceSha256: digest,
			sourceStartFrame: 0, sourceEndFrame: 4 },
		model: { modelId: REVIEWED.modelId, modelVersion: REVIEWED.modelVersion,
			artifactSha256s: REVIEWED.artifactSha256s },
		recipe: { id: 'kokoro-text-to-speech', version: 1 },
	});
	const project = { id: 'project-1', revision: 1, sampleRate: 48_000,
		primarySequenceId: 'sequence-1',
		sources: [{ id: 'source-original', contentSha256: digest, frameCount: 4, kind: 'audio' }],
		clips: [{ id: 'clip-selected', sourceId: 'source-original' },
			{ id: 'clip-peer', sourceId: 'source-original' }],
		tracks: [], assistanceAssets: [prior.reference] };
	const state = fixture({ project, selectedClipId: 'clip-selected',
		existingBodyBytes: prior.bytes });
	assert.equal((await state.port.loadInitial())?.text, 'Original voice');
	await state.port.accept(REVIEWED);
	const command = state.commands[0]!;
	assert.equal(command.expectedReference, null);
	assert.notEqual((command.reference as { id: string }).id, prior.reference.id);
	assert.deepEqual(project.assistanceAssets, [prior.reference]);
});

test('existing script bytes with incompatible metadata are refused before project commit', async () => {
	const digest = createHash('sha256').update(new Uint8Array(await REVIEWED.audio.arrayBuffer())).digest('hex');
	const publication = createAssistanceTtsScriptBodyPublicationV1({
		assetId: 'tts-script-2', text: REVIEWED.request.text,
		language: REVIEWED.request.language, voiceId: REVIEWED.request.voiceId,
		speed: REVIEWED.request.speed,
		source: { sourceId: 'tts-source-1', sourceSha256: digest,
			sourceStartFrame: 0, sourceEndFrame: 4 },
		model: { modelId: REVIEWED.modelId, modelVersion: REVIEWED.modelVersion,
			artifactSha256s: REVIEWED.artifactSha256s },
		recipe: { id: 'kokoro-text-to-speech', version: 1 },
	});
	const state = fixture({ existingBodyBytes: publication.bytes,
		existingBodyMetadata: { sourceId: publication.reference.body.storageKey,
			size: publication.bytes.byteLength, sha256: publication.reference.body.sha256,
			mimeType: publication.reference.body.mimeType, kind: 'not-a-script',
			encoding: 'canonical-json-v1' } });
	await state.port.loadInitial();
	await assert.rejects(state.port.accept(REVIEWED), /conflicting metadata/u);
	assert.deepEqual(state.commands, []);
});
