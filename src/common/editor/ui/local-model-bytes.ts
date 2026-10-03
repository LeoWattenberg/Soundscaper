/* SPDX-License-Identifier: AGPL-3.0-only */

export function formatLocalModelBytes(value: number | null, locale = 'en'): string | null {
	if (value === null) return null;
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let amount = value;
	let unitIndex = 0;
	while (amount >= 1024 && unitIndex < units.length - 1) {
		amount /= 1024;
		unitIndex += 1;
	}
	const maximumFractionDigits = unitIndex === 0 ? 0 : 1;
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(amount)} ${units[unitIndex]}`;
}
