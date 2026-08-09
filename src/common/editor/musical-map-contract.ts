/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;

const TEMPO_MAP_KEYS = new Set(['mode', 'events', 'opaqueExtensions']);
const TEMPO_EVENT_KEYS = new Set(['id', 'beat', 'bpm', 'samplePosition', 'opaqueExtensions']);

/** Reject implicit ramp/interpolation state; V10 tempo maps are hold-only. */
export function assertHoldTempoMapWireKeys(value: DataRecord): void {
	assertOnlyKeys(value, TEMPO_MAP_KEYS, 'tempoMap');
	if (!Array.isArray(value.events)) return;
	for (const [index, candidate] of value.events.entries()) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
		assertOnlyKeys(candidate as DataRecord, TEMPO_EVENT_KEYS, `tempoMap event ${String(index)}`);
	}
}

function assertOnlyKeys(value: DataRecord, allowed: ReadonlySet<string>, name: string): void {
	const unsupported = Object.keys(value).find((key) => !allowed.has(key));
	if (unsupported) throw new RangeError(`${name} has unsupported field ${unsupported}.`);
}
