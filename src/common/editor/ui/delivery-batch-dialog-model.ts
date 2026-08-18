/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DeliveryBatchTarget } from '../delivery-batch.ts';
import type {
	DocumentMasteringSequenceDocumentSnapshot,
} from '../controller/document-mastering-sequence-snapshot.ts';

/**
 * What a batch can deliver from *this* document, right now.
 *
 * The targets a batch may name are a property of the project, not of the dialog:
 * a loop that is not enabled and a region that was deleted are the same kind of
 * absence, and both belong in one place so the surface and the batch builder
 * cannot disagree about what exists. An unavailable target is listed with its
 * reason rather than dropped, so "why can I not deliver the loop" is answerable
 * from the dialog.
 */

export interface DeliveryBatchTargetOption {
	readonly key: string;
	readonly label: string;
	readonly target: DeliveryBatchTarget;
	readonly available: boolean;
	/** Why this target cannot deliver at all, when it cannot. */
	readonly reason: string | null;
	/** False when this target is a spliced artifact that stems cannot express. */
	readonly stemmable: boolean;
	/** Shown in place of the label's availability when a stems batch excludes it. */
	readonly stemsReason: string | null;
}

export interface DeliveryBatchTargetCopy {
	readonly entireProject: string;
	readonly currentSelection: string;
	readonly loopRegion: string;
	readonly noSelection: string;
	readonly noLoop: string;
	readonly undeliverableSequence: string;
	readonly stemsUnsupported: string;
}

export interface DeliveryBatchTargetInput {
	readonly hasSelection: boolean;
	readonly hasLoop: boolean;
	readonly masteringSequences?: DocumentMasteringSequenceDocumentSnapshot | null;
}

/** Every target this project offers, available or not, in a stable order. */
export function deliveryBatchTargetOptions(
	input: DeliveryBatchTargetInput,
	copy: DeliveryBatchTargetCopy,
): readonly DeliveryBatchTargetOption[] {
	const options: DeliveryBatchTargetOption[] = [
		option('project', copy.entireProject, { kind: 'project' }, true, null),
		option('selection', copy.currentSelection, { kind: 'selection' },
			input.hasSelection, input.hasSelection ? null : copy.noSelection),
		option('loop', copy.loopRegion, { kind: 'loop' },
			input.hasLoop, input.hasLoop ? null : copy.noLoop),
	];
	for (const region of input.masteringSequences?.regions ?? []) {
		options.push(option(`region:${region.id}`, region.name, { kind: 'region', id: region.id }, true, null));
	}
	for (const sequence of input.masteringSequences?.sequences ?? []) {
		options.push(option(
			`mastering-sequence:${sequence.id}`,
			sequence.name,
			{ kind: 'mastering-sequence', id: sequence.id },
			sequence.deliverable,
			sequence.deliverable ? null : copy.undeliverableSequence,
			// A sequence is one spliced artifact; stems of it would each have to be
			// spliced the same way and would stop summing to it.
			false,
			copy.stemsUnsupported,
		));
	}
	return Object.freeze(options);
}

/**
 * The targets a batch in this mode may actually use.
 *
 * Filtering here rather than in the builder is what lets the dialog grey out a
 * target instead of offering it and then refusing the batch it produces.
 */
export function selectableDeliveryBatchTargets(
	options: readonly DeliveryBatchTargetOption[],
	mode: 'mix' | 'stems',
): readonly DeliveryBatchTargetOption[] {
	return Object.freeze(options.filter((candidate) => (
		candidate.available && (mode === 'mix' || candidate.stemmable)
	)));
}

function option(
	key: string,
	label: string,
	target: DeliveryBatchTarget,
	available: boolean,
	reason: string | null,
	stemmable = true,
	stemsReason = '',
): DeliveryBatchTargetOption {
	return Object.freeze({
		key,
		label,
		target: Object.freeze(target),
		available,
		reason,
		stemmable,
		stemsReason: stemmable ? null : stemsReason || null,
	});
}
