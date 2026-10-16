import { useEffect, useRef, useState } from 'react';
import { Icon } from '@soundscaper/design-system/Icon';

import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	clearActiveProjectBinDragPayload,
	createProjectBinDragPayload,
} from '../../project-bin-dnd.js';
import ProjectBinNameEditor from './ProjectBinNameEditor.tsx';
import { formatProjectBinSource } from './project-bin-model.ts';
import { useProjectBinWaveformPath, useProjectBinTransformBadges, useProjectBinMediaTiming, useProjectBinDuration, useProjectBinInstanceCount } from './useProjectBinPresentation.ts';
import { productVideoVisualPreviewRuntimeFor } from './product-video-visual-preview-runtime.ts';
import { createProjectBinRetimePlayback } from '../../controller/import/project-bin-video-playback.ts';

export default function ProjectBinCard({
	clip,
	itemClips,
	source,
	sources,
	project,
	controller,
	copy,
	locale,
	mutationBlocked,
	missing,
	selectedMediaTrack,
	preview,
	playbackGain = 1,
	run,
	onOpenMenu,
	onDragEnd,
}) {
	const videoRef = useRef(null);
	const retimePlaybackRef = useRef(null);
	let visual = null;
	try {
		visual = controller.actions.projectBin.getVisualData(clip.id);
	} catch {
		// The source can still be activating while the project document is already visible.
	}
	const unavailable = Boolean(missing || !source || visual?.available === false);
	const disabled = mutationBlocked || unavailable;
	const name = clip.title || source?.name || copy.clip;
	const waveformPath = useProjectBinWaveformPath(visual, clip, project);
	const transformBadges = useProjectBinTransformBadges(itemClips, sources, copy);
	const format = formatProjectBinSource(source, copy);
	const videoClip = itemClips.find((itemClip) => itemClip.kind === 'video') || null;
	const visualClip = itemClips.find((itemClip) => (
		itemClip.kind === 'still' || itemClip.kind === 'generator' || itemClip.kind === 'image'
	)) || null;
	const visualThumbnail = useProductVisualThumbnail({
		controller, project, clipId: visualClip?.id || null,
	});
	const posterUrl = visual?.posterUrl || visual?.thumbnails?.[0]?.url || null;
	const previewActive = preview?.clipId === clip.id;
	const previewPlaying = previewActive && preview.state === 'playing';
	const instanceCount = useProjectBinInstanceCount(controller.actions.projectBin.instanceCount, clip.id, project?.clips, project?.projectBin?.clips);
	const videoSource = videoClip
		? sources[itemClips.indexOf(videoClip)] || project?.sources?.find((candidate) => candidate.id === videoClip.sourceId)
		: null;
	const { videoPreview, visualDuration } = useProjectBinMediaTiming(project, videoClip, videoSource, visualClip);
	const duration = useProjectBinDuration(videoPreview?.durationFrames ?? visualDuration ?? clip.durationFrames, project?.sampleRate, locale);
	const videoStartSeconds = videoPreview?.startSeconds ?? 0;
	const videoEndSeconds = videoPreview?.endSeconds ?? 0;
	const videoPlaybackRate = videoPreview?.playbackRate ?? 1;
	const videoHasAudio = itemClips.some((itemClip) => itemClip.kind === 'audio');
	const videoEmbeddedAudio = videoHasAudio && !preview?.audioSourceId;
	const retimeIdentity = videoPreview?.retimeIdentity;
	const retimeDuration = videoPreview?.durationFrames;
	const retimeSampleRate = project?.sampleRate;
	const retimeMappingRef = useRef(null);
	retimeMappingRef.current = videoPreview?.sourceTimeAtFrame ?? null;
	const previewCompletionRef = useRef(null);
	previewCompletionRef.current = () => run(() => controller.actions.projectBin.stopPreview());
	const retimeUnavailable = Boolean(videoClip?.retimeMap && !videoPreview?.sourceTimeAtFrame);

	useEffect(() => {
		const media = videoRef.current;
		if (!media || !previewActive || !retimeIdentity) return;
		const playback = createProjectBinRetimePlayback({
			media, sampleRate: retimeSampleRate, durationFrames: retimeDuration,
			sourceTimeAtFrame: frame => retimeMappingRef.current(frame),
			now: () => performance.now(),
			requestFrame: callback => requestAnimationFrame(callback),
			cancelFrame: id => cancelAnimationFrame(id),
			onComplete: () => previewCompletionRef.current(),
		});
		retimePlaybackRef.current = playback;
		return () => {
			playback.dispose();
			if (retimePlaybackRef.current === playback) retimePlaybackRef.current = null;
		};
	}, [controller, previewActive, retimeIdentity, retimeSampleRate, retimeDuration, visual?.mediaUrl]);

	useEffect(() => {
		if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, playbackGain));
	}, [playbackGain, previewActive, visual?.mediaUrl]);

	useEffect(() => {
		const media = videoRef.current;
		if (!media) return;
		// WebKit initializes mute state from the attribute when media connects or loads.
		media.defaultMuted = !videoEmbeddedAudio;
		media.muted = !videoEmbeddedAudio;
		if (retimePlaybackRef.current) {
			if (previewPlaying) retimePlaybackRef.current.play();
			else retimePlaybackRef.current.pause();
			return;
		}
		if (!previewActive || retimeUnavailable) {
			media.pause();
			return;
		}
		if (preview.state === 'stopped' || media.currentTime < videoStartSeconds || media.currentTime >= videoEndSeconds) {
			media.currentTime = videoStartSeconds;
		}
		media.playbackRate = videoPlaybackRate;
		if (previewPlaying) void media.play().catch(() => controller.actions.projectBin.stopPreview());
		else media.pause();
	}, [controller, previewActive, previewPlaying, preview?.state, retimeIdentity, retimeUnavailable, videoEndSeconds, videoStartSeconds, videoPlaybackRate, videoEmbeddedAudio, visual?.mediaUrl]);
	const keepVideoAudioBinding = (event) => {
		// Native decoder initialization can report stale mute state after the first render.
		if (!videoEmbeddedAudio && !event.currentTarget.muted) event.currentTarget.muted = true;
	};

	return (
		<li
			className={`kw-audio-editor__project-bin-card${unavailable ? ' kw-audio-editor__project-bin-card--unavailable' : ''}`}
			data-project-bin-item={clip.binItemId || clip.id}
			data-project-bin-media-kind={visualClip ? 'visual' : videoClip ? 'video' : 'audio'}
			data-source-id={clip.sourceId}
			data-unavailable={unavailable ? 'true' : 'false'}
			tabIndex={-1}
			aria-label={`${copy.panelProjectBin}: ${name}`}
			draggable={!disabled}
			onDragStart={(event) => {
				if (disabled) {
					event.preventDefault();
					return;
				}
				event.dataTransfer.effectAllowed = 'copy';
				event.dataTransfer.setData(
					AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
					createProjectBinDragPayload(project.id, clip.id),
				);
				event.dataTransfer.setData('text/plain', name);
				event.currentTarget.dataset.dragging = 'true';
			}}
			onDragEnd={(event) => {
				delete event.currentTarget.dataset.dragging;
				clearActiveProjectBinDragPayload();
				onDragEnd(event.currentTarget.closest('[data-project-bin-drop-target]'));
			}}
		>
			{visualClip ? (
				<div
					className="kw-audio-editor__project-bin-video"
					data-project-bin-visual
					data-visual-thumbnail-pending={visualThumbnail.pending ? 'true' : 'false'}
					data-visual-thumbnail-error={visualThumbnail.error || ''}
					data-visual-presentation-ids={visualThumbnail.value?.presentationIds.join(' ') || ''}
					data-visual-mask-ids={visualThumbnail.value?.maskIds.join(' ') || ''}
					data-visual-opacity={visualThumbnail.value?.opacity ?? ''}
					data-visual-blend-mode={visualThumbnail.value?.blendMode || ''}
					aria-label={`${copy.videoClip}: ${name}`}
					role="img"
				>
					<ProjectBinVisualThumbnail state={visualThumbnail} />
				</div>
			) : videoClip ? (
				<div
					className="kw-audio-editor__project-bin-video"
					data-project-bin-video
					aria-label={`${copy.videoClip}: ${name}`}
					role="img"
				>
					{previewActive && visual?.mediaUrl ? (
						<video
							ref={videoRef}
							src={visual.mediaUrl}
							poster={posterUrl || undefined}
							muted={!videoEmbeddedAudio}
							playsInline
							preload="metadata"
							onLoadedMetadata={keepVideoAudioBinding}
							onVolumeChange={keepVideoAudioBinding}
							onTimeUpdate={(event) => {
								if (!retimeIdentity && videoEndSeconds && event.currentTarget.currentTime >= videoEndSeconds) {
									event.currentTarget.pause();
									event.currentTarget.currentTime = videoStartSeconds;
									run(() => controller.actions.projectBin.stopPreview());
								}
							}}
							onEnded={() => { if (!retimeIdentity) run(() => controller.actions.projectBin.stopPreview()); }}
						/>
					) : posterUrl
						? <img src={posterUrl} alt="" draggable="false" />
						: <span aria-hidden="true">▶</span>}
					<span>{videoHasAudio ? copy.videoHasAudio : copy.videoSilent}</span>
				</div>
			) : (
				<div
					className="kw-audio-editor__project-bin-waveform"
					data-project-bin-waveform
					aria-label={`${copy.projectBinWaveform}: ${name}`}
					role="img"
				>
					<svg viewBox="0 0 160 44" preserveAspectRatio="none" aria-hidden="true" focusable="false">
						<path className="kw-audio-editor__project-bin-waveform-zero" d="M0 22 H160" />
						{waveformPath && <path className="kw-audio-editor__project-bin-waveform-peaks" d={waveformPath} />}
					</svg>
				</div>
			)}
			<div className="kw-audio-editor__project-bin-card-body">
				<ProjectBinNameEditor
					clip={clip}
					name={name}
					copy={copy}
					disabled={mutationBlocked}
					onCommit={(nextName) => run(() => controller.actions.projectBin.rename(clip.id, nextName))}
				/>
				<p className="kw-audio-editor__project-bin-meta">
					<span>{duration}</span>
					<span aria-hidden="true">·</span>
					<span>{format}</span>
				</p>
				{transformBadges.length > 0 && (
					<ul className="kw-audio-editor__project-bin-badges" aria-label={copy.projectBinTransformations}>
						{transformBadges.map((badge) => <li key={badge}>{badge}</li>)}
					</ul>
				)}
				{unavailable && (
					<p className="kw-audio-editor__project-bin-unavailable" role="status">
						{copy.projectBinUnavailable}
					</p>
				)}
				<div className="kw-audio-editor__project-bin-card-actions">
					<button
						type="button"
						className="kw-audio-editor__project-bin-icon-button kw-audio-editor__project-bin-overflow"
						aria-label={`${copy.projectBinMoreActions}: ${name}`}
						onClick={onOpenMenu}
					>
						<Icon name="menu" size={15} />
					</button>
					<div className="kw-audio-editor__project-bin-card-actions-right">
					<button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						disabled={disabled}
						aria-label={`${copy.projectBinAddToTimeline}: ${name}`}
						onClick={() => run(() => controller.actions.projectBin.place(clip.id, {
							...(selectedMediaTrack ? { trackId: selectedMediaTrack.id } : {}),
						}))}
					>
						<Icon name="plus" size={15} />
					</button>
					{clip.kind === 'video' && <button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						data-bin-action="source-monitor"
						disabled={unavailable}
						aria-label={`${copy.sourceMonitorOpen}: ${name}`}
						onClick={() => run(() => controller.actions.video.sourceMonitor.open(clip.binItemId || clip.id))}
					>
						<Icon name="eye" size={15} />
					</button>}
					{clip.kind === 'video' && <button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						data-bin-action="insert"
						disabled={disabled}
						aria-label={`${copy.editInsert}: ${name}`}
						onClick={() => run(() => controller.actions.video.insert({ binItemId: clip.binItemId || clip.id }))}
					>
						<Icon name="chevron-right" size={15} />
					</button>}
					{clip.kind === 'video' && <button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						data-bin-action="overwrite"
						disabled={disabled}
						aria-label={`${copy.editOverwrite}: ${name}`}
						onClick={() => run(() => controller.actions.video.overwrite({ binItemId: clip.binItemId || clip.id }))}
					>
						<Icon name="chevron-down" size={15} />
					</button>}
					<button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						disabled={mutationBlocked || instanceCount === 0}
						aria-label={`${copy.projectBinSelectInstances}: ${name}`}
						onClick={() => run(() => controller.actions.projectBin.selectInstances(clip.id))}
					>
						<span className="kw-audio-editor__project-bin-ibeam" aria-hidden="true" />
					</button>
					{!visualClip && <button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						disabled={unavailable || retimeUnavailable}
						aria-label={`${previewPlaying ? copy.pause : copy.play}: ${name}`}
						aria-pressed={previewPlaying}
						onClick={() => run(() => controller.actions.projectBin.playPause(clip.id))}
					>
						<Icon name={previewPlaying ? 'pause' : 'play'} size={15} />
					</button>}
					</div>
				</div>
			</div>
		</li>
	);
}

