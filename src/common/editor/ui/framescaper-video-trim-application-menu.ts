/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalEdgeTrimRequest } from '../frame-canonical-edge-trim-domain.ts';
import type { FrameCanonicalRollRippleTrimRequest } from '../frame-canonical-roll-ripple-trim-domain.ts';
import type { FrameCanonicalRateStretchRequest } from '../frame-canonical-rate-stretch-domain.ts';
import type { FrameCanonicalSlipSlideRequest } from '../frame-canonical-slip-slide-domain.ts';
import type { FrameCanonicalSlipSlideStep } from '../frame-canonical-slip-slide-step-request.ts';
import type { ApplicationMenuResolution } from './application-menu-materialization.ts';
import {
	createFramescaperRateStretchMenuItems,
	createFramescaperRateStretchMenuModel,
	type FramescaperRateStretchMenuCopy,
} from './framescaper-rate-stretch-menu-model.ts';
import type {
	FramescaperRollRippleTrimMenuCopy,
	FramescaperRollRippleTrimMenuPlannerResult,
} from './framescaper-roll-ripple-trim-menu-model.ts';
import {
	createFramescaperSlipSlideMenuItems,
	createFramescaperSlipSlideMenuModel,
	type FramescaperSlipSlideMenuCopy,
} from './framescaper-slip-slide-menu-model.ts';
import type {
	FramescaperVideoTrimMenuCopy,
	FramescaperVideoTrimMenuPlannerResult,
} from './framescaper-video-trim-menu-model.ts';

export interface FramescaperVideoTrimApplicationMenuCopy
	extends FramescaperVideoTrimMenuCopy,
		FramescaperRollRippleTrimMenuCopy,
		FramescaperSlipSlideMenuCopy,
		FramescaperRateStretchMenuCopy {}

export interface FramescaperVideoTrimApplicationMenuInput {
	readonly productId: string;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperVideoTrimApplicationMenuCopy;
	currentPlayheadSample(): number | null;
}

export interface FramescaperVideoTrimApplicationMenuActions {
	planVideoTrim(request: FrameCanonicalEdgeTrimRequest): Readonly<FramescaperVideoTrimMenuPlannerResult>;
	commitVideoTrim(request: FrameCanonicalEdgeTrimRequest): unknown;
	planVideoRollRippleTrim(
		request: FrameCanonicalRollRippleTrimRequest,
	): Readonly<FramescaperRollRippleTrimMenuPlannerResult>;
	commitVideoRollRippleTrim(request: FrameCanonicalRollRippleTrimRequest): unknown;
	buildVideoSlipSlideStepRequest(
		step: FrameCanonicalSlipSlideStep,
	): Readonly<FrameCanonicalSlipSlideRequest>;
	planVideoSlipSlide(
		request: FrameCanonicalSlipSlideRequest,
	): Readonly<{ readonly kind: 'noop' | 'transform' }>;
	commitVideoSlipSlide(request: FrameCanonicalSlipSlideRequest): unknown;
	planVideoRateStretch(
		request: FrameCanonicalRateStretchRequest,
	): Readonly<{ readonly kind: 'noop' | 'transform' }>;
	commitVideoRateStretch(request: FrameCanonicalRateStretchRequest): unknown;
}

export interface FramescaperVideoTrimApplicationMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	resolve(): Readonly<ApplicationMenuResolution>;
	onClick(): unknown;
}

/** Keep exact trim leaves searchable while deferring geometry until menu open. */
export function createFramescaperVideoTrimApplicationMenuItems(
	input: FramescaperVideoTrimApplicationMenuInput,
	actions: FramescaperVideoTrimApplicationMenuActions,
): readonly Readonly<FramescaperVideoTrimApplicationMenuItem>[] {
	if (input.productId !== 'framescaper') return Object.freeze([]);
	const inert = input.editingBlocked
		|| typeof input.selectedClipId !== 'string'
		|| input.selectedClipId.length === 0;
	const slipSlideItems = createFramescaperSlipSlideMenuItems(
		createFramescaperSlipSlideMenuModel(input, {
			buildStepRequest: actions.buildVideoSlipSlideStepRequest,
			planSlipSlide: actions.planVideoSlipSlide,
		}),
		{ commitSlipSlide: actions.commitVideoSlipSlide },
	);
	const rateStretchItems = createFramescaperRateStretchMenuItems(
		createFramescaperRateStretchMenuModel(input, {
			planRateStretch: actions.planVideoRateStretch,
		}),
		{ commitRateStretch: actions.commitVideoRateStretch },
	);
	return Object.freeze([
		edgeItem(input, actions, inert, 'left'),
		edgeItem(input, actions, inert, 'right'),
		rollRippleItem(input, actions, inert, 'roll', 'left'),
		rollRippleItem(input, actions, inert, 'roll', 'right'),
		rollRippleItem(input, actions, inert, 'ripple', 'left'),
		rollRippleItem(input, actions, inert, 'ripple', 'right'),
		...slipSlideItems,
		...rateStretchItems,
	]);
}

