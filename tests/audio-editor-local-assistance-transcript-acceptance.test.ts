/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceTranscriptAcceptance,
} from '../src/common/editor/controller/local-assistance-transcript-acceptance.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);
const DIARIZER_SHA256 = '56'.repeat(32);
const EMBEDDING_SHA256 = '78'.repeat(32);
const CLAIM_SHA256 = '34'.repeat(32);

interface TestTranscriptReference {
	readonly id: string;
	readonly sourceId: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly body: Readonly<{ readonly storageKey: string; readonly sha256: string }>;
}

interface TestLabelTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly labels: readonly Readonly<Record<string, unknown>>[];
}

type TestProjectCommand = Readonly<{
	type: 'track/add';
	track: TestLabelTrack;
}> | Readonly<{
	type: 'track/remove';
	trackId: string;
}>;

interface TestAcceptanceCommand {
	readonly type: string;
	readonly expectedReference: TestTranscriptReference | null;
	readonly reference: TestTranscriptReference;
	readonly commands: readonly TestProjectCommand[];
}

function fence(revision = 4) {
	return Object.freeze({
		schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
		projectId: 'project-1', revision,
		sequenceId: 'main-sequence', occurrenceIds: Object.freeze(['voice-clip']),
		sourceId: 'voice-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 36_000, sourceEndFrame: 84_000,
		linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
	});
}

function authority(
	revision = 4,
	assistanceAssets: readonly unknown[] = [],
	tracks: readonly Readonly<Record<string, unknown>>[] = [],
) {
	return Object.freeze({
		project: Object.freeze({
			id: 'project-1', schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
			revision, sampleRate: 48_000,
			assistanceAssets: Object.freeze([...assistanceAssets]),
			tracks: Object.freeze([...tracks]),
		}),
		source: Object.freeze({ id: 'voice-source' }),
		clip: Object.freeze({ id: 'voice-clip' }),
		track: Object.freeze({ id: 'voice-track' }),
		startFrame: 48_000, endFrame: 96_000,
		sourceStartFrame: 36_000, sourceEndFrame: 84_000,
		fence: fence(revision),
	});
}

function request(selectionFence = fence(), text = 'Hello there') {
	return Object.freeze({
		sourceId: 'voice-source', operation: 'speech-recognition', selectionFence,
		models: Object.freeze([Object.freeze({
			modelId: 'parakeet-tdt-0.6b-v3', version: '1', task: 'speech-recognition',
			artifactSha256s: Object.freeze([MODEL_SHA256]),
		})]),
		outputs: Object.freeze([Object.freeze({
			claim: Object.freeze({
				claimVersion: 1, claimId: 'a'.repeat(40), jobId: 'b'.repeat(40),
				role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
				byteLength: 128, sha256: CLAIM_SHA256,
			}),
			review: Object.freeze({
				kind: 'transcript', language: 'en',
				segments: Object.freeze([Object.freeze({
					startSeconds: 0.25, endSeconds: 0.75, text,
					words: Object.freeze([Object.freeze({
						text: text.split(' ')[0], startSeconds: 0.25,
						endSeconds: 0.5, confidence: 0.9,
					})]),
					speaker: 'Speaker 1',
				})]),
			}),
		})]),
	});
}

function attributedRequest(selectionFence = fence(), text = 'Hello there') {
	const speech = request(selectionFence, text);
	const output = speech.outputs[0]!;
	return Object.freeze({
		...speech,
		operation: 'speaker-diarization',
		models: Object.freeze([
			Object.freeze({ modelId: 'sherpa-pyannote-segmentation-3.0', version: '1',
				task: 'speaker-segmentation', artifactSha256s: Object.freeze([DIARIZER_SHA256]) }),
			Object.freeze({ modelId: 'sherpa-eres2net-base', version: '1',
				task: 'speaker-embedding', artifactSha256s: Object.freeze([EMBEDDING_SHA256]) }),
		]),
		outputs: Object.freeze([Object.freeze({
			...output,
			review: Object.freeze({ ...output.review,
				segments: Object.freeze(output.review.segments.map((segment) => Object.freeze({
					...segment, speaker: 'Speaker 2',
				}))),
			}),
		})]),
	});
}

