/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional acceptance of one reviewed local speech transcript. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1,
	type AssistanceAssetUpsertCommandV1,
} from '../assistance/assistance-asset-command-v1.ts';
import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	normalizeAssistanceAssetReferencesV1,
	type AssistanceAssetReferenceV1,
} from '../assistance/assistance-asset-reference-v1.ts';
import {
	createAssistanceProposalSession,
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	createAssistanceTranscriptBodyPublicationV1,
	type AssistanceSpeechRecognitionReviewV1,
} from '../assistance/transcript-body-publication-v1.ts';
import { MAX_TRANSCRIPT_LABEL_COMMANDS } from '../assistance/transcript-labels.ts';
import { createAddLabelTrackCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type {
	MediaAssetWriter,
	OwnedMediaAssetPublication,
} from '../storage/media-asset-write-contract.ts';

const RECIPE_ID = 'speech-transcript';
const RECIPE_VERSION = 1;
const ASSET_ID_PREFIX = 'assistance-transcript:';
const TRACK_ID_PREFIX = 'assistance-transcript-track:';
const TRACK_EXTENSION_KEY = 'org.soundscaper.assistance-transcript-v1';
const BODY_KIND = 'assistance-transcript';
const BODY_ENCODING = 'canonical-json-v1';
const MAXIMUM_WRITER_CHUNK_BYTES = 4 * 1024 * 1024;
const UTF8 = new TextEncoder();
const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const TRANSCRIPT_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.transcript+json',
]);

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface LocalAssistanceTranscriptAcceptanceAuthority {
	readonly project: Readonly<{
		readonly id: string;
		readonly schemaVersion: number;
		readonly revision: number;
		readonly sampleRate: number;
		readonly assistanceAssets?: readonly unknown[];
		readonly tracks: readonly Readonly<Record<string, unknown>>[];
	}>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceTranscriptAcceptanceStore {
	getMediaAssetMetadata(storageKey: string): Awaitable<unknown>;
	loadMediaAsset(storageKey: string): Awaitable<unknown>;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			expectedBytes: number;
			expectedSha256: string;
		}>,
	): Awaitable<MediaAssetWriter>;
}

export interface LocalAssistanceTranscriptAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceTranscriptAcceptanceAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly store: LocalAssistanceTranscriptAcceptanceStore;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
}

export interface LocalAssistanceTranscriptAcceptance {
	acceptValidatedResult(request: unknown): Promise<void>;
}

interface NormalizedAcceptanceRequest {
	readonly sourceId: string;
	readonly fence: AssistanceSelectionFence;
	readonly model: Readonly<{
		readonly modelId: string;
		readonly artifactSha256s: readonly string[];
	}>;
	readonly review: AssistanceSpeechRecognitionReviewV1;
}

interface NormalizedAuthority {
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly assistanceAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
}

/** Create the controller-owned acceptance port exposed to the renderer workflow. */
export function createLocalAssistanceTranscriptAcceptance(
	dependencies: LocalAssistanceTranscriptAcceptanceDependencies,
): Readonly<LocalAssistanceTranscriptAcceptance> {
	validateDependencies(dependencies);

	const acceptValidatedResult = async (value: unknown): Promise<void> => {
		const request = normalizeRequest(value);
		const initial = normalizeAuthority(dependencies.currentAuthority());
		if (!sameFence(request.fence, initial.fence)) throw new AssistanceProposalStaleError();
		const identityDigest = transcriptIdentityDigest(request.fence);
		const publication = createAssistanceTranscriptBodyPublicationV1({
			assetId: `${ASSET_ID_PREFIX}${identityDigest}`,
			review: request.review,
			selectedMedia: {
				selectionFence: request.fence,
				sampleRate: initial.sampleRate,
				sourceVideoTimingSha256: null,
			},
			model: request.model,
			recipe: { id: RECIPE_ID, version: RECIPE_VERSION },
		});
		const commands = createTranscriptLabelCommands(publication.body, publication.reference.id, initial);
		const expectedReference = initial.assistanceAssets.find(
			({ id }) => id === publication.reference.id,
		) ?? null;
		let ownedPublication: OwnedMediaAssetPublication | null = null;
		const proposalIds = commands.map((_command, index) => `transcript-command:${String(index)}`);
		const session = createAssistanceProposalSession({
			operation: 'speech-recognition',
			fence: request.fence,
			proposals: commands.map((command, index) => Object.freeze({
				id: proposalIds[index]!, kind: 'transcript-label-command',
				command: command as unknown as Readonly<Record<string, unknown>>,
			})),
			assistanceAssets: Object.freeze([publication.reference]),
			currentFence: () => normalizeAuthority(dependencies.currentAuthority()).fence,
			commit: (batch) => {
				if (batch.commands.length !== commands.length
					|| !same(batch.commands, commands)
					|| batch.assistanceAssets.length !== 1
					|| !same(batch.assistanceAssets[0], publication.reference)) {
					throw new Error('The accepted transcript proposal batch changed before commit.');
				}
				const token = dependencies.captureProject();
				const current = normalizeAuthority(dependencies.currentAuthority());
				if (!sameFence(request.fence, current.fence)) throw new AssistanceProposalStaleError();
				const currentReference = current.assistanceAssets.find(
					({ id }) => id === publication.reference.id,
				) ?? null;
				if (!same(currentReference, expectedReference)) throw new AssistanceProposalStaleError();
				dependencies.assertProject(token);
				if (same(currentReference, publication.reference)) {
					dependencies.commit(compoundOrdinaryCommand(commands));
					return;
				}
				const command: Readonly<AssistanceAssetUpsertCommandV1> = Object.freeze({
					type: ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1,
					expectedReference: currentReference,
					reference: publication.reference,
					commands,
				});
				dependencies.commit(command as unknown as Readonly<Record<string, unknown>>);
			},
			discardStaged: async () => {
				if (ownedPublication) await ownedPublication.discardIfCurrent();
			},
		});
		ownedPublication = await publishTranscriptBody(dependencies.store, publication);
		await session.accept(proposalIds);
	};

	return Object.freeze({ acceptValidatedResult });
}

