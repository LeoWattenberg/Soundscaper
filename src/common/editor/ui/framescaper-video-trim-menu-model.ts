/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalEdgeTrimRequest } from '../frame-canonical-edge-trim-domain.ts';

export interface FramescaperVideoTrimMenuCopy {
	readonly trimLeftToPlayhead: string;
	readonly trimRightToPlayhead: string;
}

export interface FramescaperVideoTrimMenuInput {
	readonly productId: string;
	readonly selectedClipId: string | null;
	readonly playheadSample: number | null;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperVideoTrimMenuCopy;
}

export interface FramescaperVideoTrimMenuPlannerResult {
	readonly kind: 'noop' | 'transform';
}

export type FramescaperVideoTrimMenuPlanner = (
	request: FrameCanonicalEdgeTrimRequest,
) => Readonly<FramescaperVideoTrimMenuPlannerResult>;

export interface FramescaperVideoTrimMenuDependencies {
	planTrim: FramescaperVideoTrimMenuPlanner;
}

export interface FramescaperVideoTrimMenuItemModel {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly request: Readonly<FrameCanonicalEdgeTrimRequest> | null;
}

export interface FramescaperVideoTrimMenuModel {
	readonly left: Readonly<FramescaperVideoTrimMenuItemModel> | null;
	readonly right: Readonly<FramescaperVideoTrimMenuItemModel> | null;
}

export interface FramescaperVideoTrimMenuActions {
	commitTrim(request: FrameCanonicalEdgeTrimRequest): unknown;
}

export interface FramescaperVideoTrimApplicationMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface FramescaperVideoTrimMenuItems {
	readonly left: Readonly<FramescaperVideoTrimApplicationMenuItem> | null;
	readonly right: Readonly<FramescaperVideoTrimApplicationMenuItem> | null;
}

/** Delegate all geometric admissibility to the live controller planner. */
export function createFramescaperVideoTrimMenuModel(
	input: FramescaperVideoTrimMenuInput,
	dependencies: FramescaperVideoTrimMenuDependencies,
): Readonly<FramescaperVideoTrimMenuModel> {
	if (input.productId !== 'framescaper') return Object.freeze({ left: null, right: null });
	const inert = input.editingBlocked
		|| typeof input.selectedClipId !== 'string'
		|| input.selectedClipId.length === 0
		|| !Number.isSafeInteger(input.playheadSample)
		|| Number(input.playheadSample) < 0;
	return Object.freeze({
		left: modelItem(
			'trim-left-edge-to-playhead',
			input.copy.trimLeftToPlayhead,
			request(input, 'left', inert),
			dependencies.planTrim,
		),
		right: modelItem(
			'trim-right-edge-to-playhead',
			input.copy.trimRightToPlayhead,
			request(input, 'right', inert),
			dependencies.planTrim,
		),
	});
}

/** Bind one immutable menu render to the same live controller commit path. */
export function createFramescaperVideoTrimMenuItems(
	model: Readonly<FramescaperVideoTrimMenuModel>,
	actions: FramescaperVideoTrimMenuActions,
): Readonly<FramescaperVideoTrimMenuItems> {
	return Object.freeze({
		left: applicationMenuItem(model.left, actions),
		right: applicationMenuItem(model.right, actions),
	});
}

function request(
	input: FramescaperVideoTrimMenuInput,
	edge: 'left' | 'right',
	inert: boolean,
): Readonly<FrameCanonicalEdgeTrimRequest> | null {
	if (inert) return null;
	return Object.freeze({
		activeClipId: input.selectedClipId as string,
		edge,
		requestedBoundarySample: input.playheadSample as number,
	});
}

function modelItem(
	id: string,
	label: string,
	tentativeRequest: Readonly<FrameCanonicalEdgeTrimRequest> | null,
	planTrim: FramescaperVideoTrimMenuPlanner,
): Readonly<FramescaperVideoTrimMenuItemModel> {
	let enabledRequest: Readonly<FrameCanonicalEdgeTrimRequest> | null = null;
	if (tentativeRequest) {
		try {
			if (planTrim(tentativeRequest).kind === 'transform') enabledRequest = tentativeRequest;
		} catch {
			// A menu stays inert when the live controller refuses this boundary.
		}
	}
	return Object.freeze({ id, label, disabled: enabledRequest === null, request: enabledRequest });
}

function applicationMenuItem(
	item: Readonly<FramescaperVideoTrimMenuItemModel> | null,
	actions: FramescaperVideoTrimMenuActions,
): Readonly<FramescaperVideoTrimApplicationMenuItem> | null {
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
