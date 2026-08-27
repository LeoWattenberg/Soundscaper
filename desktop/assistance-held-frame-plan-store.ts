/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, one-shot custody for a sampled-frame plan between Index Video stages. */

export interface AssistanceHeldFramePlanReservationV1<Plan> {
	commit(plan: Plan, signal: AbortSignal): boolean;
	release(): void;
}

export interface AssistanceHeldFramePlanStoreV1<Plan> {
	readonly size: number;
	reserve(jobId: string, identity: string): AssistanceHeldFramePlanReservationV1<Plan> | null;
	take(jobId: string, identity: string): Plan | null;
}

interface Entry<Plan> {
	readonly identity: string;
	readonly generation: symbol;
	readonly plan: Plan | null;
	readonly signal: AbortSignal | null;
	readonly onAbort: (() => void) | null;
}

export function createAssistanceHeldFramePlanStoreV1<Plan>(
	maximumEntries: number,
): AssistanceHeldFramePlanStoreV1<Plan> {
	if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 128) {
		throw new RangeError('The held frame-plan capacity is invalid.');
	}
	const entries = new Map<string, Entry<Plan>>();
	const remove = (jobId: string, expected: Entry<Plan>): void => {
		if (entries.get(jobId) !== expected) return;
		entries.delete(jobId);
		expected.signal?.removeEventListener('abort', expected.onAbort!);
	};
	return Object.freeze({
		get size() { return entries.size; },
		reserve(jobId: string, identity: string) {
			const current = entries.get(jobId);
			if (current && current.identity !== identity) return null;
			if (current) remove(jobId, current);
			if (entries.size >= maximumEntries) {
				const stale = [...entries].find(([, entry]) => entry.plan !== null);
				if (!stale) return null;
				remove(stale[0], stale[1]);
			}
			const generation = Symbol(jobId);
			const reserved: Entry<Plan> = Object.freeze({ identity, generation, plan: null,
				signal: null, onAbort: null });
			entries.set(jobId, reserved);
			let active = true;
			return Object.freeze({
				commit(plan: Plan, signal: AbortSignal): boolean {
					if (!active || entries.get(jobId) !== reserved) return false;
					active = false;
					if (signal.aborted) { remove(jobId, reserved); return false; }
					const onAbort = (): void => {
						const current = entries.get(jobId);
						if (current?.generation === generation) remove(jobId, current);
					};
					const held: Entry<Plan> = Object.freeze({ identity, generation, plan, signal, onAbort });
					entries.set(jobId, held);
					signal.addEventListener('abort', onAbort, { once: true });
					if (signal.aborted) onAbort();
					return entries.get(jobId) === held;
				},
				release(): void {
					if (!active) return;
					active = false;
					remove(jobId, reserved);
				},
			});
		},
		take(jobId: string, identity: string) {
			const entry = entries.get(jobId);
			if (!entry || entry.identity !== identity || entry.plan === null) return null;
			remove(jobId, entry);
			return entry.plan;
		},
	});
}
