/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalRateStretchRequest } from '../frame-canonical-rate-stretch-domain.ts';
import type { ApplicationMenuResolution } from './application-menu-materialization.ts';

export interface FramescaperRateStretchMenuCopy {
	readonly rateStretchLeftToPlayhead: string;
	readonly rateStretchRightToPlayhead: string;
}

export interface FramescaperRateStretchMenuInput {
	readonly productId: string;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperRateStretchMenuCopy;
	currentPlayheadSample(): number | null;
}

export interface FramescaperRateStretchMenuPlannerResult {
	readonly kind: 'noop' | 'transform';
}

export interface FramescaperRateStretchMenuDependencies {
	planRateStretch(
		request: FrameCanonicalRateStretchRequest,
	): Readonly<FramescaperRateStretchMenuPlannerResult>;
}

export interface FramescaperRateStretchMenuItemModel {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	resolve(): Readonly<ApplicationMenuResolution>;
}

export interface FramescaperRateStretchMenuModel {
	readonly left: Readonly<FramescaperRateStretchMenuItemModel> | null;
	readonly right: Readonly<FramescaperRateStretchMenuItemModel> | null;
}

export interface FramescaperRateStretchMenuActions {
	commitRateStretch(request: FrameCanonicalRateStretchRequest): unknown;
}

export interface FramescaperRateStretchApplicationMenuItem
	extends FramescaperRateStretchMenuItemModel {
	onClick(): unknown;
}

interface LazyItemState {
	buildRequest(): Readonly<FrameCanonicalRateStretchRequest> | null;
}

const ITEM_STATE = new WeakMap<object, LazyItemState>();

/** Expose menu-only rate stretch while deferring the live playhead read until use. */
export function createFramescaperRateStretchMenuModel(
	input: FramescaperRateStretchMenuInput,
	dependencies: FramescaperRateStretchMenuDependencies,
): Readonly<FramescaperRateStretchMenuModel> {
	if (input.productId !== 'framescaper') return emptyModel();
	const inert = input.editingBlocked
		|| typeof input.selectedClipId !== 'string'
		|| input.selectedClipId.length === 0;
	return Object.freeze({
		left: lazyItem(
			'rate-stretch-left-edge-to-playhead', input.copy.rateStretchLeftToPlayhead,
			'left', input, inert, dependencies,
		),
		right: lazyItem(
			'rate-stretch-right-edge-to-playhead', input.copy.rateStretchRightToPlayhead,
			'right', input, inert, dependencies,
		),
	});
}

/** Bind each leaf to a fresh absolute request for Search, shortcut, and menu activation. */
export function createFramescaperRateStretchMenuItems(
	model: Readonly<FramescaperRateStretchMenuModel>,
	actions: FramescaperRateStretchMenuActions,
): readonly Readonly<FramescaperRateStretchApplicationMenuItem>[] {
	return Object.freeze([model.left, model.right].flatMap((item) => (
		item === null ? [] : [bindItem(item, actions)]
	)));
}

function lazyItem(
	id: string,
	label: string,
	edge: 'left' | 'right',
	input: FramescaperRateStretchMenuInput,
	inert: boolean,
	dependencies: FramescaperRateStretchMenuDependencies,
): Readonly<FramescaperRateStretchMenuItemModel> {
	const state: LazyItemState = { buildRequest: () => request(input, edge, inert) };
	const item = Object.freeze({
		id,
		label,
		disabled: inert,
		resolve: (): Readonly<ApplicationMenuResolution> => {
			if (inert) return DISABLED_RESOLUTION;
			try {
				const tentativeRequest = state.buildRequest();
				return tentativeRequest !== null
					&& dependencies.planRateStretch(tentativeRequest).kind === 'transform'
					? ENABLED_RESOLUTION
					: DISABLED_RESOLUTION;
			} catch {
				return DISABLED_RESOLUTION;
			}
		},
	});
	ITEM_STATE.set(item, state);
	return item;
}

function bindItem(
	item: Readonly<FramescaperRateStretchMenuItemModel>,
	actions: FramescaperRateStretchMenuActions,
): Readonly<FramescaperRateStretchApplicationMenuItem> {
	const state = ITEM_STATE.get(item);
	return Object.freeze({
		id: item.id,
		label: item.label,
		disabled: item.disabled,
		resolve: item.resolve,
		onClick: () => {
			if (item.disabled || !state) return undefined;
			const freshRequest = state.buildRequest();
			return freshRequest === null ? undefined : actions.commitRateStretch(freshRequest);
		},
	});
}

function request(
	input: FramescaperRateStretchMenuInput,
	edge: 'left' | 'right',
	inert: boolean,
): Readonly<FrameCanonicalRateStretchRequest> | null {
	if (inert) return null;
	const requestedBoundarySample = input.currentPlayheadSample();
	if (!Number.isSafeInteger(requestedBoundarySample) || Number(requestedBoundarySample) < 0) return null;
	return Object.freeze({
		activeClipId: input.selectedClipId as string,
		edge,
		requestedBoundarySample: Number(requestedBoundarySample),
	});
}

function emptyModel(): Readonly<FramescaperRateStretchMenuModel> {
	return Object.freeze({ left: null, right: null });
}

const ENABLED_RESOLUTION = Object.freeze({ disabled: false });
const DISABLED_RESOLUTION = Object.freeze({ disabled: true });
