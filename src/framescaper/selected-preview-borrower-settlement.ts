/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deliver only after the scoped operation and every owned retirement join.
 * Primary/cleanup outcomes remain opaque; failed delivery retires private bytes. */
export async function settleSelectedPreviewBorrower<Result>(
	operation: () => Promise<Result>,
	retire: () => unknown,
	abandon: () => void,
): Promise<Result> {
	const errors: unknown[] = [];
	const retain = (error: unknown) => { if (!errors.some(value => Object.is(value, error))) errors.push(error); };
	let result!: Result;
	try { result = await operation(); } catch (error) { retain(error); }
	try { await retire(); } catch (error) { retain(error); }
	if (errors.length > 0) {
		try { abandon(); } catch (error) { retain(error); }
		if (errors.length === 1) throw errors[0];
		throw new AggregateError(errors, 'Selected preview operation and retirement failed.');
	}
	return result;
}