class TranscriptStore {
	readonly bodies = new Map<string, Blob>();
	readonly metadata = new Map<string, Readonly<Record<string, unknown>>>();
	beginCount = 0;
	discardCount = 0;
	onCommit: (() => void) | null = null;

	getMediaAssetMetadata(key: string) {
		return Promise.resolve(this.metadata.get(key) ?? null);
	}

	loadMediaAsset(key: string) {
		return Promise.resolve(this.bodies.get(key) ?? null);
	}

	beginMediaAssetWrite(
		key: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string }>,
	) {
		this.beginCount += 1;
		const chunks: Uint8Array[] = [];
		let bytesWritten = 0;
		let aborted = false;
		return Promise.resolve({
			maximumChunkBytes: 64,
			get bytesWritten() { return bytesWritten; },
			write: (bytes: Uint8Array) => {
				if (aborted) throw new Error('writer aborted');
				chunks.push(Uint8Array.from(bytes));
				bytesWritten += bytes.byteLength;
				return Promise.resolve();
			},
			commitOwned: () => {
				const bytes = new Uint8Array(bytesWritten);
				let offset = 0;
				for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
				assert.equal(bytes.byteLength, options.expectedBytes);
				const record = Object.freeze({
					...metadata, sourceId: key, size: bytes.byteLength, sha256: options.expectedSha256,
				});
				const body = new Blob([bytes], { type: String(metadata.mimeType ?? '') });
				this.bodies.set(key, body);
				this.metadata.set(key, record);
				this.onCommit?.();
				return Promise.resolve(Object.freeze({
					metadata: record,
					discardIfCurrent: () => {
						this.discardCount += 1;
						if (this.bodies.get(key) !== body) return Promise.resolve(false);
						this.bodies.delete(key);
						this.metadata.delete(key);
						return Promise.resolve(true);
					},
				}));
			},
			commit: () => Promise.resolve(Object.freeze({})),
			abort: () => { aborted = true; return Promise.resolve(); },
		});
	}
}

test('reviewed speech acceptance publishes one authenticated body and timeline label batch', async () => {
	const store = new TranscriptStore();
	const current = authority();
	const commands: Readonly<Record<string, unknown>>[] = [];
	const acceptance = createLocalAssistanceTranscriptAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: (token) => { assert.equal(token, current.fence); },
		store,
		commit: (command) => { commands.push(command); },
	});

	await acceptance.acceptValidatedResult(request());

	assert.equal(commands.length, 1);
	const command = commands[0] as unknown as TestAcceptanceCommand;
	assert.equal(command.type, 'assistance-asset/upsert');
	assert.equal(command.expectedReference, null);
	assert.equal(command.reference.sourceId, 'voice-source');
	assert.equal(command.reference.sourceStartFrame, 36_000);
	assert.equal(command.reference.sourceEndFrame, 84_000);
	assert.match(command.reference.id, /^assistance-transcript:[a-f0-9]{64}$/u);
	assert.equal(command.commands.length, 1);
	const added = command.commands[0];
	assert.equal(added?.type, 'track/add');
	assert.ok(added?.type === 'track/add');
	assert.equal(added.track.type, 'label');
	assert.equal(added.track.labels.length, 1);
	assert.deepEqual(added.track.labels[0], {
		id: `${added.track.id}:segment:0`,
		title: 'Speaker 1: Hello there', startFrame: 60_000, endFrame: 84_000,
		color: 'auto', opaqueExtensions: {}, anchor: 'sample', startBeat: null, endBeat: null,
	});
	const body = store.bodies.get(command.reference.body.storageKey);
	assert.ok(body);
	assert.equal(store.metadata.get(command.reference.body.storageKey)?.kind, 'assistance-transcript');
	assert.equal(store.metadata.get(command.reference.body.storageKey)?.encoding, 'canonical-json-v1');
	const transcript = JSON.parse(await body.text()) as Readonly<{
		segments: readonly Readonly<{ startFrame: number; endFrame: number }>[];
	}>;
	assert.equal(transcript.segments[0]?.startFrame, 48_000);
	assert.equal(transcript.segments[0]?.endFrame, 72_000);
	assert.equal(store.beginCount, 1);
	assert.equal(store.discardCount, 0);
	assert.equal(current.project.revision, 4);
});

