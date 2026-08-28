/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated stored-transcript inputs for indexing and transient editorial generation. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createAssistanceAssetReferenceV1,
	type AssistanceTranscriptAssetReferenceV1,
} from '../assistance/assistance-asset-reference-v1.ts';
import {
	createAssistanceEditorialGenerationPlanV1,
	type AssistanceEditorialFieldV1,
} from '../assistance/editorial-generation-v1.ts';
import { reviewOwnedAssistanceTranscriptV1 } from
	'../assistance/owned-transform-validation-v1.ts';

const EDITORIAL_CONTEXT_MEDIA_TYPE =
	'application/vnd.soundscaper.editorial-context+json';
const TRANSCRIPT_MEDIA_TYPE = 'application/vnd.soundscaper.transcript+json';
const MAXIMUM_EDITORIAL_EXCERPT_CHARACTERS = 8_192;

export interface LocalAssistanceGuidedPrimitiveFence {
	readonly projectId: string;
	readonly schemaFamily: 'soundscaper' | 'framescaper';
	readonly schemaVersion: 1;
	readonly revision: number;
	readonly sequenceId: string;
	readonly occurrenceIds: readonly string[];
	readonly sourceId: string;
	readonly sourceSha256: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly linkMembershipSha256: string;
	readonly timingAuthoritySha256: string;
}

export interface LocalAssistanceGuidedTranscriptInventorySource {
	readonly sourceId: string;
	readonly mediaKind: string;
}

export interface LocalAssistanceGuidedExternalInput {
	readonly mediaType: string;
	readonly bytes: Blob;
	readonly fence: LocalAssistanceGuidedPrimitiveFence;
}

export interface LocalAssistanceGuidedTranscriptContextOptions {
	readonly project: Readonly<Record<string, unknown>>;
	readonly inventory: readonly LocalAssistanceGuidedTranscriptInventorySource[];
	readonly fence: LocalAssistanceGuidedPrimitiveFence;
	readonly loadTranscriptBody?: (
		storageKey: string,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
	readonly editorialFields?: readonly AssistanceEditorialFieldV1[];
	readonly signal: AbortSignal;
}

export async function prepareLocalAssistanceGuidedTranscriptInput(
	options: LocalAssistanceGuidedTranscriptContextOptions,
): Promise<LocalAssistanceGuidedExternalInput | null> {
	const loaded = await loadSelectedTranscript(options);
	if (!loaded) return null;
	return Object.freeze({ mediaType: TRANSCRIPT_MEDIA_TYPE,
		bytes: new Blob([loaded.bytes], { type: TRANSCRIPT_MEDIA_TYPE }), fence: options.fence });
}

export async function prepareLocalAssistanceGuidedEditorialContext(
	options: LocalAssistanceGuidedTranscriptContextOptions,
): Promise<LocalAssistanceGuidedExternalInput | null> {
	const loaded = await loadSelectedTranscript(options);
	if (!loaded) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(loaded.bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The selected transcript body is not canonical UTF-8 JSON.', { cause: error });
	}
	const transcript = reviewOwnedAssistanceTranscriptV1(parsed);
	if (transcript.sourceId !== options.fence.sourceId) {
		throw new Error('The selected transcript body changed its authenticated source identity.');
	}
	const excerpt = boundedExcerpt(transcript.segments.filter(({ startFrame, endFrame }) =>
		Math.max(startFrame, options.fence.sourceStartFrame)
			< Math.min(endFrame, options.fence.sourceEndFrame)).map(({ text }) => text));
	if (excerpt === null) return null;
	const candidateId = `selection:${options.fence.sourceSha256.slice(0, 24)}`;
	const plan = createAssistanceEditorialGenerationPlanV1([Object.freeze({
		candidateId, evidenceMode: 'transcript', transcriptExcerpt: excerpt, visualSummary: null,
	})], options.editorialFields);
	const bytes = new TextEncoder().encode(JSON.stringify(plan));
	return Object.freeze({ mediaType: EDITORIAL_CONTEXT_MEDIA_TYPE,
		bytes: new Blob([bytes], { type: EDITORIAL_CONTEXT_MEDIA_TYPE }), fence: options.fence });
}

async function loadSelectedTranscript(
	options: LocalAssistanceGuidedTranscriptContextOptions,
): Promise<Readonly<{ readonly bytes: Uint8Array<ArrayBuffer> }> | null> {
	if (!options.loadTranscriptBody) return null;
	options.signal.throwIfAborted();
	const selectedSources = options.inventory.filter(({ sourceId }) => sourceId === options.fence.sourceId);
	if (selectedSources.length !== 1) return null;
	const mediaKind = selectedSources[0]!.mediaKind;
	const references = recordArray(options.project.assistanceAssets)
		.map(createAssistanceAssetReferenceV1)
		.filter((reference): reference is AssistanceTranscriptAssetReferenceV1 => (
			reference.kind === 'transcript-v1' && reference.sourceId === options.fence.sourceId
			&& reference.sourceSha256 === options.fence.sourceSha256
			&& reference.sourceStartFrame <= options.fence.sourceStartFrame
			&& reference.sourceEndFrame >= options.fence.sourceEndFrame
			&& (mediaKind === 'video'
				? reference.sourceVideoTimingSha256 === options.fence.timingAuthoritySha256
				: reference.sourceVideoTimingSha256 === null)
		));
	if (references.length !== 1) return null;
	const reference = references[0]!;
	const loaded = await options.loadTranscriptBody(reference.body.storageKey, options.signal);
	options.signal.throwIfAborted();
	if (loaded === null || loaded === undefined) return null;
	const bytes = await immutableBytes(loaded);
	if (bytes.byteLength !== reference.body.byteLength
		|| bytesToHex(sha256(bytes)) !== reference.body.sha256) {
		throw new Error('The selected transcript body changed after project admission.');
	}
	return Object.freeze({ bytes });
}

async function immutableBytes(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
	if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
	if (value instanceof Uint8Array && !(value.buffer instanceof SharedArrayBuffer)) {
		return Uint8Array.from(value);
	}
	throw new TypeError('Assistance transcript storage returned no immutable body.');
}

function boundedExcerpt(values: readonly string[]): string | null {
	const joined = values.map((value) => value.trim()).filter(Boolean).join(' ').trim();
	if (joined === '') return null;
	const characters = [...joined];
	return characters.length <= MAXIMUM_EDITORIAL_EXCERPT_CHARACTERS
		? joined : characters.slice(0, MAXIMUM_EDITORIAL_EXCERPT_CHARACTERS).join('').trim();
}

function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}
