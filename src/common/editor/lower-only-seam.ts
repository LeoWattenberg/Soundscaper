/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one admission rule behind every lower-only qualification seam: a caller
 * may tighten a shipped ceiling but never raise it. Seams differ in their
 * floor, in whether an absent value falls back to the ceiling, and in the
 * error they raise, so each of those is a seam property rather than a policy
 * baked into the check.
 */

/** Why a seam refused a value: its shape or its attempt to raise the ceiling. */
export type LowerOnlySeamRefusal = 'shape' | 'ceiling';

export interface LowerOnlySeam {
	/** The shipped production limit a caller may tighten towards. */
	readonly ceiling: number;
	/** The smallest admitted value, typically 0 for budgets and 1 for capacities. */
	readonly floor: number;
	/** Whether an absent value resolves to the ceiling or is refused outright. */
	readonly absent: 'ceiling' | 'refuse';
	/** Builds the error this seam raises, preserving its type and wording. */
	readonly refuse: (refusal: LowerOnlySeamRefusal) => Error;
}

export function admitLowerOnly(value: unknown, seam: LowerOnlySeam): number {
	if (value === undefined && seam.absent === 'ceiling') return seam.ceiling;
	if (!Number.isSafeInteger(value) || (value as number) < seam.floor) throw seam.refuse('shape');
	if ((value as number) > seam.ceiling) throw seam.refuse('ceiling');
	return value as number;
}
