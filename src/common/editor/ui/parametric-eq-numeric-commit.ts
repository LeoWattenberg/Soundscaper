/* SPDX-License-Identifier: AGPL-3.0-only */

type NumericCommit = { readonly commit: false; readonly replacement: string }
	| { readonly commit: true; readonly value: number };

export function resolveParametricEqNumericCommit(
	text: string, formattedValue: string, cancelled: boolean, minimum?: number, maximum?: number,
): NumericCommit {
	const number = Number(text);
	if (cancelled || !text.trim() || !Number.isFinite(number)
		|| minimum !== undefined && number < minimum || maximum !== undefined && number > maximum) {
		return { commit: false, replacement: formattedValue };
	}
	return { commit: true, value: number };
}
