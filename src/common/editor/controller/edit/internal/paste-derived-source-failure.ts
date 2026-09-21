/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DerivedSourceFailureRollback<RecordType> {
	readonly message: string;
	rollback(records: readonly RecordType[]): PromiseLike<void> | void;
}

/** Reclaim caller-owned derived sources while retaining both failure causes. */
export async function rollbackDerivedSourcesAfterFailure<RecordType>(
	records: readonly RecordType[],
	primaryFailure: unknown,
	rollback: Readonly<DerivedSourceFailureRollback<RecordType>>,
): Promise<never> {
	if (!records.length) throw primaryFailure;
	try {
		await rollback.rollback(records);
	} catch (rollbackFailure) {
		throw new AggregateError(
			[primaryFailure, rollbackFailure],
			rollback.message,
			{ cause: rollbackFailure },
		);
	}
	throw primaryFailure;
}
