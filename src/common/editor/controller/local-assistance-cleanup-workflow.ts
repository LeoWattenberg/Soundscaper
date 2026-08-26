/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned lifecycle for one explicit transcript-cleanup decision. */

import type { DisfluencyOptions } from '../assistance/disfluency.ts';
import {
	createLocalAssistanceTranscriptCleanupSession,
	type LocalAssistanceTranscriptCleanupDependencies,
	type LocalAssistanceTranscriptCleanupRequest,
	type LocalAssistanceTranscriptCleanupSession,
	type LocalAssistanceTranscriptCleanupSnapshot,
} from './local-assistance-cleanup-acceptance.ts';

const PREPARATION_FIELDS = Object.freeze([
	'selectionFence', 'review', 'models', 'voiceActivity',
] as const);
const OPTIONS: DisfluencyOptions = Object.freeze({
	fillerLexicon: Object.freeze(['um', 'uh', 'erm']),
	detectRepetitions: true,
	minConfidence: 0,
});

export interface LocalAssistanceTranscriptCleanupWorkflow {
	prepareTranscriptCleanup(request: unknown): Promise<LocalAssistanceTranscriptCleanupSnapshot>;
	acceptTranscriptCleanup(proposalIds: readonly string[]): Promise<void>;
	rejectTranscriptCleanup(): Promise<void>;
	cancelTranscriptCleanup(): Promise<void>;
}

export function createLocalAssistanceTranscriptCleanupWorkflow(
	dependencies: LocalAssistanceTranscriptCleanupDependencies,
): Readonly<LocalAssistanceTranscriptCleanupWorkflow> {
	let active: LocalAssistanceTranscriptCleanupSession | null = null;

	async function prepareTranscriptCleanup(
		value: unknown,
	): Promise<LocalAssistanceTranscriptCleanupSnapshot> {
		if (active?.snapshot().phase === 'review') await active.cancel();
		active = null;
		const request = preparationRequest(value);
		active = createLocalAssistanceTranscriptCleanupSession(dependencies, request);
		return active.snapshot();
	}

	function acceptTranscriptCleanup(proposalIds: readonly string[]): Promise<void> {
		return activeSession(active).accept(proposalIds);
	}

	function rejectTranscriptCleanup(): Promise<void> {
		return activeSession(active).reject();
	}

	async function cancelTranscriptCleanup(): Promise<void> {
		if (active?.snapshot().phase === 'review') await active.cancel();
		active = null;
	}

	return Object.freeze({
		prepareTranscriptCleanup,
		acceptTranscriptCleanup,
		rejectTranscriptCleanup,
		cancelTranscriptCleanup,
	});
}

function preparationRequest(value: unknown): LocalAssistanceTranscriptCleanupRequest {
	const record = exactRecord(value, PREPARATION_FIELDS, 'transcript cleanup preparation');
	return Object.freeze({
		selectionFence: record.selectionFence,
		review: record.review,
		models: record.models,
		voiceActivity: record.voiceActivity,
		options: OPTIONS,
	}) as LocalAssistanceTranscriptCleanupRequest;
}

function activeSession(
	value: LocalAssistanceTranscriptCleanupSession | null,
): LocalAssistanceTranscriptCleanupSession {
	if (!value || value.snapshot().phase !== 'review') {
		throw new Error('No transcript cleanup proposal session is awaiting a decision.');
	}
	return value;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record as Record<Field, unknown>;
}
