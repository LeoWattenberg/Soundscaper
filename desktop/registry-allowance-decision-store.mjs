/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve only explicit decisions when a fresh binary observation replaces a record. */
export function retainedAllowanceDecisions(previous) {
	return Object.freeze({
		allowed: previous?.allowed === true,
		selected: previous?.selected === true,
	});
}

/** Replay one persisted allowance/selection pair without making registry failures fatal. */
export function applyRegistryAllowanceRecord(registry, record) {
	try {
		if (record.allowed) registry.allow(record.installationId);
		if (record.selected) registry.select(record.installationId);
		return true;
	} catch { return false; }
}

/** Replay every decision whose domain identity still matches the live registry projection. */
export function applyRegistryAllowanceRecords(records, registry, matches) {
	const projection = registry.describe();
	for (const entry of projection.entries) for (const installation of entry.installations) {
		const record = records.get(installation.installationId);
		if (record && matches(record, entry, installation)) {
			applyRegistryAllowanceRecord(registry, record);
		}
	}
	return registry.describe();
}

/** Reproject current registry decisions onto the durable observations that own them. */
export function captureRegistryAllowanceDecisions(records, registry) {
	const decisions = new Map();
	for (const entry of registry.describe().entries) for (const installation of entry.installations) {
		decisions.set(installation.installationId, installation);
	}
	return new Map([...records].map(([installationId, record]) => {
		const decision = decisions.get(record.installationId);
		return [installationId, Object.freeze({
			...record,
			allowed: decision?.allowed ?? record.allowed,
			selected: decision?.selected ?? record.selected,
		})];
	}));
}

/** Reauthenticate, re-admit, correlate, and replay one exact persisted installation. */
export async function rebindRegistryAllowanceRecord({
	record,
	registry,
	authenticate,
	admit,
	matchesAdmission,
}) {
	if (!record) return false;
	const identity = await authenticate(record);
	if (!identity) return false;
	const admission = admit(registry, record, identity);
	return matchesAdmission(admission, record)
		&& applyRegistryAllowanceRecord(registry, record);
}
