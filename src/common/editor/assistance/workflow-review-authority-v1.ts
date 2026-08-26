/* SPDX-License-Identifier: AGPL-3.0-only */

/** Private renderer review authority captured before an aggregate workflow begins. */

export interface AssistanceWorkflowAudioReviewAuthorityV1 {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

export interface AssistanceWorkflowReviewAuthorityV1 {
	readonly reviewAuthorityVersion: 1;
	readonly audioWave: AssistanceWorkflowAudioReviewAuthorityV1 | null;
	readonly editorialCandidateIds: readonly string[] | null;
}

const AUTHORITY_FIELDS = Object.freeze([
	'reviewAuthorityVersion', 'audioWave', 'editorialCandidateIds',
]);
const AUDIO_FIELDS = Object.freeze(['sampleRate', 'channelCount', 'frameCount']);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;

export function createEmptyAssistanceWorkflowReviewAuthorityV1(): AssistanceWorkflowReviewAuthorityV1 {
	return Object.freeze({ reviewAuthorityVersion: 1, audioWave: null, editorialCandidateIds: null });
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
	return Object.freeze({ reviewAuthorityVersion: 1, audioWave, editorialCandidateIds });
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
