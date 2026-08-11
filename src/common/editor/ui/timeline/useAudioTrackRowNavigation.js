import { useCallback, useEffect } from 'react';

import { secondsDeltaToFrames } from './geometry.ts';
import { routeClipFocusTrimKeyboard } from './clip-focus-trim-keyboard-routing.ts';
import { normalizeClipSemantics } from './timeline-navigation.js';

export function useAudioTrackRowNavigation({
	controller,
	project,
	track,
	trackWindowRef,
	projectedClips,
	clipLookup,
	sourceLookup,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	sampleRate,
	blocked,
	canonicalVideoTrim,
	run,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusTrackRuler,
	onFocusSelectionToolbar,
}) {
	const tabIndexFor = useCallback(
		(offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset,
		[isFlatNavigation, trackBaseTabIndex, trackIndex],
	);

	useEffect(() => {
		const root = trackWindowRef.current;
		if (!root) return undefined;
		const normalize = () => normalizeClipSemantics(root, {
			flat: isFlatNavigation,
			tabIndex: tabIndexFor(2),
		});
		normalize();
		const observer = new MutationObserver(normalize);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['role', 'tabindex'],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [isFlatNavigation, projectedClips, tabIndexFor, trackWindowRef]);

	const focusBeforeTrack = () => {
		if (trackIndex === 0) return onFocusTimelineRuler();
		const previousTrack = trackIndex - 1;
		if (onFocusTrackRuler(previousTrack)) return true;
		if (onFocusTrackClip(previousTrack, true)) return true;
		if (onFocusTrackPanelControl(previousTrack, true)) return true;
		return onFocusTrackContainer(previousTrack);
	};
	const focusAfterPanel = () => {
		if (onFocusTrackClip(trackIndex)) return true;
		return onFocusTrackRuler(trackIndex);
	};
	const focusBeforeRuler = () => {
		if (onFocusTrackClip(trackIndex, true)) return true;
		if (onFocusTrackPanelControl(trackIndex, true)) return true;
		return onFocusTrackContainer(trackIndex);
	};
	const focusAfterRuler = () => {
		if (trackIndex + 1 < trackCount) return onFocusTrackContainer(trackIndex + 1);
		return onFocusSelectionToolbar();
	};
	const moveClipBySeconds = (clipId, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !deltaFrames) return;
		run(() => controller.actions.clip.move(
			clip.id,
			track.id,
			Math.max(0, clip.timelineStartFrame + deltaFrames),
		));
	};
	const moveClipToTrack = (clipId, direction) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		let targetTrackIndex = trackIndex + direction;
		const targetType = clip?.kind || track.type;
		while (
			targetTrackIndex >= 0
			&& targetTrackIndex < project.tracks.length
			&& project.tracks[targetTrackIndex]?.type !== targetType
		) {
			targetTrackIndex += direction;
		}
		const targetTrack = project.tracks[targetTrackIndex];
		if (!clip || !targetTrack || targetTrack.type === 'label') return;
		const moved = run(() => controller.actions.clip.move(clip.id, targetTrack.id, clip.timelineStartFrame));
		if (!moved) return;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			onFocusTrackClip(targetTrackIndex, false, clip.id);
		}));
	};
	const navigateClipVertical = (clipId, direction) => {
		const sourceClip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		if (!sourceClip || trackCount < 2) return;
		for (let distance = 1; distance < trackCount; distance += 1) {
			const candidateIndex = (trackIndex + direction * distance + trackCount) % trackCount;
			const candidateTrack = project.tracks[candidateIndex];
			if (!Array.isArray(candidateTrack.clipIds)) continue;
			const candidateClips = candidateTrack.clipIds
				.map((candidateId) => clipLookup.get(candidateId))
				.filter(Boolean);
			if (!candidateClips.length) continue;
			const closest = candidateClips.reduce((best, candidate) => (
				Math.abs(candidate.timelineStartFrame - sourceClip.timelineStartFrame)
					< Math.abs(best.timelineStartFrame - sourceClip.timelineStartFrame)
					? candidate
					: best
			));
			onFocusTrackClip(candidateIndex, false, closest.id);
			return;
		}
	};
	const trimClipBySecondsLegacy = (clipId, edge, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const source = clip ? sourceLookup.get(clip.sourceId) : null;
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !source || !deltaFrames) return;
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const sourceFramesPerTimelineFrame = sourceDurationFrames / clip.durationFrames;
		if (edge === 'left') {
			const sourceExtension = clip.reversed
				? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
				: clip.sourceStartFrame;
			const timelineExtension = Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
			const change = Math.max(
				-Math.min(clip.timelineStartFrame, timelineExtension),
				Math.min(clip.durationFrames - 1, deltaFrames),
			);
			if (!change) return;
			run(() => controller.actions.clip.trim(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + change,
				durationFrames: clip.durationFrames - change,
			}));
			return;
		}
		const sourceExtension = clip.reversed
			? clip.sourceStartFrame
			: source.frameCount - clip.sourceStartFrame - sourceDurationFrames;
		const maximumDuration = clip.durationFrames
			+ Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
		const nextDuration = Math.max(1, Math.min(maximumDuration, clip.durationFrames - deltaFrames));
		if (nextDuration === clip.durationFrames) return;
		run(() => controller.actions.clip.trim(clip.id, {
			durationFrames: nextDuration,
		}));
	};
	const stretchClipBySecondsLegacy = (clipId, edge, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !deltaFrames) return;
		if (edge === 'left') {
			const change = Math.max(-clip.timelineStartFrame, Math.min(clip.durationFrames - 1, deltaFrames));
			if (!change) return;
			run(() => controller.actions.clip.stretch(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + change,
				durationFrames: clip.durationFrames - change,
			}));
			return;
		}
		const durationFrames = Math.max(1, clip.durationFrames + deltaFrames);
		if (durationFrames === clip.durationFrames) return;
		run(() => controller.actions.clip.stretch(clip.id, { durationFrames }));
	};
	const trimClipBySeconds = (clipId, edge, deltaSeconds) => routeClipFocusTrimKeyboard({
		blocked,
		videoCompositing: canonicalVideoTrim,
		clipId,
		operation: 'trim',
		edge,
		callbackDeltaSeconds: deltaSeconds,
		resolveFocusedClip: (focusedClipId) => (
			clipLookup.get(String(focusedClipId)) || clipLookup.get(focusedClipId)
		),
		commitCanonicalTrim: (step) => run(() => (
			controller.actions.video.trim.commitStep(step)
		)),
		commitCanonicalRateStretch: (step) => run(() => (
			controller.actions.video.trim.rateStretch.commitStep(step)
		)),
		commitLegacy: () => trimClipBySecondsLegacy(clipId, edge, deltaSeconds),
	});
	const stretchClipBySeconds = (clipId, edge, deltaSeconds) => routeClipFocusTrimKeyboard({
		blocked,
		videoCompositing: canonicalVideoTrim,
		clipId,
		operation: 'rate-stretch',
		edge,
		callbackDeltaSeconds: deltaSeconds,
		resolveFocusedClip: (focusedClipId) => (
			clipLookup.get(String(focusedClipId)) || clipLookup.get(focusedClipId)
		),
		commitCanonicalTrim: (step) => run(() => (
			controller.actions.video.trim.commitStep(step)
		)),
		commitCanonicalRateStretch: (step) => run(() => (
			controller.actions.video.trim.rateStretch.commitStep(step)
		)),
		commitLegacy: () => stretchClipBySecondsLegacy(clipId, edge, deltaSeconds),
	});

	return {
		tabIndexFor,
		focusBeforeTrack,
		focusAfterPanel,
		focusBeforeRuler,
		focusAfterRuler,
		moveClipBySeconds,
		moveClipToTrack,
		navigateClipVertical,
		trimClipBySeconds,
		stretchClipBySeconds,
	};
}
