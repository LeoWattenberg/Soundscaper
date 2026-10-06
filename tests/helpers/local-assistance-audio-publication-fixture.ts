/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createLocalAssistanceAudioPublicationAcceptance } from '../../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-publication.ts';
import type { AssistanceSelectionFence } from '../../src/common/editor/assistance/proposal-session.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

export const SOURCE_SHA256 = 'ab'.repeat(32);
export const DEEPFILTER_ARTIFACTS = Object.freeze(['11'.repeat(32), '22'.repeat(32)]);
export const TIGER_ARTIFACTS = Object.freeze(['33'.repeat(32), '44'.repeat(32)]);
export const DEREVERB_ARTIFACTS = Object.freeze(['55'.repeat(32)]);

type DataRecord = Readonly<Record<string, unknown>>;

export function fence(revision = 7, sourceStartFrame = 12_000, sourceEndFrame = 12_004) {
	return Object.freeze({
		schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
		projectId: 'project-1', revision,
		sequenceId: 'main-sequence', occurrenceIds: Object.freeze(['dialogue-clip']),
		sourceId: 'dialogue-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame, sourceEndFrame,
		linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
	});
}

export function authority(revision = 7, options: Readonly<{
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
		id: 'project-1', schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
		revision, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', sources: Object.freeze([source]),
		clips: Object.freeze([clip]), tracks: Object.freeze([track]),
		projectBin: Object.freeze({ clips: Object.freeze([]) }),
		sequences: Object.freeze([Object.freeze({ id: 'main-sequence', trackIds: [track.id] })]),
	});
	return Object.freeze({ project, source, clip, track, startFrame, endFrame,
		sourceStartFrame, sourceEndFrame, fence: fence(revision, sourceStartFrame, sourceEndFrame) });
}

export async function wave(
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

export function model(operation: 'speech-enhancement' | 'dereverberation' | 'source-separation') {
	if (operation === 'dereverberation') {
		return Object.freeze({ modelId: 'dereverb-room', version: '1.0.0', task: operation,
			artifactSha256s: DEREVERB_ARTIFACTS });
	}
	return operation === 'speech-enhancement'
		? Object.freeze({ modelId: 'deepfilternet3', version: '3.0.0', task: operation,
			artifactSha256s: DEEPFILTER_ARTIFACTS })
		: Object.freeze({ modelId: 'tiger-dnr', version: '1.0.0', task: operation,
			artifactSha256s: TIGER_ARTIFACTS });
}

export async function output(
	operation: 'speech-enhancement' | 'dereverberation' | 'source-separation',
	slotId: 'enhanced-audio' | 'dereverberated-audio' | 'dialogue' | 'music' | 'effects',
	claimId: string,
	values: readonly (readonly number[])[],
) {
	const sampleRate = operation === 'speech-enhancement' ? 48_000 : 44_100;
	const role = operation === 'source-separation' ? 'separated-audio' : 'enhanced-audio';
	const result = await wave(sampleRate, values);
	return {
		slotId,
		claim: {
			claimVersion: 1, claimId, jobId: '9'.repeat(40),
			role,
			mediaType: 'audio/wav', byteLength: result.bytes.size, sha256: result.sha256,
		},
		review: {
			kind: 'audio-wave',
			role,
			sampleRate, channelCount: result.channelCount, frameCount: result.frameCount,
			sampleFormat: 'float32',
		},
		bytes: result.bytes,
	};
}

export async function request(
	operation: 'speech-enhancement' | 'dereverberation' | 'source-separation',
	selectionFence: AssistanceSelectionFence = fence(),
) {
	const outputs = operation === 'speech-enhancement'
		? [await output(operation, 'enhanced-audio', '1'.repeat(40), [[0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0]])]
		: operation === 'dereverberation'
			? [await output(operation, 'dereverberated-audio', '1'.repeat(40),
				[[0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0]])]
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

export class AudioStore {
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

export function harness(currentValue = authority()) {
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

