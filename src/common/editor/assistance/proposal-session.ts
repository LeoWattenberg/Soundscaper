/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Transaction boundary between untrusted assistance output and canonical edits.
 *
 * Inference may take long enough for the selected occurrence, its links, or its
 * timing authority to change. A proposal session therefore carries one exact
 * digest-bound selection fence and revalidates it immediately before asking
 * the product command owner to commit one atomic batch.
 */

import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from './operation.ts';

export type { AssistanceOperation } from './operation.ts';
const FENCE_FIELDS = Object.freeze([
	'projectId', 'schemaVersion', 'revision', 'sequenceId', 'occurrenceIds',
	'sourceId', 'sourceSha256', 'sourceStartFrame', 'sourceEndFrame',
	'linkMembershipSha256', 'timingAuthoritySha256',
] as const);
const PROPOSAL_FIELDS = Object.freeze(['id', 'kind', 'command'] as const);
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const ID_PATTERN = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const MAX_PROPOSALS = 4096;
const MAX_OCCURRENCES = 256;
const MAX_ASSISTANCE_ASSETS = 1024;

export interface AssistanceSelectionFence {
	readonly projectId: string;
	readonly schemaVersion: number;
	readonly revision: number;
	readonly sequenceId: string;
	readonly occurrenceIds: readonly string[];
	readonly sourceId: string;
	readonly sourceSha256: string;
	readonly sourceStartFrame: number;
	/** Exclusive source-frame end. */
	readonly sourceEndFrame: number;
	readonly linkMembershipSha256: string;
	readonly timingAuthoritySha256: string;
}

export interface AssistanceProposal {
	readonly id: string;
	readonly kind: string;
	readonly command: Readonly<Record<string, unknown>>;
}

export interface AssistanceProposalBatch {
	readonly fence: AssistanceSelectionFence;
	readonly commands: readonly Readonly<Record<string, unknown>>[];
	readonly assistanceAssets: readonly Readonly<Record<string, unknown>>[];
}

export type AssistanceProposalPhase =
	| 'review'
	| 'accepting'
	| 'accepted'
	| 'rejected'
	| 'cancelled'
	| 'failed';

export interface AssistanceProposalSnapshot {
	readonly operation: AssistanceOperation;
	readonly phase: AssistanceProposalPhase;
	readonly fence: AssistanceSelectionFence;
	readonly proposals: readonly AssistanceProposal[];
}

export interface AssistanceProposalSessionOptions {
	readonly operation: AssistanceOperation;
	readonly fence: AssistanceSelectionFence;
	readonly proposals: readonly AssistanceProposal[];
	readonly assistanceAssets?: readonly Readonly<Record<string, unknown>>[];
	currentFence(): PromiseLike<AssistanceSelectionFence> | AssistanceSelectionFence;
	commit(batch: AssistanceProposalBatch): PromiseLike<void> | void;
	discardStaged(): PromiseLike<void> | void;
}

export interface AssistanceProposalSession {
	readonly signal: AbortSignal;
	snapshot(): AssistanceProposalSnapshot;
	accept(proposalIds: readonly string[]): Promise<void>;
	reject(): Promise<void>;
	cancel(): Promise<void>;
}

export class AssistanceProposalStaleError extends Error {
	constructor() {
		super('The assistance proposal no longer matches the selected project revision and media authority.');
		this.name = 'AssistanceProposalStaleError';
	}
}

export function createAssistanceProposalSession(
	options: AssistanceProposalSessionOptions,
): AssistanceProposalSession {
	if (!options || typeof options !== 'object') {
		throw new TypeError('An assistance proposal session operation is unsupported.');
	}
	const operation = normalizeAssistanceOperation(options.operation);
	if (typeof options.currentFence !== 'function' || typeof options.commit !== 'function'
		|| typeof options.discardStaged !== 'function') {
		throw new TypeError('An assistance proposal session requires its transaction ports.');
	}
	const expectedFence = validateAssistanceSelectionFence(options.fence);
	const proposals = normalizeProposals(options.proposals);
	const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
	const assistanceAssets = normalizeAssets(options.assistanceAssets ?? []);
	const controller = new AbortController();
	let phase: AssistanceProposalPhase = 'review';
	let discarded = false;

	const snapshot = (): AssistanceProposalSnapshot => Object.freeze({
		operation,
		phase,
		fence: expectedFence,
		proposals,
	});
	const discard = async (): Promise<void> => {
		if (discarded) return;
		discarded = true;
		await options.discardStaged();
	};
	const assertReview = (): void => {
		if (phase !== 'review') throw new Error('This assistance proposal session no longer accepts decisions.');
	};
	const accept = async (proposalIds: readonly string[]): Promise<void> => {
		assertReview();
		const accepted = normalizeDecision(proposalIds, proposalById);
		phase = 'accepting';
		try {
			const current = validateAssistanceSelectionFence(await options.currentFence());
			if (!sameFence(expectedFence, current)) throw new AssistanceProposalStaleError();
			await options.commit(Object.freeze({
				fence: expectedFence,
				commands: Object.freeze(proposals
					.filter(({ id }) => accepted.has(id))
					.map(({ command }) => command)),
				assistanceAssets,
			}));
			phase = 'accepted';
		} catch (error) {
			phase = 'failed';
			await discard().catch(() => undefined);
			throw error;
		}
	};
	const reject = async (): Promise<void> => {
		assertReview();
		phase = 'rejected';
		await discard();
	};
	const cancel = async (): Promise<void> => {
		assertReview();
		phase = 'cancelled';
		controller.abort(new DOMException('The assistance proposal was cancelled.', 'AbortError'));
		await discard();
	};
	return Object.freeze({ signal: controller.signal, snapshot, accept, reject, cancel });
}

