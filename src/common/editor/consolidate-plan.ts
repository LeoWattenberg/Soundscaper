/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';

/**
 * Planning for consolidate: which media has to be copied into managed storage.
 *
 * A source does not carry a flag saying whether it is linked or managed. That
 * lives in the linked-original binding repositories, so this module takes the
 * bindings as an argument rather than inventing a `source.external` field and
 * creating a second source of truth for something the milestone-2 linked-media
 * lifecycle already owns.
 *
 * **Consolidate copies; it never relocates by removal.** The
 * `m2-linked-media-lifecycle` acceptance is binding and external media is never
 * deleted, so a consolidated source has a managed copy *and* its original still
 * sitting where the user left it. Rebinding happens through the existing relink
 * machinery, on the far side of a verified copy.
 *
 * **Unreachable originals do not stop the run.** A drive is unplugged more often
 * than a project is abandoned, so the plan consolidates what it can reach and
 * itemises what it could not. The obvious hazard in that choice is someone
 * reading "consolidated" and shipping an archive with holes in it, so
 * incompleteness is not something a caller has to go looking for: `complete` is
 * false, `unreachable` is non-empty, and both sit on the plan itself rather than
 * only in the report.
 */

export type ConsolidateDisposition = 'already-managed' | 'copy' | 'unreachable' | 'unbound';

export interface ConsolidateSourcePlan {
	readonly sourceId: string;
	readonly disposition: ConsolidateDisposition;
	/** Present for anything that has a binding, so a copy can be verified. */
	readonly storageKey: string | null;
	readonly byteLength: number;
	readonly sha256: string | null;
	/** The compare-and-swap fence the rebind must present. */
	readonly bindingToken: string | null;
	readonly kind: 'audio' | 'video' | null;
}

export interface ConsolidatePlan {
	/** False when anything could not be reached. Checked before calling a run a success. */
	readonly complete: boolean;
	readonly sources: readonly ConsolidateSourcePlan[];
	readonly copy: readonly ConsolidateSourcePlan[];
	readonly unreachable: readonly ConsolidateSourcePlan[];
	/** Bytes that would be written into managed storage. */
	readonly copyByteLength: number;
	readonly report: DeliveryReport;
}

export interface ConsolidateBinding {
	readonly sourceId: string;
	readonly storageKey: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly bindingToken: string;
	readonly kind: 'audio' | 'video';
}

export interface ConsolidatePlanRequest {
	readonly project: Readonly<Record<string, unknown>>;
	/** Linked-original bindings, from the binding repositories. */
	readonly bindings: readonly ConsolidateBinding[];
	/**
	 * Whether a linked original can be read right now. Injected because
	 * reachability is a platform question, and a plan that assumed everything
	 * was reachable would be a plan that is wrong exactly when it matters.
	 */
	readonly isReachable?: (binding: ConsolidateBinding) => boolean;
}

