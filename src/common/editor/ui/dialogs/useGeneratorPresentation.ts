/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { summarizeMorseCode } from '../../morse-code.ts';

export function useMorseSummary(type: string, text: unknown, wordsPerMinute: unknown) {
	return useMemo(() => type === 'morse' ? summarizeMorseCode(text, wordsPerMinute) : null, [type, text, wordsPerMinute]);
}

export function useGeneratorFormatters(type: string, locale: string | undefined) {
	return useMemo(() => ({
		number: type === 'dtmf' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }) : null,
		// Units are localized rather than appending a fixed English suffix.
		seconds: type === 'dtmf' || type === 'morse' ? new Intl.NumberFormat(locale, {
			maximumFractionDigits: 3, style: 'unit', unit: 'second', unitDisplay: 'short',
		}) : null,
	}), [type, locale]);
}