/** Normalize the exact authority shared by inference and proposal acceptance. */
export function validateAssistanceSelectionFence(value: unknown): AssistanceSelectionFence {
	const record = exactRecord(value, FENCE_FIELDS, 'assistance selection fence fields');
	const sourceStartFrame = integer(record.sourceStartFrame, 0, 'source start frame');
	const sourceEndFrame = integer(record.sourceEndFrame, 1, 'source end frame');
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('The assistance source range must have a positive exclusive extent.');
	}
	if (!Array.isArray(record.occurrenceIds) || record.occurrenceIds.length < 1
		|| record.occurrenceIds.length > MAX_OCCURRENCES) {
		throw new RangeError('An assistance selection needs between one and 256 occurrences.');
	}
	const occurrenceIds = Object.freeze(record.occurrenceIds.map((value) => id(value, 'occurrence ID')));
	if (new Set(occurrenceIds).size !== occurrenceIds.length) {
		throw new Error('Assistance selection occurrence IDs must be unique.');
	}
	return Object.freeze({
		projectId: id(record.projectId, 'project ID'),
		schemaVersion: integer(record.schemaVersion, 1, 'schema version'),
		revision: integer(record.revision, 0, 'project revision'),
		sequenceId: id(record.sequenceId, 'sequence ID'),
		occurrenceIds,
		sourceId: id(record.sourceId, 'source ID'),
		sourceSha256: digest(record.sourceSha256, 'source digest'),
		sourceStartFrame,
		sourceEndFrame,
		linkMembershipSha256: digest(record.linkMembershipSha256, 'link-membership digest'),
		timingAuthoritySha256: digest(record.timingAuthoritySha256, 'timing-authority digest'),
	});
}

function normalizeProposals(value: unknown): readonly AssistanceProposal[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PROPOSALS) {
		throw new RangeError('An assistance session needs between one and 4096 proposals.');
	}
	const proposals = value.map((candidate) => {
		const record = exactRecord(candidate, PROPOSAL_FIELDS, 'assistance proposal fields');
		if (typeof record.kind !== 'string' || !ID_PATTERN.test(record.kind)) {
			throw new TypeError('An assistance proposal kind is invalid.');
		}
		if (!record.command || typeof record.command !== 'object' || Array.isArray(record.command)) {
			throw new TypeError('An assistance proposal command must be an object.');
		}
		return Object.freeze({
			id: id(record.id, 'proposal ID'),
			kind: record.kind,
			command: Object.freeze(structuredClone(record.command as Record<string, unknown>)),
		});
	});
	if (new Set(proposals.map(({ id: proposalId }) => proposalId)).size !== proposals.length) {
		throw new Error('Assistance proposal IDs must be unique.');
	}
	return Object.freeze(proposals);
}

function normalizeAssets(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value) || value.length > MAX_ASSISTANCE_ASSETS) {
		throw new RangeError('An assistance proposal session carries too many assets.');
	}
	return Object.freeze(value.map((asset) => {
		if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
			throw new TypeError('An assistance asset reference must be an object.');
		}
		return Object.freeze(structuredClone(asset as Record<string, unknown>));
	}));
}

function normalizeDecision(
	value: unknown,
	proposals: ReadonlyMap<string, AssistanceProposal>,
): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length > proposals.size) {
		throw new RangeError('An assistance proposal decision set is out of range.');
	}
	const ids = value.map((candidate) => id(candidate, 'accepted proposal ID'));
	if (new Set(ids).size !== ids.length) throw new Error('Accepted assistance proposal IDs must be unique.');
	for (const proposalId of ids) {
		if (!proposals.has(proposalId)) throw new Error(`Unknown proposal ${proposalId}.`);
	}
	return new Set(ids);
}

function sameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): boolean {
	return left.projectId === right.projectId
		&& left.schemaVersion === right.schemaVersion
		&& left.revision === right.revision
		&& left.sequenceId === right.sequenceId
		&& left.sourceId === right.sourceId
		&& left.sourceSha256 === right.sourceSha256
		&& left.sourceStartFrame === right.sourceStartFrame
		&& left.sourceEndFrame === right.sourceEndFrame
		&& left.linkMembershipSha256 === right.linkMembershipSha256
		&& left.timingAuthoritySha256 === right.timingAuthoritySha256
		&& left.occurrenceIds.length === right.occurrenceIds.length
		&& left.occurrenceIds.every((value, index) => value === right.occurrenceIds[index]);
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${name} must be an object.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...fields].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		throw new TypeError(`The ${name} are invalid.`);
	}
	return record as Record<Field, unknown>;
}

function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
		throw new TypeError(`The assistance ${name} is invalid.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new TypeError(`The assistance ${name} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new RangeError(`The assistance ${name} is out of range.`);
	}
	return value as number;
}
