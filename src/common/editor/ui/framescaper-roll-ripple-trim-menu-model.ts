/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalRollRippleTrimRequest } from '../frame-canonical-roll-ripple-trim-domain.ts';

export interface FramescaperRollRippleTrimMenuCopy {
	readonly rollLeftToPlayhead: string;
	readonly rollRightToPlayhead: string;
	readonly rippleLeftToPlayhead: string;
	readonly rippleRightToPlayhead: string;
}

export interface FramescaperRollRippleTrimMenuInput {
	readonly productId: string;
	readonly selectedClipId: string | null;
	readonly playheadSample: number | null;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperRollRippleTrimMenuCopy;
}

export interface FramescaperRollRippleTrimMenuPlannerResult {
	readonly kind: 'noop' | 'transform';
}

export type FramescaperRollRippleTrimMenuPlanner = (
	request: FrameCanonicalRollRippleTrimRequest,
) => Readonly<FramescaperRollRippleTrimMenuPlannerResult>;

export interface FramescaperRollRippleTrimMenuDependencies {
	planTrim: FramescaperRollRippleTrimMenuPlanner;
}

export interface FramescaperRollRippleTrimMenuItemModel {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly request: Readonly<FrameCanonicalRollRippleTrimRequest> | null;
}

export interface FramescaperRollRippleTrimMenuModel {
	readonly rollLeft: Readonly<FramescaperRollRippleTrimMenuItemModel> | null;
	readonly rollRight: Readonly<FramescaperRollRippleTrimMenuItemModel> | null;
	readonly rippleLeft: Readonly<FramescaperRollRippleTrimMenuItemModel> | null;
	readonly rippleRight: Readonly<FramescaperRollRippleTrimMenuItemModel> | null;
}

export interface FramescaperRollRippleTrimMenuActions {
	commitTrim(request: FrameCanonicalRollRippleTrimRequest): unknown;
}

export interface FramescaperRollRippleTrimApplicationMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface FramescaperRollRippleTrimMenuItems {
	readonly rollLeft: Readonly<FramescaperRollRippleTrimApplicationMenuItem> | null;
	readonly rollRight: Readonly<FramescaperRollRippleTrimApplicationMenuItem> | null;
	readonly rippleLeft: Readonly<FramescaperRollRippleTrimApplicationMenuItem> | null;
	readonly rippleRight: Readonly<FramescaperRollRippleTrimApplicationMenuItem> | null;
}

/** Keep menu admissibility subordinate to four exact live planner requests. */
export function createFramescaperRollRippleTrimMenuModel(
	input: FramescaperRollRippleTrimMenuInput,
	dependencies: FramescaperRollRippleTrimMenuDependencies,
): Readonly<FramescaperRollRippleTrimMenuModel> {
	if (input.productId !== 'framescaper') return emptyModel();
	const inert = input.editingBlocked
		|| typeof input.selectedClipId !== 'string'
		|| input.selectedClipId.length === 0
		|| !Number.isSafeInteger(input.playheadSample)
		|| Number(input.playheadSample) < 0;
	return Object.freeze({
		rollLeft: modelItem(
			'roll-left-edge-to-playhead', input.copy.rollLeftToPlayhead,
			request(input, 'roll', 'left', inert), dependencies.planTrim,
		),
		rollRight: modelItem(
			'roll-right-edge-to-playhead', input.copy.rollRightToPlayhead,
			request(input, 'roll', 'right', inert), dependencies.planTrim,
		),
		rippleLeft: modelItem(
			'ripple-left-edge-to-playhead', input.copy.rippleLeftToPlayhead,
			request(input, 'ripple', 'left', inert), dependencies.planTrim,
		),
		rippleRight: modelItem(
			'ripple-right-edge-to-playhead', input.copy.rippleRightToPlayhead,
			request(input, 'ripple', 'right', inert), dependencies.planTrim,
		),
	});
}

/** Bind an immutable menu render to the corresponding controller commit port. */
export function createFramescaperRollRippleTrimMenuItems(
	model: Readonly<FramescaperRollRippleTrimMenuModel>,
	actions: FramescaperRollRippleTrimMenuActions,
): Readonly<FramescaperRollRippleTrimMenuItems> {
	return Object.freeze({
		rollLeft: applicationMenuItem(model.rollLeft, actions),
		rollRight: applicationMenuItem(model.rollRight, actions),
		rippleLeft: applicationMenuItem(model.rippleLeft, actions),
		rippleRight: applicationMenuItem(model.rippleRight, actions),
	});
}

function request(
	input: FramescaperRollRippleTrimMenuInput,
	mode: 'roll' | 'ripple',
	edge: 'left' | 'right',
	inert: boolean,
): Readonly<FrameCanonicalRollRippleTrimRequest> | null {
	if (inert) return null;
	return Object.freeze({
		mode,
		activeClipId: input.selectedClipId as string,
		edge,
		requestedBoundarySample: input.playheadSample as number,
	});
}

function modelItem(
	id: string,
	label: string,
	tentativeRequest: Readonly<FrameCanonicalRollRippleTrimRequest> | null,
	planTrim: FramescaperRollRippleTrimMenuPlanner,
): Readonly<FramescaperRollRippleTrimMenuItemModel> {
	let enabledRequest: Readonly<FrameCanonicalRollRippleTrimRequest> | null = null;
	if (tentativeRequest) {
		try {
			if (planTrim(tentativeRequest).kind === 'transform') enabledRequest = tentativeRequest;
		} catch {
			// A refused live plan leaves only this exact menu action inert.
		}
	}
	return Object.freeze({ id, label, disabled: enabledRequest === null, request: enabledRequest });
}

function applicationMenuItem(
	item: Readonly<FramescaperRollRippleTrimMenuItemModel> | null,
	actions: FramescaperRollRippleTrimMenuActions,
): Readonly<FramescaperRollRippleTrimApplicationMenuItem> | null {
	if (item === null) return null;
	return Object.freeze({
		id: item.id,
		label: item.label,
		disabled: item.disabled,
		onClick: () => item.disabled || !item.request
			? undefined
			: actions.commitTrim(item.request),
	});
}

function emptyModel(): Readonly<FramescaperRollRippleTrimMenuModel> {
	return Object.freeze({
		rollLeft: null,
		rollRight: null,
		rippleLeft: null,
		rippleRight: null,
	});
}
