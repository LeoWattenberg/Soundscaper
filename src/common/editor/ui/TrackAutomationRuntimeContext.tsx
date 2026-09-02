/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext, useContext, type ReactNode } from 'react';

import type { TrackAutomationRuntime } from '../track-automation-runtime.ts';

const TrackAutomationRuntimeContext = createContext<Readonly<TrackAutomationRuntime> | null>(null);

export function TrackAutomationRuntimeProvider({
	runtime,
	children,
}: Readonly<{
	runtime?: Readonly<TrackAutomationRuntime> | null;
	children: ReactNode;
}>) {
	return <TrackAutomationRuntimeContext.Provider value={runtime ?? null}>
		{children}
	</TrackAutomationRuntimeContext.Provider>;
}

export function useTrackAutomationRuntime(): Readonly<TrackAutomationRuntime> | null {
	return useContext(TrackAutomationRuntimeContext);
}
