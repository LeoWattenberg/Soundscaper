/** Audacity design system 20ce5547: locale-friendly manual numeric entry. */
export function parseManualValue(text: string): number | null {
	const digits = text.trim().replace(',', '.').replace(/[^0-9.+-]+$/gu, '').trim();
	if (!/^[+-]?(\d+\.?\d*|\.\d+)$/u.test(digits)) return null;
	const value = Number(digits);
	return Number.isFinite(value) ? value : null;
}
