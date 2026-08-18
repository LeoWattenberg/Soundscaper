/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
	type DeliveryReport,
} from './delivery-report.ts';
import type { DeliveryBatch, DeliveryBatchMember } from './delivery-batch.ts';

/**
 * One report for the whole batch, itemizing every member.
 *
 * A batch that published four of six artifacts and said nothing about the other
 * two would read as a delivery that succeeded. Every member gets an item
 * whatever happened to it, including the ones that never started, so the report
 * says what exists and what does not — which is also what makes
 * retry-from-failure a decision the operator can make from the report rather
 * than from memory.
 *
 * Member reports are carried by reference rather than merged. A batch report
 * answers "what happened to each member"; the member's own report answers "what
 * did this delivery do to the material", and flattening them would lose which
 * conversion belonged to which artifact.
 */

export type DeliveryBatchMemberState = 'delivered' | 'failed' | 'cancelled' | 'not-started';

export interface DeliveryBatchMemberOutcome {
	readonly memberId: string;
	readonly state: DeliveryBatchMemberState;
	readonly fileName?: string | null;
	readonly failureMessage?: string | null;
	/** The member's own delivery report, when the delivery got far enough to seal one. */
	readonly report?: DeliveryReport | null;
}

export interface DeliveryBatchReportSummary {
	readonly delivered: number;
	readonly failed: number;
	readonly cancelled: number;
	readonly notStarted: number;
}

const STATE_DISPOSITION = Object.freeze({
	delivered: 'preserved',
	failed: 'missing',
	cancelled: 'missing',
	'not-started': 'missing',
} as const);

const STATE_SEVERITY = Object.freeze({
	delivered: 'info',
	failed: 'error',
	cancelled: 'warning',
	'not-started': 'warning',
} as const);

const STATE_MESSAGE = Object.freeze({
	delivered: 'The member was delivered.',
	failed: 'The member failed and produced no output.',
	cancelled: 'The member was cancelled and produced no output.',
	'not-started': 'The member never started, so nothing was delivered for it.',
} as const);

/** Seal the batch manifest: one item per member, in batch order. */
export function createDeliveryBatchReport(
	batch: DeliveryBatch,
	outcomes: Iterable<DeliveryBatchMemberOutcome>,
): DeliveryReport {
	if (!batch || !Array.isArray(batch.members)) {
		throw new TypeError('A delivery batch is required to report on it.');
	}
	const byId = new Map<string, DeliveryBatchMemberOutcome>();
	for (const outcome of outcomes) byId.set(outcome.memberId, outcome);

	const draft = createDeliveryReport({ format: 'delivery-batch' });
	for (const member of batch.members) {
		// A member with no recorded outcome never ran. Treating that as delivered
		// is the exact failure this report exists to prevent.
		const outcome = byId.get(member.memberId) ?? { memberId: member.memberId, state: 'not-started' as const };
		const state: DeliveryBatchMemberState = outcome.state in STATE_DISPOSITION ? outcome.state : 'not-started';
		addDeliveryReportItem(draft, {
			code: 'delivery.batch-member',
			disposition: STATE_DISPOSITION[state],
			severity: STATE_SEVERITY[state],
			scope: { kind: 'delivery-batch-member', id: member.memberId },
			data: memberData(member, outcome, state),
			message: STATE_MESSAGE[state],
		});
	}
	return sealDeliveryReport(draft);
}

/** What each member did, counted from the sealed batch report rather than recounted. */
export function summarizeDeliveryBatchReport(report: DeliveryReport): DeliveryBatchReportSummary {
	const counts = { delivered: 0, failed: 0, cancelled: 0, notStarted: 0 };
	for (const item of report.items) {
		if (item.code !== 'delivery.batch-member') continue;
		const state = item.data.state;
		if (state === 'delivered') counts.delivered += 1;
		else if (state === 'failed') counts.failed += 1;
		else if (state === 'cancelled') counts.cancelled += 1;
		else counts.notStarted += 1;
	}
	return Object.freeze(counts);
}

/** The members a retry-from-failure should re-run: the failed ones and the ones that never ran. */
export function deliveryBatchRetryMemberIds(report: DeliveryReport): readonly string[] {
	return Object.freeze(report.items
		.filter((item) => item.code === 'delivery.batch-member'
			&& (item.data.state === 'failed' || item.data.state === 'not-started'))
		.map((item) => String(item.scope.id)));
}

function memberData(
	member: DeliveryBatchMember,
	outcome: DeliveryBatchMemberOutcome,
	state: DeliveryBatchMemberState,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		state,
		label: member.label,
		presetId: member.presetId,
		targetKind: member.target.kind,
		...(member.target.id === undefined ? {} : { targetId: member.target.id }),
		mode: member.mode,
		format: member.settings.format ?? null,
		fileName: outcome.fileName ?? null,
		...(outcome.failureMessage ? { failureMessage: outcome.failureMessage } : {}),
		// By reference: a batch report says what happened to each member, and the
		// member's own report says what its delivery did to the material.
		...(outcome.report ? { report: outcome.report } : {}),
	});
}
