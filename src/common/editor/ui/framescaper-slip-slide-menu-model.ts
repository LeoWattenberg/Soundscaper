/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalSlipSlideRequest,
} from '../frame-canonical-slip-slide-domain.ts';
import type {
	FrameCanonicalSlipSlideStep,
} from '../frame-canonical-slip-slide-step-request.ts';
import type { ApplicationMenuResolution } from './application-menu-materialization.ts';

export interface FramescaperSlipSlideMenuCopy {
	readonly slipSourceEarlierOneFrame: string;
	readonly slipSourceLaterOneFrame: string;
	readonly slideClipEarlierOneFrame: string;
	readonly slideClipLaterOneFrame: string;
}

export interface FramescaperSlipSlideMenuInput {
	readonly productId: string;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperSlipSlideMenuCopy;
}

export interface FramescaperSlipSlideMenuPlannerResult {
	readonly kind: 'noop' | 'transform';
}

export type FramescaperSlipSlideStepRequestBuilder = (
	step: FrameCanonicalSlipSlideStep,
) => Readonly<FrameCanonicalSlipSlideRequest>;

export type FramescaperSlipSlideMenuPlanner = (
	request: FrameCanonicalSlipSlideRequest,
) => Readonly<FramescaperSlipSlideMenuPlannerResult>;

export interface FramescaperSlipSlideMenuDependencies {
	buildStepRequest: FramescaperSlipSlideStepRequestBuilder;
	planSlipSlide: FramescaperSlipSlideMenuPlanner;
}

export interface FramescaperSlipSlideMenuItemModel {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	resolve(): Readonly<ApplicationMenuResolution>;
}

export interface FramescaperSlipSlideMenuModel {
	readonly slipEarlier: Readonly<FramescaperSlipSlideMenuItemModel> | null;
	readonly slipLater: Readonly<FramescaperSlipSlideMenuItemModel> | null;
	readonly slideEarlier: Readonly<FramescaperSlipSlideMenuItemModel> | null;
	readonly slideLater: Readonly<FramescaperSlipSlideMenuItemModel> | null;
}

export interface FramescaperSlipSlideMenuActions {
	commitSlipSlide(request: FrameCanonicalSlipSlideRequest): unknown;
}

export interface FramescaperSlipSlideApplicationMenuItem
	extends FramescaperSlipSlideMenuItemModel {
	onClick(): unknown;
}

interface LazyItemState {
	request: Readonly<FrameCanonicalSlipSlideRequest> | null;
}

const ITEM_STATE = new WeakMap<object, LazyItemState>();

/** Create four discoverable Framescaper leaves while deferring authority reads until menu open. */
export function createFramescaperSlipSlideMenuModel(
	input: FramescaperSlipSlideMenuInput,
	dependencies: FramescaperSlipSlideMenuDependencies,
): Readonly<FramescaperSlipSlideMenuModel> {
	if (input.productId !== 'framescaper') return emptyModel();
	const inert = input.editingBlocked
		|| typeof input.selectedClipId !== 'string'
		|| input.selectedClipId.length === 0;
	const activeClipId = inert ? '' : input.selectedClipId as string;
	return Object.freeze({
		slipEarlier: lazyItem(
			'slip-source-earlier-one-frame', input.copy.slipSourceEarlierOneFrame,
			{ mode: 'slip', activeClipId, direction: 'earlier' }, inert, dependencies,
		),
		slipLater: lazyItem(
			'slip-source-later-one-frame', input.copy.slipSourceLaterOneFrame,
			{ mode: 'slip', activeClipId, direction: 'later' }, inert, dependencies,
		),
		slideEarlier: lazyItem(
			'slide-clip-earlier-one-frame', input.copy.slideClipEarlierOneFrame,
			{ mode: 'slide', activeClipId, direction: 'earlier' }, inert, dependencies,
		),
		slideLater: lazyItem(
			'slide-clip-later-one-frame', input.copy.slideClipLaterOneFrame,
			{ mode: 'slide', activeClipId, direction: 'later' }, inert, dependencies,
		),
	});
}

/** Bind activation to the exact request retained by the latest successful lazy resolution. */
export function createFramescaperSlipSlideMenuItems(
	model: Readonly<FramescaperSlipSlideMenuModel>,
	actions: FramescaperSlipSlideMenuActions,
): readonly Readonly<FramescaperSlipSlideApplicationMenuItem>[] {
	return Object.freeze([
		model.slipEarlier,
		model.slipLater,
		model.slideEarlier,
		model.slideLater,
	].flatMap((item) => item === null ? [] : [bindItem(item, actions)]));
}

function lazyItem(
	id: string,
	label: string,
	stepValue: FrameCanonicalSlipSlideStep,
	inert: boolean,
	dependencies: FramescaperSlipSlideMenuDependencies,
): Readonly<FramescaperSlipSlideMenuItemModel> {
	const state: LazyItemState = { request: null };
	const step = Object.freeze({ ...stepValue });
	const item = Object.freeze({
		id,
		label,
		disabled: inert,
		resolve: (): Readonly<ApplicationMenuResolution> => {
			state.request = null;
			if (inert) return DISABLED_RESOLUTION;
			try {
				const request = dependencies.buildStepRequest(step);
				if (dependencies.planSlipSlide(request).kind !== 'transform') {
					return DISABLED_RESOLUTION;
				}
				state.request = request;
				return ENABLED_RESOLUTION;
			} catch {
				return DISABLED_RESOLUTION;
			}
		},
	});
	ITEM_STATE.set(item, state);
	return item;
}

function bindItem(
	item: Readonly<FramescaperSlipSlideMenuItemModel>,
	actions: FramescaperSlipSlideMenuActions,
): Readonly<FramescaperSlipSlideApplicationMenuItem> {
	const state = ITEM_STATE.get(item);
	return Object.freeze({
		id: item.id,
		label: item.label,
		disabled: item.disabled,
		resolve: item.resolve,
		onClick: () => {
			const request = state?.request;
			return request === null || request === undefined
				? undefined
				: actions.commitSlipSlide(request);
		},
	});
}

function emptyModel(): Readonly<FramescaperSlipSlideMenuModel> {
	return Object.freeze({
		slipEarlier: null,
		slipLater: null,
		slideEarlier: null,
		slideLater: null,
	});
}

const ENABLED_RESOLUTION = Object.freeze({ disabled: false });
const DISABLED_RESOLUTION = Object.freeze({ disabled: true });
