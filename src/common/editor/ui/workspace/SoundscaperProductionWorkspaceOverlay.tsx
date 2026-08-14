/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

import type { SessionLoudnessHistorySnapshot } from '../../production-audio/loudness-history-session.ts';
import type { StripMeterSnapshot } from '../../production-audio/strip-meter-session.ts';
import type { SoundscaperProductionWorkspaceRuntime } from './useSoundscaperProductionWorkspace.ts';
import { soundscaperProductionSurface } from './useSoundscaperProductionWorkspace.ts';

const SoundscaperProductionDialog = React.lazy(() => (
	import('../dialogs/SoundscaperProductionDialog.tsx')
));

interface WorkspaceOverlayModel {
	readonly activeSurface?: unknown;
	readonly capabilities: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly editBlocked: boolean;
	readonly productId: string;
	readonly run: (operation: () => unknown) => unknown;
	readonly setActiveSurface: (surface: string | null) => void;
	readonly snapshot: Readonly<{
		readonly project?: unknown;
		readonly meters?: unknown;
		readonly effects?: unknown;
		readonly selectedTrackId?: string | null;
		readonly readOnly?: boolean;
	}>;
	readonly soundscaperProduction?: Readonly<SoundscaperProductionWorkspaceRuntime> | null;
}

/** Lazy, menu-owned bridge from the shared workspace to the production dialog. */
export default function SoundscaperProductionWorkspaceOverlay({
	model,
}: Readonly<{ readonly model: WorkspaceOverlayModel }>) {
	const initialSurface = soundscaperProductionSurface(model.activeSurface);
	const runtime = model.soundscaperProduction;
	if (!initialSurface || !runtime || model.productId !== 'soundscaper') return null;
	const productionMeters = productionMeterTelemetry(model.snapshot.meters);
	return <div data-editor-surface="soundscaper-production">
		<React.Suspense fallback={<div role="status" aria-live="polite">{copyText(model.copy, 'loading', 'Loading project')}</div>}>
			<SoundscaperProductionDialog
				productId={model.productId}
				capabilities={{
					...model.capabilities,
					reviewedEffectPackages: runtime.reviewedPackagesAvailable,
				}}
					snapshot={{
					project: model.snapshot.project,
					selectedTrackId: model.snapshot.selectedTrackId,
					readOnly: model.snapshot.readOnly,
						editingBlocked: model.editBlocked,
						noiseProfileReady: noiseProfileReady(model.snapshot.effects),
						productionMeters: productionMeters.meters,
						loudnessHistory: productionMeters.loudnessHistory,
				}}
				initialSurface={initialSurface}
				automationMode={runtime.automationMode}
				copy={stringCopy(model.copy)}
				actions={{ execute: runtime.execute }}
				run={model.run}
				onClose={() => closeSoundscaperProductionWorkspace(
					model.setActiveSurface,
					runtime.restoreFocus,
				)}
			/>
		</React.Suspense>
	</div>;
}

export function closeSoundscaperProductionWorkspace(
	setActiveSurface: (surface: string | null) => void,
	restoreFocus: () => void,
): void {
	setActiveSurface(null);
	restoreFocus();
}

function noiseProfileReady(value: unknown): boolean {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& (value as Readonly<Record<string, unknown>>).noiseProfileReady === true);
}

function productionMeterTelemetry(value: unknown): Readonly<{
	readonly meters: readonly StripMeterSnapshot[];
	readonly loudnessHistory?: SessionLoudnessHistorySnapshot;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { meters: Object.freeze([]) };
	const record = value as Readonly<Record<string, unknown>>;
	return {
		meters: Array.isArray(record.productionMeters)
			? record.productionMeters as readonly StripMeterSnapshot[]
			: Object.freeze([]),
		...(record.productionLoudnessHistory && typeof record.productionLoudnessHistory === 'object'
			? { loudnessHistory: record.productionLoudnessHistory as SessionLoudnessHistorySnapshot }
			: {}),
	};
}

function stringCopy(value: Readonly<Record<string, unknown>>): Readonly<Record<string, string | undefined>> {
	return value as Readonly<Record<string, string | undefined>>;
}

function copyText(value: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
	return typeof value[key] === 'string' ? value[key] : fallback;
}