test('stale authority and commit failure roll back only a newly owned transcript body', async () => {
	for (const failure of ['stale', 'commit'] as const) {
		const store = new TranscriptStore();
		let current = authority();
		if (failure === 'stale') store.onCommit = () => { current = authority(5); };
		const acceptance = createLocalAssistanceTranscriptAcceptance({
			currentAuthority: () => current,
			captureProject: () => current.fence,
			assertProject: () => undefined,
			store,
			commit: () => {
				if (failure === 'commit') throw new Error('commit refused');
			},
		});
		await assert.rejects(
			acceptance.acceptValidatedResult(request()),
			failure === 'stale' ? /no longer matches/iu : /commit refused/iu,
		);
		assert.equal(store.bodies.size, 0, failure);
		assert.equal(store.discardCount, 1, failure);
	}
});

test('an existing identical content-addressed body is verified and never claimed for rollback', async () => {
	const store = new TranscriptStore();
	const current = authority();
	let failCommit = false;
	const acceptance = createLocalAssistanceTranscriptAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		store,
		commit: () => { if (failCommit) throw new Error('second commit refused'); },
	});
	await acceptance.acceptValidatedResult(request());
	const [storageKey] = store.bodies.keys();
	assert.ok(storageKey);
	failCommit = true;
	await assert.rejects(acceptance.acceptValidatedResult(request()), /second commit refused/iu);
	assert.equal(store.beginCount, 1);
	assert.equal(store.discardCount, 0);
	assert.equal(store.bodies.has(storageKey), true);
});

test('a rerun replaces its stable reference and owned label track through one compound command', async () => {
	const store = new TranscriptStore();
	let current = authority();
	const committed: TestAcceptanceCommand[] = [];
	const acceptance = createLocalAssistanceTranscriptAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		store,
		commit: (value) => {
			const command = value as unknown as TestAcceptanceCommand;
			committed.push(command);
			const added = command.commands.find((candidate) => (
				candidate.type === 'track/add'
			));
			assert.ok(added?.type === 'track/add');
			current = authority(current.project.revision + 1, [command.reference], [added.track]);
		},
	});
	await acceptance.acceptValidatedResult(request());
	const first = committed[0]!;
	await acceptance.acceptValidatedResult(request(current.fence, 'Changed words'));
	const second = committed[1]!;
	assert.equal(second.reference.id, first.reference.id);
	assert.notEqual(second.reference.body.sha256, first.reference.body.sha256);
	assert.deepEqual(second.expectedReference, first.reference);
	assert.deepEqual(second.commands.map(({ type }) => type), [
		'track/remove', 'track/add',
	]);
	const firstAdd = first.commands[0];
	const secondAdd = second.commands[1];
	assert.ok(firstAdd?.type === 'track/add');
	assert.ok(secondAdd?.type === 'track/add');
	assert.equal(secondAdd.track.id, firstAdd.track.id);
	assert.equal(secondAdd.track.labels[0]?.title, 'Speaker 1: Changed words');
});

test('speaker attribution replaces the same transcript body and owned caption track atomically', async () => {
	const store = new TranscriptStore();
	let current = authority();
	const committed: TestAcceptanceCommand[] = [];
	const acceptance = createLocalAssistanceTranscriptAcceptance({
		currentAuthority: () => current,
		captureProject: () => current.fence,
		assertProject: () => undefined,
		store,
		commit: (value) => {
			const command = value as unknown as TestAcceptanceCommand;
			committed.push(command);
			const added = command.commands.find(({ type }) => type === 'track/add');
			assert.ok(added?.type === 'track/add');
			current = authority(current.project.revision + 1, [command.reference], [added.track]);
		},
	});
	await acceptance.acceptValidatedResult(request());
	await acceptance.acceptValidatedResult(attributedRequest(current.fence));

	const [speech, attributed] = committed;
	assert.ok(speech && attributed);
	assert.equal(attributed.reference.id, speech.reference.id,
		'speaker attribution replaces the same digest-bound transcript identity');
	assert.deepEqual(attributed.commands.map(({ type }) => type), ['track/remove', 'track/add']);
	const add = attributed.commands[1];
	assert.ok(add?.type === 'track/add');
	assert.equal(add.track.labels[0]?.title, 'Speaker 2: Hello there');
	assert.deepEqual((attributed.reference as unknown as Readonly<{
		modelArtifactSha256s: readonly string[];
	}>).modelArtifactSha256s, [DIARIZER_SHA256, EMBEDDING_SHA256].sort());
});
