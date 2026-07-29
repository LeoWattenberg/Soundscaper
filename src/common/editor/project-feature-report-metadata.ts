/* SPDX-License-Identifier: AGPL-3.0-only */

export function freezeProjectFeatureReportMetadata<Value>(value: Value): Value {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const report = (value as Record<string, unknown>).featureRequirementsReport;
	if (report && typeof report === 'object') deepFreeze(report, new WeakSet<object>());
	return value;
}

function deepFreeze(value: object, seen: WeakSet<object>): void {
	if (seen.has(value)) return;
	seen.add(value);
	for (const child of Object.values(value)) {
		if (child && typeof child === 'object') deepFreeze(child, seen);
	}
	Object.freeze(value);
}
