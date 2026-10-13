/* SPDX-License-Identifier: AGPL-3.0-only */
/** A completed render cannot publish a qualification before physical cleanup and identity checks. */
export async function finishMotionAuthoredQualification<T>(work: () => Promise<T>, cleanup: () => Promise<void>, verify: () => Promise<void>,
	record: (value: Readonly<{ status: 'passed' | 'failed'; receipt: T | null; errors: readonly string[] }>) => Promise<void>): Promise<T> {
	let receipt: T | null = null; const failures: unknown[] = [];
	try { receipt = await work(); } catch (error) { failures.push(error); }
	try { await cleanup(); } catch (error) { failures.push(error); }
	try { await verify(); } catch (error) { failures.push(error); }
	try { await record({ status: failures.length ? 'failed' : 'passed', receipt, errors: failures.map(String) }); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError(failures, 'Authored qualification or cleanup failed.');
	return receipt!;
}