function useProductVisualThumbnail({ controller, project, clipId }) {
	const runtime = productVideoVisualPreviewRuntimeFor(controller);
	const [state, setState] = useState(() => ({ pending: false, value: null, error: null }));
	useEffect(() => {
		const create = runtime?.createProjectBinThumbnail;
		if (!clipId || typeof create !== 'function') {
			setState({ pending: false, value: null, error: null });
			return undefined;
		}
		const abort = new AbortController();
		setState({ pending: true, value: null, error: null });
		void create({ project, clipId, width: 320, height: 180, signal: abort.signal })
			.then((value) => {
				if (!abort.signal.aborted) setState({ pending: false, value, error: null });
			})
			.catch((cause) => {
				if (!abort.signal.aborted) setState({ pending: false, value: null,
					error: cause instanceof Error ? cause.message : String(cause) });
			});
		return () => { abort.abort(new DOMException('Project Bin thumbnail was replaced.', 'AbortError')); };
	}, [clipId, project, runtime]);
	return state;
}

function ProjectBinVisualThumbnail({ state }) {
	const canvasRef = useRef(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		const value = state.value;
		if (!canvas || !value) return;
		canvas.width = value.width;
		canvas.height = value.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.putImageData(new ImageData(new Uint8ClampedArray(value.pixels), value.width, value.height), 0, 0);
	}, [state.value]);
	if (state.error) return <span aria-hidden="true">!</span>;
	if (!state.value) return <span aria-hidden="true">◇</span>;
	return <canvas ref={canvasRef} data-project-bin-visual-canvas aria-hidden="true" />;
}
