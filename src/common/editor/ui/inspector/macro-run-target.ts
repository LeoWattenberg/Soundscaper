/* SPDX-License-Identifier: AGPL-3.0-only */

import { isMacroCommandStep } from '../../macro-command-steps.ts';

/** A leading command can create tracks or establish the effect run's selection. */
export function macroStartsWithCommand(steps: readonly unknown[]): boolean {
	const first = steps.find((step) => Boolean(step) && typeof step === 'object'
		&& (step as { readonly enabled?: unknown }).enabled !== false);
	return isMacroCommandStep(first);
}
