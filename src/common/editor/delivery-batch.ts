/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveDeliveryPresetPlanOptions,
	type DeliveryPreset,
} from './delivery-preset.ts';
import { masteringSequenceRegionViews } from './mastering-sequence-regions.ts';
import type { RuntimeTimelineAnnotationProject } from './runtime-timeline-annotation-projection.ts';

/**
 * A batch is a list of plans plus a manifest — never a second delivery path.
 *
 * Each member resolves to the ordinary export settings a single delivery would
 * have used, so a batch member and the same delivery run on its own produce the
 * same bytes by construction. Nothing here renders, encodes, or queues: this
 * decides *what* the members are, and everything downstream treats each one as
 * an ordinary delivery.
 *
 * **Alternates are a cross product, not a member type.** "This preset over these
 * ranges" is the same shape as "these presets over this range", so there is one
 * builder rather than a bespoke alternates path that could drift from it.
 */

export const DELIVERY_BATCH_TARGET_KINDS = Object.freeze([
	'project', 'selection', 'loop', 'region', 'mastering-sequence',
] as const);

export type DeliveryBatchTargetKind = (typeof DELIVERY_BATCH_TARGET_KINDS)[number];

export interface DeliveryBatchTarget {
	readonly kind: DeliveryBatchTargetKind;
	/** The region annotation or mastering sequence this target names. */
	readonly id?: string;
}

export type DeliveryBatchMode = 'mix' | 'stems';

export interface DeliveryBatchMember {
	readonly memberId: string;
	readonly label: string;
	readonly presetId: string;
	readonly target: DeliveryBatchTarget;
	readonly mode: DeliveryBatchMode;
	/** Exactly the settings a single delivery of this member would have used. */
	readonly settings: Readonly<Record<string, unknown>>;
}

export interface DeliveryBatch {
	readonly batchId: string;
	readonly members: readonly DeliveryBatchMember[];
}

export interface DeliveryBatchRequest {
	readonly batchId: string;
	readonly presets: readonly DeliveryPreset[];
	readonly targets: readonly DeliveryBatchTarget[];
	/** Applied to every member; a target that cannot honour it is refused, not adjusted. */
	readonly mode?: DeliveryBatchMode;
	readonly createMemberId?: (index: number) => string;
}

export class DeliveryBatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DeliveryBatchError';
	}
}

/**
 * Build the batch: every preset against every target, in a stable order.
 *
 * Targets are resolved against the project *now*, so a batch naming a region
 * that has been deleted is refused when it is built rather than failing member
 * by member halfway through a queue.
 */
export function createDeliveryBatch(
	project: RuntimeTimelineAnnotationProject,
	request: DeliveryBatchRequest,
): DeliveryBatch {
	if (typeof request?.batchId !== 'string' || request.batchId === '') {
		throw new DeliveryBatchError('A delivery batch requires an id.');
	}
	const presets = request.presets ?? [];
	const targets = request.targets ?? [];
	if (presets.length === 0) throw new DeliveryBatchError('A delivery batch requires at least one preset.');
	if (targets.length === 0) throw new DeliveryBatchError('A delivery batch requires at least one target.');
	const mode: DeliveryBatchMode = request.mode === 'stems' ? 'stems' : 'mix';
	const createMemberId = request.createMemberId
		?? ((index: number) => `${request.batchId}-${index + 1}`);

	const members: DeliveryBatchMember[] = [];
	for (const target of targets) {
		const resolved = resolveTarget(project, target, mode);
		for (const preset of presets) {
			if (preset.kind !== 'audio') {
				// A video preset delivers a different artifact from a different plan
				// builder; mixing them in one batch would make "the batch's report"
				// two vocabularies pretending to be one.
				throw new DeliveryBatchError(`Delivery batch preset ${preset.id} is not an audio preset.`);
			}
			const presetOptions = resolveDeliveryPresetPlanOptions(preset);
			members.push(Object.freeze({
				memberId: createMemberId(members.length),
				label: `${resolved.label} — ${preset.label}`,
				presetId: preset.id,
				target: resolved.target,
				mode,
				// The target wins over the preset's own mode: a preset describes a
				// format, and which material is delivered is the batch's decision.
				settings: Object.freeze({ ...presetOptions, ...resolved.settings, mode }),
			}));
		}
	}
	return Object.freeze({ batchId: request.batchId, members: Object.freeze(members) });
}

interface ResolvedTarget {
	readonly target: DeliveryBatchTarget;
	readonly label: string;
	readonly settings: Readonly<Record<string, unknown>>;
}

function resolveTarget(
	project: RuntimeTimelineAnnotationProject,
	target: DeliveryBatchTarget,
	mode: DeliveryBatchMode,
): ResolvedTarget {
	if (!target || !DELIVERY_BATCH_TARGET_KINDS.includes(target.kind)) {
		throw new DeliveryBatchError(`Unsupported delivery batch target: ${String(target?.kind)}.`);
	}
	if (target.kind === 'region') {
		const id = requiredId(target, 'region');
		const region = masteringSequenceRegionViews(project).find((candidate) => candidate.id === id);
		if (!region) {
			throw new DeliveryBatchError(`Delivery batch region ${id} is not a region in this project.`);
		}
		return {
			target: Object.freeze({ kind: 'region', id }),
			label: region.name,
			settings: Object.freeze({
				range: Object.freeze({ startFrame: region.startFrame, endFrame: region.endFrame }),
			}),
		};
	}
	if (target.kind === 'mastering-sequence') {
		const id = requiredId(target, 'mastering sequence');
		if (mode === 'stems') {
			// A sequence is one spliced artifact; stems of it would each have to be
			// spliced the same way and would stop summing to it.
			throw new DeliveryBatchError('A mastering sequence cannot be delivered as stems.');
		}
		const sequence = sequences(project).find((candidate) => candidate.id === id);
		if (!sequence) {
			throw new DeliveryBatchError(`Delivery batch mastering sequence ${id} is not in this project.`);
		}
		return {
			target: Object.freeze({ kind: 'mastering-sequence', id }),
			label: typeof sequence.name === 'string' && sequence.name ? sequence.name : id,
			settings: Object.freeze({ masteringSequenceId: id, range: 'project' }),
		};
	}
	return {
		target: Object.freeze({ kind: target.kind }),
		label: target.kind,
		settings: Object.freeze({ range: target.kind }),
	};
}

function requiredId(target: DeliveryBatchTarget, noun: string): string {
	if (typeof target.id !== 'string' || target.id === '') {
		throw new DeliveryBatchError(`A delivery batch ${noun} target requires its id.`);
	}
	return target.id;
}

function sequences(
	project: RuntimeTimelineAnnotationProject,
): readonly Readonly<{ id?: unknown; name?: unknown }>[] {
	const value = (project as unknown as { masteringSequences?: unknown }).masteringSequences;
	if (!Array.isArray(value)) {
		throw new DeliveryBatchError('This project revision does not carry mastering sequences.');
	}
	return value as readonly Readonly<{ id?: unknown; name?: unknown }>[];
}
