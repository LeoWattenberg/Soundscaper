/* SPDX-License-Identifier: AGPL-3.0-only */

export type ScapeInspectionOutcome = Readonly<
	| { status: 'fulfilled' }
	| { status: 'rejected'; reason: unknown }
>;

export interface ScapeInspectionAdmission {
	readonly signal: AbortSignal;
	cancel(reason: unknown): void;
	finish(outcome: ScapeInspectionOutcome): void;
}

export interface ScapeInspectionFence {
	wait(): Promise<void>;
	release(): void;
}

export interface ScapeInspectionQuiescence {
	admit(): ScapeInspectionAdmission;
	beginFence(reason: unknown): ScapeInspectionFence;
	close(reason: unknown): void;
	drain(): Promise<void>;
}

interface ActiveInspection {
	readonly controller: AbortController;
	readonly outcome: Promise<ScapeInspectionOutcome>;
}

/** Retains every inspection generation until its archive-reader cleanup settles. */
export function createScapeInspectionQuiescence(): ScapeInspectionQuiescence {
	const active = new Set<ActiveInspection>();
	const fences = new Map<object, unknown>();
	let closed = false;
	let closedReason: unknown;

	return Object.freeze({ admit, beginFence, close, drain });

	function admit(): ScapeInspectionAdmission {
		assertAdmissionOpen();
		const controller = new AbortController();
		let settle: (outcome: ScapeInspectionOutcome) => void = () => undefined;
		const outcome = new Promise<ScapeInspectionOutcome>((resolve) => { settle = resolve; });
		const inspection = Object.freeze({ controller, outcome });
		active.add(inspection);
		let finished = false;
		return Object.freeze({
			signal: controller.signal,
			cancel(reason: unknown) {
				if (!finished) controller.abort(reason);
			},
			finish(result: ScapeInspectionOutcome) {
				if (finished) return;
				finished = true;
				active.delete(inspection);
				settle(Object.freeze({ ...result }));
			},
		});
	}

	function beginFence(reason: unknown): ScapeInspectionFence {
		if (closed) throw closedReason;
		const token = Object.freeze({});
		fences.set(token, reason);
		const inspections = Object.freeze([...active]);
		for (const inspection of inspections) inspection.controller.abort(reason);
		let released = false;
		return Object.freeze({
			wait: () => waitFor(inspections),
			release() {
				if (released) return;
				released = true;
				fences.delete(token);
			},
		});
	}

	function close(reason: unknown): void {
		if (closed) return;
		closed = true;
		closedReason = reason;
		for (const inspection of active) inspection.controller.abort(reason);
	}

	function drain(): Promise<void> {
		return waitFor([...active]);
	}

	function assertAdmissionOpen(): void {
		if (closed) throw closedReason;
		if (!fences.size) return;
		let reason: unknown;
		for (const fenceReason of fences.values()) reason = fenceReason;
		throw reason;
	}
}

async function waitFor(inspections: readonly ActiveInspection[]): Promise<void> {
	const outcomes = await Promise.all(inspections.map(({ outcome }) => outcome));
	const failures: unknown[] = [];
	for (let index = 0; index < outcomes.length; index += 1) {
		const outcome = outcomes[index];
		const inspection = inspections[index];
		if (outcome?.status !== 'rejected' || !inspection) continue;
		if (inspection.controller.signal.aborted
			&& Object.is(outcome.reason, inspection.controller.signal.reason)) continue;
		failures.push(outcome.reason);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Multiple .scape inspections failed while draining cleanup.');
	}
}
