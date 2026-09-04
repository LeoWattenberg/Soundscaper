/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Freeze a conversion-audit inventory all the way down.
 *
 * The inventories are read by the audit tests and by nothing that may write to them, so
 * each is frozen at its nested records and policy arrays rather than only at the top. The
 * three inventories each carried their own copy of this until they shared it.
 */
export function deepFreezeAuditSites<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreezeAuditSites(nested);
	return Object.freeze(value);
}