export function createConsolidatePlan(request: ConsolidatePlanRequest): ConsolidatePlan {
	const project = request?.project;
	if (!project || typeof project !== 'object') throw new TypeError('A consolidate plan requires a project.');
	const isReachable = request?.isReachable ?? (() => true);

	const bindings = new Map<string, ConsolidateBinding>();
	for (const binding of request?.bindings ?? []) {
		const sourceId = String(binding?.sourceId ?? '');
		if (!sourceId) throw new TypeError('A linked-original binding requires a sourceId.');
		if (bindings.has(sourceId)) {
			throw new RangeError(`Source ${sourceId} has more than one linked-original binding.`);
		}
		bindings.set(sourceId, binding);
	}

	const draft = createDeliveryReport({
		format: 'consolidate', container: null, codec: null,
		sampleRate: null, channelCount: null, lossless: null,
	});

	// Only sources the project actually references are worth copying; a binding
	// with no source left is stale, and reported rather than acted on.
	const referenced = new Set(
		asRecords(project.clips).map((clip) => String(clip.sourceId ?? '')).filter(Boolean),
	);

	const plans: ConsolidateSourcePlan[] = [];
	for (const source of asRecords(project.sources)) {
		const sourceId = String(source.id ?? '');
		if (!sourceId) continue;
		const binding = bindings.get(sourceId);

		if (!binding) {
			// No binding means the bytes already live in managed storage.
			plans.push(entry(sourceId, 'already-managed', null));
			addDeliveryReportItem(draft, {
				code: 'consolidate.already-managed',
				disposition: 'preserved',
				severity: 'info',
				scope: { kind: 'source', id: sourceId },
				data: {},
				message: 'The source is already in managed storage, so there is nothing to copy.',
			});
			continue;
		}

		if (!isReachable(binding)) {
			plans.push(entry(sourceId, 'unreachable', binding));
			addDeliveryReportItem(draft, {
				code: 'consolidate.original-unreachable',
				disposition: 'missing',
				severity: 'error',
				scope: { kind: 'source', id: sourceId },
				data: { storageKey: binding.storageKey, byteLength: binding.byteLength },
				message: 'The linked original could not be read, so this source was not consolidated.',
			});
			continue;
		}

		plans.push(entry(sourceId, 'copy', binding));
		addDeliveryReportItem(draft, {
			code: 'consolidate.copied',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'source', id: sourceId },
			data: { byteLength: binding.byteLength, sha256: binding.sha256, kind: binding.kind },
			message: 'The linked original is copied into managed storage; the original file is left in place.',
		});
	}

	for (const [sourceId, binding] of bindings) {
		if (plans.some((plan) => plan.sourceId === sourceId)) continue;
		plans.push(entry(sourceId, 'unbound', binding));
		addDeliveryReportItem(draft, {
			code: 'consolidate.binding-without-source',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'source', id: sourceId },
			data: { storageKey: binding.storageKey },
			message: 'A binding refers to a source the project no longer contains; nothing was copied for it.',
		});
	}

	for (const plan of plans) {
		if (plan.disposition !== 'copy' || referenced.has(plan.sourceId)) continue;
		addDeliveryReportItem(draft, {
			code: 'consolidate.source-unreferenced',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'source', id: plan.sourceId },
			data: {},
			message: 'No clip references this source, but it is consolidated anyway rather than dropped.',
		});
	}

	plans.sort((left, right) => (left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0));
	const copy = plans.filter((plan) => plan.disposition === 'copy');
	const unreachable = plans.filter((plan) => plan.disposition === 'unreachable');

	if (unreachable.length > 0) {
		// Stated once at the top level as well as per source, so a summary that
		// reads only the leading item still says the run was incomplete.
		addDeliveryReportItem(draft, {
			code: 'consolidate.incomplete',
			disposition: 'missing',
			severity: 'error',
			data: { unreachable: unreachable.length, copied: copy.length },
			message: 'Some linked originals were unreachable, so this project is not fully self-contained.',
		});
	}

	return Object.freeze({
		complete: unreachable.length === 0,
		sources: Object.freeze(plans),
		copy: Object.freeze(copy),
		unreachable: Object.freeze(unreachable),
		copyByteLength: copy.reduce((sum, plan) => sum + plan.byteLength, 0),
		report: sealDeliveryReport(draft),
	});
}

function entry(
	sourceId: string,
	disposition: ConsolidateDisposition,
	binding: ConsolidateBinding | null,
): ConsolidateSourcePlan {
	return Object.freeze({
		sourceId,
		disposition,
		storageKey: binding?.storageKey ?? null,
		byteLength: binding?.byteLength ?? 0,
		sha256: binding?.sha256 ?? null,
		bindingToken: binding?.bindingToken ?? null,
		kind: binding?.kind ?? null,
	});
}

function asRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return (Array.isArray(value) ? value : [])
		.filter((entryValue): entryValue is Readonly<Record<string, unknown>> => (
			Boolean(entryValue) && typeof entryValue === 'object'
		));
}