function edgeItem(
	input: FramescaperVideoTrimApplicationMenuInput,
	actions: FramescaperVideoTrimApplicationMenuActions,
	inert: boolean,
	edge: 'left' | 'right',
): Readonly<FramescaperVideoTrimApplicationMenuItem> {
	return Object.freeze({
		id: `trim-${edge}-edge-to-playhead`,
		label: edge === 'left' ? input.copy.trimLeftToPlayhead : input.copy.trimRightToPlayhead,
		disabled: inert,
		resolve: () => resolvePlan(inert, () => {
			const request = edgeRequest(input, edge);
			return request === null ? null : actions.planVideoTrim(request);
		}),
		onClick: () => {
			if (inert) return undefined;
			const request = edgeRequest(input, edge);
			return request === null ? undefined : actions.commitVideoTrim(request);
		},
	});
}

function rollRippleItem(
	input: FramescaperVideoTrimApplicationMenuInput,
	actions: FramescaperVideoTrimApplicationMenuActions,
	inert: boolean,
	mode: 'roll' | 'ripple',
	edge: 'left' | 'right',
): Readonly<FramescaperVideoTrimApplicationMenuItem> {
	const label = mode === 'roll'
		? edge === 'left' ? input.copy.rollLeftToPlayhead : input.copy.rollRightToPlayhead
		: edge === 'left' ? input.copy.rippleLeftToPlayhead : input.copy.rippleRightToPlayhead;
	return Object.freeze({
		id: `${mode}-${edge}-edge-to-playhead`,
		label,
		disabled: inert,
		resolve: () => resolvePlan(inert, () => {
			const request = rollRippleRequest(input, mode, edge);
			return request === null ? null : actions.planVideoRollRippleTrim(request);
		}),
		onClick: () => {
			if (inert) return undefined;
			const request = rollRippleRequest(input, mode, edge);
			return request === null ? undefined : actions.commitVideoRollRippleTrim(request);
		},
	});
}

function edgeRequest(
	input: FramescaperVideoTrimApplicationMenuInput,
	edge: 'left' | 'right',
): Readonly<FrameCanonicalEdgeTrimRequest> | null {
	const requestedBoundarySample = livePlayheadSample(input);
	if (requestedBoundarySample === null) return null;
	return Object.freeze({
		activeClipId: input.selectedClipId as string,
		edge,
		requestedBoundarySample,
	});
}

function rollRippleRequest(
	input: FramescaperVideoTrimApplicationMenuInput,
	mode: 'roll' | 'ripple',
	edge: 'left' | 'right',
): Readonly<FrameCanonicalRollRippleTrimRequest> | null {
	const requestedBoundarySample = livePlayheadSample(input);
	if (requestedBoundarySample === null) return null;
	return Object.freeze({
		mode,
		activeClipId: input.selectedClipId as string,
		edge,
		requestedBoundarySample,
	});
}

function livePlayheadSample(input: FramescaperVideoTrimApplicationMenuInput): number | null {
	const value = input.currentPlayheadSample();
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function resolvePlan(
	inert: boolean,
	plan: () => Readonly<FramescaperVideoTrimMenuPlannerResult>
		| Readonly<FramescaperRollRippleTrimMenuPlannerResult> | null,
): Readonly<ApplicationMenuResolution> {
	if (inert) return DISABLED_RESOLUTION;
	try {
		return plan()?.kind === 'transform' ? ENABLED_RESOLUTION : DISABLED_RESOLUTION;
	} catch {
		return DISABLED_RESOLUTION;
	}
}

const ENABLED_RESOLUTION = Object.freeze({ disabled: false });
const DISABLED_RESOLUTION = Object.freeze({ disabled: true });