function normalizeRequest(value: unknown): NormalizedAcceptanceRequest {
	const request = exactRecord(value, [
		'sourceId', 'operation', 'selectionFence', 'model', 'outputs',
	], 'local-assistance acceptance request');
	if (request.operation !== 'speech-recognition') {
		throw new RangeError('Only reviewed speech recognition can be accepted as a transcript.');
	}
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	const sourceId = stableId(request.sourceId, 'local-assistance source ID');
	if (sourceId !== fence.sourceId) {
		throw new Error('The reviewed transcript source disagrees with its selection fence.');
	}
	const model = normalizeModel(request.model);
	const outputs = array(request.outputs, 1, 1, 'local-assistance accepted outputs');
	const output = exactRecord(outputs[0], ['claim', 'review'], 'local-assistance accepted output');
	normalizeTranscriptClaim(output.claim);
	return Object.freeze({
		sourceId,
		fence,
		model,
		review: output.review as AssistanceSpeechRecognitionReviewV1,
	});
}

function normalizeModel(value: unknown): NormalizedAcceptanceRequest['model'] {
	const model = exactRecord(value, [
		'modelId', 'version', 'task', 'artifactSha256s',
	], 'local-assistance accepted model');
	if (model.task !== 'speech-recognition') {
		throw new RangeError('Transcript acceptance requires a speech-recognition model.');
	}
	const modelId = String(model.modelId);
	if (!MODEL_ID.test(modelId)) throw new TypeError('The accepted transcript model ID is invalid.');
	boundedText(model.version, 160, 'accepted transcript model version');
	const artifacts = array(
		model.artifactSha256s,
		1,
		ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumModelArtifacts,
		'accepted transcript model artifacts',
	).map((candidate) => digest(candidate, 'accepted transcript model artifact')).sort();
	if (artifacts.some((candidate, index) => index > 0 && candidate === artifacts[index - 1])) {
		throw new RangeError('Accepted transcript model artifact digests must be unique.');
	}
	return Object.freeze({ modelId, artifactSha256s: Object.freeze(artifacts) });
}

function normalizeTranscriptClaim(value: unknown): void {
	const claim = exactRecord(value, [
		'claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256',
	], 'accepted transcript output claim');
	if (claim.claimVersion !== 1 || claim.role !== 'transcript'
		|| typeof claim.mediaType !== 'string' || !TRANSCRIPT_MEDIA_TYPES.has(claim.mediaType)
		|| !JOB_ID.test(String(claim.claimId)) || !JOB_ID.test(String(claim.jobId))
		|| !Number.isSafeInteger(claim.byteLength) || Number(claim.byteLength) < 1
		|| Number(claim.byteLength) > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes
		|| !SHA256.test(String(claim.sha256))) {
		throw new TypeError('The accepted transcript output claim is invalid.');
	}
}

