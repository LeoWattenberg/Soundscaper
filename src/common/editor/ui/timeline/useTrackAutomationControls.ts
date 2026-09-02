/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	createTrackAutomationTargetInventoryV21,
	type TrackAutomationTargetV21,
} from '../../track-automation-targets-v21.ts';
import {
	createTrackAutomationControlsState,
	reconcileTrackAutomationControlsState,
	selectTrackAutomationTarget,
	trackAutomationSelectionContainsLane,
	toggleTrackAutomationControls,
} from './track-automation-controls-state.ts';
import type { TrackAutomationRuntime } from '../../track-automation-runtime.ts';

type ProjectRecord = Readonly<Record<string, unknown>>;

export interface TrackAutomationControlsModel {
	readonly visibleTrackIds: ReadonlySet<string>;
	readonly targetsByTrackId: ReadonlyMap<string, readonly TrackAutomationTargetV21[]>;
	readonly selectedTargetByTrackId: ReadonlyMap<string, TrackAutomationTargetV21>;
	isVisible(trackId: string): boolean;
	toggle(trackId: string): void;
	selectTarget(trackId: string, targetKey: string): void;
}

/** Keep header visibility local to this timeline while lane documents stay canonical. */
export function useTrackAutomationControls(
	project: ProjectRecord | null | undefined,
	enabled: boolean,
	runtime: Readonly<TrackAutomationRuntime> | null = null,
): TrackAutomationControlsModel {
	const [selectionByTrackId, setSelectionByTrackId] = useState(
		createTrackAutomationControlsState,
	);
	const projectIdentity = typeof project?.id === 'string' ? project.id : null;
	const projectIdentityRef = useRef(projectIdentity);
	const targetsByTrackId = useMemo(() => {
		const map = new Map<string, readonly TrackAutomationTargetV21[]>();
		if (!enabled || !Array.isArray(project?.tracks)) return map;
		for (const candidate of project.tracks) {
			if (!record(candidate) || candidate.type !== 'audio' || typeof candidate.id !== 'string') continue;
			map.set(candidate.id, createTrackAutomationTargetInventoryV21(project, candidate.id));
		}
		return map;
	}, [enabled, project]);
	useEffect(() => {
		if (projectIdentityRef.current !== projectIdentity) {
			projectIdentityRef.current = projectIdentity;
			if (runtime && runtime.snapshot.mode !== 'read') runtime.setMode('read', null);
			setSelectionByTrackId(createTrackAutomationControlsState());
			return;
		}
		const reconciled = reconcileTrackAutomationControlsState(
			selectionByTrackId, targetsByTrackId,
		);
		if (reconciled === selectionByTrackId) return;
		if (runtime && runtime.snapshot.mode !== 'read'
			&& !trackAutomationSelectionContainsLane(
				reconciled, targetsByTrackId, runtime.snapshot.laneId,
			)) {
			runtime.setMode('read', null);
		}
		setSelectionByTrackId(reconciled);
	}, [projectIdentity, runtime, selectionByTrackId, targetsByTrackId]);
	const visibleTrackIds = useMemo(
		() => new Set(Object.keys(selectionByTrackId)),
		[selectionByTrackId],
	);
	const selectedTargetByTrackId = useMemo(() => {
		const map = new Map<string, TrackAutomationTargetV21>();
		for (const [trackId, key] of Object.entries(selectionByTrackId)) {
			const selected = targetsByTrackId.get(trackId)?.find((target) => target.key === key);
			if (selected) map.set(trackId, selected);
		}
		return map;
	}, [selectionByTrackId, targetsByTrackId]);
	const toggle = useCallback((trackId: string) => {
		if (selectionByTrackId[trackId] && runtime && runtime.snapshot.mode !== 'read') {
			const selected = selectedTargetByTrackId.get(trackId);
			if (selected?.lane?.id === runtime.snapshot.laneId) runtime.setMode('read', null);
		}
		setSelectionByTrackId((current) => toggleTrackAutomationControls(
			current, trackId, targetsByTrackId.get(trackId) ?? [],
		));
	}, [runtime, selectedTargetByTrackId, selectionByTrackId, targetsByTrackId]);
	const selectTarget = useCallback((trackId: string, targetKey: string) => {
		setSelectionByTrackId((current) => selectTrackAutomationTarget(
			current, trackId, targetKey, targetsByTrackId.get(trackId) ?? [],
		));
	}, [targetsByTrackId]);
	const isVisible = useCallback(
		(trackId: string) => visibleTrackIds.has(trackId),
		[visibleTrackIds],
	);

	return useMemo(() => Object.freeze({
		visibleTrackIds,
		targetsByTrackId,
		selectedTargetByTrackId,
		isVisible,
		toggle,
		selectTarget,
	}), [isVisible, selectTarget, selectedTargetByTrackId, targetsByTrackId, toggle, visibleTrackIds]);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
