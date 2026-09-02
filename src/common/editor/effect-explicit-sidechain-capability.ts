/* SPDX-License-Identifier: AGPL-3.0-only */

export type EffectExplicitSidechainCapability = 'supported' | 'unsupported' | 'unknown';

const SUPPORTED_EXPLICIT_SIDECHAIN_TYPES = new Set([
	'limiter',
	'gate',
	'audacity-auto-duck',
]);

/**
 * The single runtime contract for an authored mixer edge feeding an effect.
 * Identity-only projections cannot decide capability and remain audit-compatible.
 */
export function effectExplicitSidechainCapability(
	effect: unknown,
): EffectExplicitSidechainCapability {
	if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return 'unknown';
	const record = effect as Readonly<Record<string, unknown>>;
	if (!Object.hasOwn(record, 'type') && !Object.hasOwn(record, 'kind')) return 'unknown';
	const type = String(record.type || record.kind || '').toLowerCase();
	return SUPPORTED_EXPLICIT_SIDECHAIN_TYPES.has(type) ? 'supported' : 'unsupported';
}

export function effectSupportsExplicitSidechain(effect: unknown): boolean {
	return effectExplicitSidechainCapability(effect) === 'supported';
}
