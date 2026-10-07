/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, type RefObject } from 'react';
import { framesToSeconds } from '../../design-system-adapters/control-values.ts';

interface Track {
	readonly id: string;
	readonly type?: string;
	readonly displayMode?: string;
}

/** These document-derived values are independent from pointer and scroll publications. */
export function useTimelineTrackCounts(tracks: readonly Track[] | undefined, showArmControls: boolean,
	automationVisibleTrackIds: ReadonlySet<string> | null | undefined) {
	return useMemo(() => {
		let armedTrackCount = 0;
		let automationControlsTrackCount = 0;
		for (const track of tracks ?? []) {
			if (track.type !== 'audio') continue;
			if (showArmControls) armedTrackCount++;
			if (automationVisibleTrackIds?.has(track.id)) automationControlsTrackCount++;
		}
		return { armedTrackCount, automationControlsTrackCount };
	}, [tracks, showArmControls, automationVisibleTrackIds]);
}

export function useTimelineFrequencyRuler(tracks: readonly Track[] | undefined, visible: boolean, timelineView: string | undefined) {
	return useMemo(() => visible && tracks?.some(track => {
		if (track.type !== 'audio') return false;
		const mode = track.displayMode && track.displayMode !== 'waveform' ? track.displayMode : timelineView;
		return mode === 'spectrogram' || mode === 'multiview';
	}) === true, [tracks, timelineView, visible]);
}

export function useTimelineOutputDockContentHeight(outputs: readonly { readonly bus: { readonly collapsed?: boolean } }[],
	expandedHeight: number, collapsedHeight: number) {
	return useMemo(() => outputs.reduce((total, { bus }) => total + (bus.collapsed === false ? expandedHeight : collapsedHeight), 0),
	[outputs, expandedHeight, collapsedHeight]);
}

export function useTimelineTotalTrackHeight<T>(tracks: readonly T[] | undefined, visualTrackHeight: (track: T) => number,
	emptyHeight: number) {
	return useMemo(() => tracks?.reduce((total, track) => total + visualTrackHeight(track), 0) || emptyHeight,
	[tracks, visualTrackHeight, emptyHeight]);
}

export function useTimelineTimeSelection(selection: { readonly startFrame: number; readonly endFrame: number } | null | undefined,
	sampleRate: number) {
	const startFrame = selection?.startFrame;
	const endFrame = selection?.endFrame;
	return useMemo(() => startFrame !== undefined && endFrame !== undefined && endFrame > startFrame
		? { startTime: framesToSeconds(startFrame, { sampleRate }), endTime: framesToSeconds(endFrame, { sampleRate }) } : null,
	[startFrame, endFrame, sampleRate]);
}

export function useTimelineWaveformCacheMembership<Value>(cacheRef: RefObject<Map<string, Value>>, clipIds: ReadonlySet<string>): void {
	useEffect(() => {
		for (const id of cacheRef.current.keys()) if (!clipIds.has(id)) cacheRef.current.delete(id);
	}, [cacheRef, clipIds]);
}

interface DurationProject {
	readonly id?: string;
	readonly primarySequenceId?: string;
	readonly schemaVersion?: number;
	readonly schemaFamily?: string;
	readonly runtimeProjectionVersion?: number;
	readonly sampleRate?: number;
	readonly clips?: unknown;
	readonly tracks?: unknown;
	readonly tempoMap?: unknown;
	readonly sequences?: unknown;
}

export function useTimelineDocumentDuration<Project extends DurationProject>(project: Project | null, sampleRate: number,
	calculate: (project: Project, sampleRate: number) => number): number {
	const id = project?.id; const clips = project?.clips; const tracks = project?.tracks;
	const tempoMap = project?.tempoMap; const sequences = project?.sequences;
	const primarySequenceId = project?.primarySequenceId; const schemaVersion = project?.schemaVersion;
	const schemaFamily = project?.schemaFamily; const runtimeProjectionVersion = project?.runtimeProjectionVersion;
	const projectSampleRate = project?.sampleRate;
	return useMemo(() => project ? calculate(project, sampleRate) : sampleRate * 30,
		[id, clips, tracks, tempoMap, sequences, primarySequenceId, schemaVersion, schemaFamily,
			runtimeProjectionVersion, projectSampleRate, sampleRate, calculate, project === null]);
}
