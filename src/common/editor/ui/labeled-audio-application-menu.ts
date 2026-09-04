/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The Edit > Labeled audio submenu, ported from Audacity 3's La&beled Audio
 * menu (au3/src/menus/LabelMenus.cpp). Each entry edits the labels that lie
 * wholly inside the time selection, so the whole submenu is offered only when
 * the selection actually contains one.
 *
 * The submenu belongs to Soundscaper. Its wording is Audacity's audio wording
 * throughout, and Silence audio generates audio material, so Framescaper is
 * left to name a video equivalent of its own rather than inherit this one.
 */

export interface LabeledAudioApplicationMenuCopy {
	readonly labeledAudio: string;
	readonly labeledCut: string;
	readonly labeledDelete: string;
	readonly labeledCutLeaveGap: string;
	readonly labeledDeleteLeaveGap: string;
	readonly labeledSilence: string;
	readonly labeledCopy: string;
	readonly labeledSplit: string;
	readonly labeledJoin: string;
	readonly labeledDisjoin: string;
}

export interface LabeledAudioApplicationMenuInput {
	readonly productId: string;
	readonly copy: LabeledAudioApplicationMenuCopy;
	readonly editBlocked: boolean;
	readonly available: boolean;
}

export interface LabeledAudioApplicationMenuActions {
	executeEdit(action: string): unknown;
}

interface LabeledAudioApplicationMenuItem {
	readonly id: string;
	readonly label: string;
	readonly preserveLabel: true;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface LabeledAudioApplicationMenu {
	readonly id: 'labeled-audio';
	readonly label: string;
	readonly items: readonly LabeledAudioApplicationMenuItem[];
}

/*
 * The rows keep Audacity's short wording because the submenu already supplies
 * the context; the parity manifest carries the fully qualified command names
 * that command search and the parity report need, so each row is marked
 * preserveLabel rather than inheriting them.
 */
const ENTRIES = Object.freeze([
	['cut-labels', 'labeledCut'],
	['delete-labels', 'labeledDelete'],
	['split-cut-labels', 'labeledCutLeaveGap'],
	['split-delete-labels', 'labeledDeleteLeaveGap'],
	['silence-labels', 'labeledSilence'],
	['copy-labels', 'labeledCopy'],
	['split-labels', 'labeledSplit'],
	['join-labels', 'labeledJoin'],
	['disjoin-labels', 'labeledDisjoin'],
] as const);

/** Build the Labeled audio submenu in Audacity's order, for Soundscaper only. */
export function createLabeledAudioApplicationMenuItems(
	input: LabeledAudioApplicationMenuInput,
	actions: LabeledAudioApplicationMenuActions,
): readonly Readonly<LabeledAudioApplicationMenu>[] {
	if (input.productId !== 'soundscaper') return Object.freeze([]);
	const disabled = input.editBlocked || !input.available;
	return Object.freeze([Object.freeze({
		id: 'labeled-audio' as const,
		label: input.copy.labeledAudio,
		items: Object.freeze(ENTRIES.map(([id, key]) => Object.freeze({
			id,
			label: input.copy[key],
			preserveLabel: true as const,
			disabled,
			onClick: () => actions.executeEdit(key),
		}))),
	})]);
}
