/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeTakeCycleRecoveryEnvelope,
	type TakeCycleRecoveryEnvelope,
} from '../take-cycle-recovery-envelope.ts';

const KEY_PREFIX = 'take-cycle-recovery-envelope-v1:';

export interface TakeCycleRecoveryEnvelopeKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	replaceIfCurrent(
		key: string,
		expected: unknown,
		replacement: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
}

/** One durable, CAS-fenced lane recovery envelope per project. */
export class TakeCycleRecoveryEnvelopeRepository {
	readonly #values: TakeCycleRecoveryEnvelopeKeyValuePort;

	constructor(values: TakeCycleRecoveryEnvelopeKeyValuePort) {
		this.#values = values;
	}

	async load(projectId: string): Promise<TakeCycleRecoveryEnvelope | null> {
		const value = await this.#values.get(envelopeKey(projectId));
		return value === undefined || value === null
			? null
			: normalizeTakeCycleRecoveryEnvelope(value);
	}

	async create(envelopeValue: unknown): Promise<TakeCycleRecoveryEnvelope> {
		const envelope = normalizeTakeCycleRecoveryEnvelope(envelopeValue);
		if (!await this.#values.putIfAbsent(
			envelopeKey(envelope.projectFence.projectId),
			envelope,
		)) {
			throw new Error(`Project ${envelope.projectFence.projectId} already has an active recovery envelope.`);
		}
		return envelope;
	}

	async replace(
		expectedValue: unknown,
		nextValue: unknown,
	): Promise<TakeCycleRecoveryEnvelope> {
		const expected = normalizeTakeCycleRecoveryEnvelope(expectedValue);
		const next = normalizeTakeCycleRecoveryEnvelope(nextValue);
		assertSameContract(expected, next);
		assertForwardTransition(expected, next);
		if (!await this.#values.replaceIfCurrent(
			envelopeKey(expected.projectFence.projectId),
			expected,
			next,
		)) {
			throw new Error('The take cycle recovery envelope changed before replacement.');
		}
		return next;
	}

	async remove(expectedValue: unknown): Promise<void> {
		const expected = normalizeTakeCycleRecoveryEnvelope(expectedValue);
		if (!await this.#values.deleteIfCurrent(
			envelopeKey(expected.projectFence.projectId),
			expected,
		)) {
			throw new Error('The take cycle recovery envelope changed before removal.');
		}
	}
}

function assertSameContract(
	expected: TakeCycleRecoveryEnvelope,
	next: TakeCycleRecoveryEnvelope,
): void {
	if (JSON.stringify(contractProjection(expected)) !== JSON.stringify(contractProjection(next))) {
		throw new Error('A take cycle recovery envelope transition cannot change lane ownership.');
	}
}

function contractProjection(envelope: TakeCycleRecoveryEnvelope): unknown {
	return {
		...envelope,
		state: null,
		entries: envelope.entries.map((entry) => ({
			...entry,
			journal: { ...entry.journal, state: null },
		})),
	};
}

function assertForwardTransition(
	expected: TakeCycleRecoveryEnvelope,
	next: TakeCycleRecoveryEnvelope,
): void {
	const rank = { staged: 0, published: 1, committed: 2 } as const;
	if (rank[next.state] < rank[expected.state]
		|| next.entries.some((entry, index) => (
			rank[entry.journal.state] < rank[expected.entries[index]!.journal.state]
		))) {
		throw new Error('A take cycle recovery envelope transition cannot move backward.');
	}
}

function envelopeKey(projectId: string): string {
	if (typeof projectId !== 'string' || !projectId.length || projectId !== projectId.trim()
		|| projectId !== projectId.normalize('NFC') || /[\u0000-\u001f\u007f]/u.test(projectId)) {
		throw new TypeError('Take cycle recovery projectId must be canonical text.');
	}
	return `${KEY_PREFIX}${encodeURIComponent(projectId)}`;
}