function normalizeAuthority(value: LocalAssistanceTranscriptAcceptanceAuthority): NormalizedAuthority {
	if (!value || typeof value !== 'object' || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Transcript acceptance requires selected-media authority.');
	}
	const fence = validateAssistanceSelectionFence(value.fence);
	if (value.project.id !== fence.projectId || value.project.schemaVersion !== fence.schemaVersion
		|| value.project.revision !== fence.revision) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = positiveInteger(value.project.sampleRate, 'selected project sample rate');
	const timelineStartFrame = frame(value.startFrame, 'selected timeline start');
	const timelineEndFrame = frame(value.endFrame, 'selected timeline end');
	const sourceStartFrame = frame(value.sourceStartFrame, 'selected source start');
	const sourceEndFrame = frame(value.sourceEndFrame, 'selected source end');
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| timelineEndFrame - timelineStartFrame !== sourceEndFrame - sourceStartFrame
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	if (!Array.isArray(value.project.tracks)) {
		throw new TypeError('Transcript acceptance requires the selected project track inventory.');
	}
	return Object.freeze({
		fence,
		sampleRate,
		timelineStartFrame,
		timelineEndFrame,
		sourceStartFrame,
		sourceEndFrame,
		assistanceAssets: normalizeAssistanceAssetReferencesV1(value.project.assistanceAssets ?? []),
		tracks: Object.freeze([...value.project.tracks]),
	});
}

function createTranscriptLabelCommands(
	transcript: ReturnType<typeof createAssistanceTranscriptBodyPublicationV1>['body'],
	assetId: string,
	authority: NormalizedAuthority,
): readonly AudioEditorCommand[] {
	if (transcript.segments.length < 1) {
		throw new RangeError('An empty reviewed transcript cannot author a caption proposal.');
	}
	if (transcript.segments.length > MAX_TRANSCRIPT_LABEL_COMMANDS) {
		throw new RangeError('A reviewed transcript exceeds the accepted label ceiling.');
	}
	const digestValue = assetId.slice(ASSET_ID_PREFIX.length);
	const trackId = `${TRACK_ID_PREFIX}${digestValue}`;
	const labels = transcript.segments.map((segment, index) => Object.freeze({
		id: `${trackId}:segment:${String(index)}`,
		title: segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text,
		startFrame: projectFrame(segment.startFrame, authority),
		endFrame: projectFrame(segment.endFrame, authority),
	}));
	const add = createAddLabelTrackCommand({
		id: trackId,
		name: 'Transcript',
		labels,
		opaqueExtensions: {
			[TRACK_EXTENSION_KEY]: { schemaVersion: 1, assetId },
		},
	});
	const existing = authority.tracks.find((track) => track.id === trackId);
	if (!existing) return Object.freeze([add]);
	if (existing.type !== 'label' || !ownedTranscriptTrack(existing, assetId)) {
		throw new Error(`Transcript acceptance track identity ${trackId} is already owned by another edit.`);
	}
	return Object.freeze([Object.freeze({ type: 'track/remove' as const, trackId }), add]);
}

function projectFrame(sourceFrame: number, authority: NormalizedAuthority): number {
	const result = authority.timelineStartFrame + (sourceFrame - authority.sourceStartFrame);
	if (!Number.isSafeInteger(result) || result < authority.timelineStartFrame
		|| result > authority.timelineEndFrame) {
		throw new RangeError('A transcript segment exceeds its accepted timeline occurrence.');
	}
	return result;
}

function ownedTranscriptTrack(track: Readonly<Record<string, unknown>>, assetId: string): boolean {
	const extensions = dataRecord(track.opaqueExtensions);
	const extension = dataRecord(extensions?.[TRACK_EXTENSION_KEY]);
	return extension?.schemaVersion === 1 && extension.assetId === assetId
		&& Object.keys(extension).length === 2;
}

