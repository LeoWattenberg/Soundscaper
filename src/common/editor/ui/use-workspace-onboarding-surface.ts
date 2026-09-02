/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

import { isFirstLaunchSetupComplete, type FirstLaunchSetupStorage } from './first-launch-setup.ts';

export const WORKSPACE_ONBOARDING_SURFACE = 'workspace-onboarding';

export interface WorkspaceOnboardingOfferState {
	readonly productId: string;
	readonly phase: string;
	readonly initialSurface: string | null | undefined;
	readonly takeCycleRecovery: unknown;
	readonly activeSurface: string | null | undefined;
	readonly setupComplete: boolean;
}

export interface WorkspaceOnboardingSurfaceOptions extends Omit<WorkspaceOnboardingOfferState, 'setupComplete'> {
	readonly setActiveSurface: (surface: string | null) => void;
	/** Test seam; the browser default is `localStorage`. */
	readonly storage?: FirstLaunchSetupStorage | null;
}

/**
 * The chooser only ever appears on a ready Soundscaper session with nothing
 * else in front of it: a routed surface, a pending take-cycle decision or an
 * already-open dialog all take precedence, and a finished setup silences it.
 */
export function shouldOfferWorkspaceOnboarding(state: WorkspaceOnboardingOfferState): boolean {
	return state.productId === 'soundscaper'
		&& state.phase === 'ready'
		&& !state.initialSurface
		&& !state.takeCycleRecovery
		&& !state.activeSurface
		&& !state.setupComplete;
}

/** Offer the first-launch chooser at most once per session. */
export function useWorkspaceOnboardingSurface({
	productId,
	phase,
	initialSurface,
	takeCycleRecovery,
	activeSurface,
	setActiveSurface,
	storage,
}: WorkspaceOnboardingSurfaceOptions): void {
	const offered = useRef(false);
	useEffect(() => {
		if (offered.current) return;
		if (!shouldOfferWorkspaceOnboarding({
			productId,
			phase,
			initialSurface,
			takeCycleRecovery,
			activeSurface,
			setupComplete: isFirstLaunchSetupComplete(productId, storage),
		})) return;
		offered.current = true;
		setActiveSurface(WORKSPACE_ONBOARDING_SURFACE);
	}, [activeSurface, initialSurface, phase, productId, setActiveSurface, storage, takeCycleRecovery]);
}
