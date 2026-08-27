/* SPDX-License-Identifier: AGPL-3.0-only */

/** Private renderer review authority captured before an aggregate workflow begins. */

export interface AssistanceWorkflowAudioReviewAuthorityV1 {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

export interface AssistanceWorkflowReviewMediaV1 {
	/** Ephemeral adapter-owned input used only for mutation-free audition. */
	readonly audio: AssistanceWorkflowReviewMediaAssetV1 | null;
	/** Ephemeral authenticated original used only for transport preview. */
	readonly video: AssistanceWorkflowReviewMediaAssetV1 | null;
}

export interface AssistanceWorkflowReviewMediaAssetV1 {
	readonly stageId: string;
	readonly slotId: string;
	/** Exact external input-custody claim staged from this body. */
	readonly claimId: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly body: Blob;
}

export interface AssistanceWorkflowReviewAuthorityV1 {
	readonly reviewAuthorityVersion: 1;
	readonly audioWave: AssistanceWorkflowAudioReviewAuthorityV1 | null;
	readonly editorialCandidateIds: readonly string[] | null;
	/** Exact staged highlight-video signals retained only for transient source-time review. */
	readonly highlightVideoSignals: AssistanceWorkflowReviewMediaAssetV1 | null;
	readonly media: AssistanceWorkflowReviewMediaV1;
}

const AUTHORITY_FIELDS = Object.freeze([
	'reviewAuthorityVersion', 'audioWave', 'editorialCandidateIds', 'highlightVideoSignals', 'media',
]);
const AUDIO_FIELDS = Object.freeze(['sampleRate', 'channelCount', 'frameCount']);
const MEDIA_FIELDS = Object.freeze(['audio', 'video']);
const MEDIA_ASSET_FIELDS = Object.freeze([
	'stageId', 'slotId', 'claimId', 'mediaType', 'byteLength', 'sha256', 'body',
]);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SLOT_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const CLAIM_ID = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;

export function createEmptyAssistanceWorkflowReviewAuthorityV1(): AssistanceWorkflowReviewAuthorityV1 {
	return Object.freeze({ reviewAuthorityVersion: 1, audioWave: null, editorialCandidateIds: null,
		highlightVideoSignals: null, media: Object.freeze({ audio: null, video: null }) });
}

export function validateAssistanceWorkflowReviewAuthorityV1(
	value: unknown,
): AssistanceWorkflowReviewAuthorityV1 {
	const row = exactRecord(value, AUTHORITY_FIELDS, 'workflow review authority');
	if (row.reviewAuthorityVersion !== 1) {
		throw new TypeError('The workflow review authority version is unsupported.');
	}
	const audioWave = row.audioWave === null ? null : audioAuthority(row.audioWave);
	let editorialCandidateIds: readonly string[] | null = null;
	if (row.editorialCandidateIds !== null) {
		if (!Array.isArray(row.editorialCandidateIds) || row.editorialCandidateIds.length > 1_000) {
			throw new RangeError('Workflow editorial candidate authority is invalid.');
		}
		const ids = row.editorialCandidateIds.map((candidate) => {
			if (typeof candidate !== 'string' || !ID.test(candidate)) {
				throw new TypeError('A workflow editorial candidate identity is invalid.');
			}
			return candidate;
		});
		if (new Set(ids).size !== ids.length) {
			throw new TypeError('Workflow editorial candidate identities must be unique.');
		}
		editorialCandidateIds = Object.freeze(ids);
	}
	const media = reviewMedia(row.media);
	const highlightVideoSignals = mediaAsset(row.highlightVideoSignals,
		'application/vnd.soundscaper.highlight-video-signals+json', 'highlight-video signals');
	return Object.freeze({ reviewAuthorityVersion: 1, audioWave, editorialCandidateIds,
		highlightVideoSignals, media });
}

function reviewMedia(value: unknown): AssistanceWorkflowReviewMediaV1 {
	const row = exactRecord(value, MEDIA_FIELDS, 'workflow review media');
	return Object.freeze({
		audio: mediaAsset(row.audio, 'audio/wav', 'audio'),
		video: mediaAsset(row.video, 'video/', 'video'),
	});
}

function mediaAsset(
	value: unknown,
	expectedMediaType: string,
	label: string,
): AssistanceWorkflowReviewMediaAssetV1 | null {
	if (value === null) return null;
	const row = exactRecord(value, MEDIA_ASSET_FIELDS, `workflow review ${label} asset`);
	if (typeof row.stageId !== 'string' || !SLOT_ID.test(row.stageId)
		|| typeof row.slotId !== 'string' || !SLOT_ID.test(row.slotId)
		|| typeof row.claimId !== 'string' || !CLAIM_ID.test(row.claimId)
		|| typeof row.mediaType !== 'string'
		|| (expectedMediaType.endsWith('/') ? !row.mediaType.startsWith(expectedMediaType)
			: row.mediaType !== expectedMediaType)
		|| !(row.body instanceof Blob) || row.body.size < 1 || row.body.type !== row.mediaType
		|| !Number.isSafeInteger(row.byteLength) || row.byteLength !== row.body.size
		|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new TypeError(`The workflow review ${label} body is invalid.`);
	}
	return Object.freeze({ stageId: row.stageId, slotId: row.slotId, claimId: row.claimId,
		mediaType: row.mediaType,
		byteLength: Number(row.byteLength), sha256: row.sha256, body: row.body });
}

function audioAuthority(value: unknown): AssistanceWorkflowAudioReviewAuthorityV1 {
	const row = exactRecord(value, AUDIO_FIELDS, 'workflow audio review authority');
	return Object.freeze({
		sampleRate: integer(row.sampleRate, 8_000, 384_000, 'audio review sample rate'),
		channelCount: integer(row.channelCount, 1, 64, 'audio review channel count'),
		frameCount: integer(row.frameCount, 1, Number.MAX_SAFE_INTEGER, 'audio review frame count'),
	});
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return row;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
