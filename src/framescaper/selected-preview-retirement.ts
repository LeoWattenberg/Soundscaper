/* SPDX-License-Identifier: AGPL-3.0-only */

/** Cache retirement before any borrowed seal/abort callback, then join every
 * owned cleanup without reflecting on its failure or releasing a sibling early. */
export function createSelectedPreviewRetirement(seal: () => void, cleanup: readonly (() => unknown)[]): () => Promise<void> {
	let closing: Promise<void> | undefined;
	return () => {
		if (closing) return closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		void closing.catch(() => undefined);
		const errors: unknown[] = [];
		const retain = (error: unknown) => { if (!errors.some(value => Object.is(value, error))) errors.push(error); };
		try { seal(); } catch (error) { retain(error); }
		void (async () => {
			for (const dispose of cleanup) try { await dispose(); } catch (error) { retain(error); }
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, 'Selected preview retirement failed.');
		})().then(resolve, reject);
		return closing;
	};
}
