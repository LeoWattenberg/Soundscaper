/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ChangeEvent } from 'react';

import {
	normalizeTrackAutomationMode,
	TRACK_AUTOMATION_MODES,
	trackAutomationModeForLane,
	type TrackAutomationRuntime,
} from '../../track-automation-runtime.ts';
import type { TrackAutomationTargetV21 } from '../../track-automation-targets-v21.ts';

export interface TrackAutomationSelectorsProps {
	readonly trackId: string;
	readonly targets: readonly TrackAutomationTargetV21[];
	readonly selectedTarget: TrackAutomationTargetV21;
	readonly runtime?: Readonly<TrackAutomationRuntime> | null;
	readonly disabled?: boolean;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly onTarget: (targetKey: string) => void;
}

export function TrackAutomationSelectors({
	trackId,
	targets,
	selectedTarget,
	runtime = null,
	disabled = false,
	copy,
	onTarget,
}: TrackAutomationSelectorsProps) {
	const laneId = selectedTarget.lane?.id ?? null;
	const mode = trackAutomationModeForLane(runtime, laneId);
	const activeGesture = runtime?.snapshot.gestureActive === true
		&& runtime.snapshot.laneId === laneId;
	const groups = groupTargets(targets);
	const targetLabel = copy.automationParameter || 'Automation parameter';
	const modeLabel = copy.automationMode || 'Automation mode';
	const selectTarget = (event: ChangeEvent<HTMLSelectElement>) => {
		if (runtime && runtime.snapshot.mode !== 'read') runtime.setMode('read', null);
		onTarget(event.currentTarget.value);
	};

	return (
		<div
			className="audio-editor-track-automation"
			data-track-automation-controls
			data-track-id={trackId}
		>
			<label>
				<span className="kw-audio-editor-sr-only">{targetLabel}</span>
				<select
					aria-label={targetLabel}
					value={selectedTarget.key}
					disabled={activeGesture}
					onChange={selectTarget}
				>
					{groups.map(({ label, targets: groupTargetsValue }) => (
						<optgroup key={label} label={label}>
							{groupTargetsValue.map((target) => (
								<option
									key={target.key}
									value={target.key}
									disabled={Boolean(target.disabledReason)}
								>
									{target.label}{target.disabledReason ? ` — ${target.disabledReason}` : ''}
								</option>
							))}
						</optgroup>
					))}
				</select>
			</label>
			<label>
				<span className="kw-audio-editor-sr-only">{modeLabel}</span>
				<select
					aria-label={modeLabel}
					value={mode}
					disabled={disabled || activeGesture || !runtime || Boolean(selectedTarget.disabledReason)}
					onChange={(event) => runtime?.setMode(
						normalizeTrackAutomationMode(event.currentTarget.value), laneId,
					)}
				>
					{TRACK_AUTOMATION_MODES.map((candidate) => (
						<option key={candidate} value={candidate} disabled={candidate !== 'read' && !laneId}>
							{modeCopy(copy, candidate)}
						</option>
					))}
				</select>
			</label>
		</div>
	);
}

function groupTargets(targets: readonly TrackAutomationTargetV21[]): readonly Readonly<{
	label: string;
	targets: readonly TrackAutomationTargetV21[];
}>[] {
	const groups = new Map<string, TrackAutomationTargetV21[]>();
	for (const target of targets) {
		const entries = groups.get(target.groupLabel) ?? [];
		entries.push(target);
		groups.set(target.groupLabel, entries);
	}
	return [...groups].map(([label, groupedTargets]) => Object.freeze({
		label,
		targets: Object.freeze(groupedTargets),
	}));
}

function modeCopy(
	copy: Readonly<Record<string, string | undefined>>,
	mode: typeof TRACK_AUTOMATION_MODES[number],
): string {
	const key = `automation${mode[0]!.toUpperCase()}${mode.slice(1)}`;
	return copy[key] || `${mode[0]!.toUpperCase()}${mode.slice(1)}`;
}
