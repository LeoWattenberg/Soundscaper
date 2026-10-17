import { clipFadeChangeCommand } from './clip-fade-actions.ts';
import { routeClipHandleKeyboard } from './clip-handle-keyboard.ts';
import { secondsDeltaToFrames } from './geometry.ts';
import { clipHasLoopRepeats, normalizeInactiveClipLoop } from '../../audio-clip-loop.ts';
import { routeClipFocusTrimKeyboard } from './clip-focus-trim-keyboard-routing.ts';
import { useTrackRowFocusNavigation } from './useTrackRowFocusNavigation.js';
import { extendTrackRowSelection } from './track-row-selection-extension.ts';
import { keyboardClipMoveFrame } from '../../keyboard-clip-move.ts';

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
	onEditFades = () => undefined,
}) {
	const focusNavigation = useTrackRowFocusNavigation({
		trackWindowRef,
		renderedClips: projectedClips,
		trackIndex,
		trackCount,
		isFlatNavigation,
		trackBaseTabIndex,
		hasTrackRuler: true,
		onFocusTimelineRuler,
		onFocusTrackContainer,
		onFocusTrackPanelControl,
		onFocusTrackClip,
		onFocusTrackRuler,
		onFocusSelectionToolbar,
		onExtendTrackSelection: (index) => run(() => extendTrackRowSelection(controller, track.id, index)),
		onSelectClip: (clipId, options) => run(() => (
			controller.actions.timeline.selectClip(clipId, options)
		)),

	});
	const moveClipBySeconds = (clipId, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !deltaFrames) return;
		run(() => controller.actions.clip.move(
			clip.id,
			track.id,
			keyboardClipMoveFrame(project, clip.timelineStartFrame, deltaFrames),
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
		const moved = run(() => controller.actions.clip.move(clip.id, targetTrack.id, clip.timelineStartFrame, { preserveTime: true }));
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
		const storedClip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const clip = storedClip ? normalizeInactiveClipLoop(storedClip) : null;
		const source = clip ? sourceLookup.get(clip.sourceId) : null;
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !source || !deltaFrames) return;
		if (clipHasLoopRepeats(clip)) {
			run(() => controller.actions.clip.trim(clip.id, { ...(edge === 'left' ? { timelineStartFrame: clip.timelineStartFrame + deltaFrames } : {}), durationFrames: clip.durationFrames - deltaFrames }));
			return;
		}
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
		const durationFrames = Math.max(1, clip.durationFrames - deltaFrames);
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
	const editClipEdgeToFrame = (clipId, edge, requestedBoundarySample, stretch) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		if (!clip || !Number.isSafeInteger(requestedBoundarySample) || requestedBoundarySample < 0) return;
		const boundary = clip.timelineStartFrame + (edge === 'right' ? clip.durationFrames : 0);
		if (boundary === requestedBoundarySample) return;
		if (canonicalVideoTrim === true && clip.kind === 'audio'
			&& typeof clip.avLinkId === 'string' && clip.avLinkId.length > 0) {
			const request = { activeClipId: clip.id, edge, requestedBoundarySample };
			run(() => stretch ? controller.actions.video.trim.rateStretch.commit(request)
				: controller.actions.video.trim.commit(request));
			return;
		}
		const deltaSeconds = (edge === 'left' ? requestedBoundarySample - boundary : boundary - requestedBoundarySample) / sampleRate;
		(stretch ? stretchClipBySecondsLegacy : trimClipBySecondsLegacy)(clipId, edge, deltaSeconds);
	};

	return {
		...focusNavigation,
		handleClipKeyDownCapture: (event) => {
			if (routeClipHandleKeyboard(event, {
				clips: track.clipIds.map(id => clipLookup.get(id)).filter(Boolean), sampleRate, blocked,
				selectedIds: project.selection?.clipIds ?? [], playheadFrame: controller.getTelemetrySnapshot?.().positionFrame ?? 0,
				updateFade: (id, changes, edge) => run(() => {
					const command = clipFadeChangeCommand(project, id, sampleRate, changes, edge);
					if (command) controller.actions.edit.commit(command);
				}),
				trim: trimClipBySeconds, stretch: stretchClipBySeconds,
				trimToFrame: (id, edge, frame) => editClipEdgeToFrame(id, edge, frame, false),
				stretchToFrame: (id, edge, frame) => editClipEdgeToFrame(id, edge, frame, true),
				seek: frame => run(() => controller.actions.transport.seek(frame)), openFades: onEditFades,
			})) return;
			focusNavigation.handleClipKeyDownCapture(event);
		},
		moveClipBySeconds,
		moveClipToTrack,
		navigateClipVertical,
		trimClipBySeconds,
		stretchClipBySeconds,
	};
}