async function publishTranscriptBody(
	store: LocalAssistanceTranscriptAcceptanceStore,
	publication: ReturnType<typeof createAssistanceTranscriptBodyPublicationV1>,
): Promise<OwnedMediaAssetPublication | null> {
	const { body } = publication.reference;
	const existing = await store.getMediaAssetMetadata(body.storageKey);
	if (existing !== null && existing !== undefined) {
		await verifyStoredBody(store, publication, existing);
		return null;
	}
	let writer: MediaAssetWriter;
	try {
		writer = await store.beginMediaAssetWrite(body.storageKey, {
			name: `Transcript ${publication.reference.id}`,
			kind: BODY_KIND,
			encoding: BODY_ENCODING,
			mimeType: body.mimeType,
		}, { expectedBytes: body.byteLength, expectedSha256: body.sha256 });
	} catch (error) {
		const raced = await store.getMediaAssetMetadata(body.storageKey);
		if (raced === null || raced === undefined) throw error;
		await verifyStoredBody(store, publication, raced);
		return null;
	}
	if (!writer || typeof writer.write !== 'function' || typeof writer.abort !== 'function'
		|| typeof writer.commitOwned !== 'function'
		|| !Number.isSafeInteger(writer.maximumChunkBytes) || writer.maximumChunkBytes < 1
		|| writer.maximumChunkBytes > MAXIMUM_WRITER_CHUNK_BYTES) {
		await writer?.abort?.().catch(() => undefined);
		throw new TypeError('Transcript publication requires a bounded owned media writer.');
	}
	let owned: OwnedMediaAssetPublication | null = null;
	try {
		for (let offset = 0; offset < publication.bytes.byteLength; offset += writer.maximumChunkBytes) {
			await writer.write(publication.bytes.subarray(offset, offset + writer.maximumChunkBytes));
		}
		owned = await writer.commitOwned();
		if (!owned || typeof owned.discardIfCurrent !== 'function') {
			throw new TypeError('Transcript publication did not return owned rollback authority.');
		}
		assertStoredMetadata(owned.metadata, publication);
		return owned;
	} catch (error) {
		try {
			if (owned) await owned.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Transcript publication and cleanup both failed.');
		}
		throw error;
	}
}

async function verifyStoredBody(
	store: LocalAssistanceTranscriptAcceptanceStore,
	publication: ReturnType<typeof createAssistanceTranscriptBodyPublicationV1>,
	metadata: unknown,
): Promise<void> {
	assertStoredMetadata(metadata, publication);
	const loaded = await store.loadMediaAsset(publication.reference.body.storageKey);
	const bytes = await storedBytes(loaded);
	if (bytes.byteLength !== publication.bytes.byteLength
		|| bytes.some((byte, index) => byte !== publication.bytes[index])) {
		throw new Error('The stored assistance transcript body conflicts with its content address.');
	}
}

function assertStoredMetadata(
	value: unknown,
	publication: ReturnType<typeof createAssistanceTranscriptBodyPublicationV1>,
): void {
	const metadata = dataRecord(value);
	const body = publication.reference.body;
	if (!metadata || metadata.sourceId !== body.storageKey
		|| metadata.size !== body.byteLength || metadata.sha256 !== body.sha256
		|| metadata.mimeType !== body.mimeType || metadata.kind !== BODY_KIND
		|| metadata.encoding !== BODY_ENCODING) {
		throw new Error('The stored assistance transcript metadata conflicts with its reference.');
	}
}

async function storedBytes(value: unknown): Promise<Uint8Array> {
	if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
	if (value instanceof Uint8Array && !(value.buffer instanceof SharedArrayBuffer)) {
		return Uint8Array.from(value);
	}
	throw new TypeError('Assistance transcript storage returned no immutable body.');
}

function transcriptIdentityDigest(fence: AssistanceSelectionFence): string {
	return bytesToHex(sha256(UTF8.encode(JSON.stringify({
		sourceId: fence.sourceId,
		sourceSha256: fence.sourceSha256,
		sourceStartFrame: fence.sourceStartFrame,
		sourceEndFrame: fence.sourceEndFrame,
		recipeId: RECIPE_ID,
		recipeVersion: RECIPE_VERSION,
	}))));
}

function compoundOrdinaryCommand(commands: readonly AudioEditorCommand[]): Readonly<Record<string, unknown>> {
	return commands.length === 1
		? commands[0]! as unknown as Readonly<Record<string, unknown>>
		: Object.freeze({ type: 'batch', commands });
}

function validateDependencies(value: LocalAssistanceTranscriptAcceptanceDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function' || !value.store || typeof value.store !== 'object'
		|| typeof value.store.getMediaAssetMetadata !== 'function'
		|| typeof value.store.loadMediaAsset !== 'function'
		|| typeof value.store.beginMediaAssetWrite !== 'function') {
		throw new TypeError('Transcript acceptance requires exact controller and storage ports.');
	}
}

function sameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): boolean {
	return same(left, right);
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	const record = dataRecord(value);
	if (!record) throw new TypeError(`The ${label} must be a plain record.`);
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record;
}

function dataRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) return null;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null
		? value as Record<string, unknown> : null;
}

function array(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new RangeError(`The ${label} inventory is invalid.`);
	}
	return value;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`The ${label} is invalid.`);
	return Number(value);
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The ${label} is invalid.`);
	return Number(value);
}
