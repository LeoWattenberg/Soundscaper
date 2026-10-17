/* SPDX-License-Identifier: AGPL-3.0-only */

import { failMetadata } from './image-metadata-binary.ts';

/** Persisted capture text is validated without opening an IPTC container reader. */
export function validateIptcDateTextV1(text: string): void {
	if (!/^\d{8}$/.test(text)) failMetadata('malformed-iptc');
	const month = Number(text.slice(4, 6)), day = Number(text.slice(6));
	if (month > 12 || day > 31 || month === 0 && day !== 0) failMetadata('malformed-iptc');
	const year = Number(text.slice(0, 4));
	const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (month !== 0 && day !== 0 && day > (days[month - 1] ?? 0)) failMetadata('malformed-iptc');
}

export function validateIptcTimeTextV1(text: string): void {
	if (!/^\d{6}[+-]\d{4}$/.test(text)) failMetadata('malformed-iptc');
	if (Number(text.slice(0, 2)) > 23 || Number(text.slice(2, 4)) > 59 || Number(text.slice(4, 6)) > 59
		|| Number(text.slice(7, 9)) > 23 || Number(text.slice(9, 11)) > 59) failMetadata('malformed-iptc');
}
