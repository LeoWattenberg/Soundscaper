import { useEffect, useRef, useState } from 'react';
import { Icon } from '@dilsonspickles/components';

import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	clearActiveProjectBinDragPayload,
	createProjectBinDragPayload,
} from '../../project-bin-dnd.js';
import {
	formatProjectBinDuration,
	formatProjectBinSource,
	projectBinTransformBadges,
	projectBinWaveformPath,
} from './project-bin-model.ts';

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
	positionFrame,
	preview,
	run,
	onOpenMenu,
	onDragEnd,
}) {
	const videoRef = useRef(null);
	let visual = null;
	try {
		visual = controller.actions.projectBin.getVisualData(clip.id);
	} catch {
		// The source can still be activating while the project document is already visible.
	}
	const unavailable = Boolean(missing || !source || visual?.available === false);
	const disabled = mutationBlocked || unavailable;
	const name = clip.title || source?.name || copy.clip;
	const waveformPath = projectBinWaveformPath(visual, clip);
	const transformBadges = [...new Set(itemClips.flatMap((itemClip, index) => (
		projectBinTransformBadges(itemClip, sources[index], copy)
	)))];
	const format = formatProjectBinSource(source, copy);
	const duration = formatProjectBinDuration(clip.durationFrames, project?.sampleRate, locale);
	const videoClip = itemClips.find((itemClip) => itemClip.kind === 'video') || null;
	const posterUrl = visual?.posterUrl || visual?.thumbnails?.[0]?.url || null;
	const previewActive = preview?.clipId === clip.id;
	const previewPlaying = previewActive && preview.state === 'playing';
	const instanceCount = controller.actions.projectBin.instanceCount(clip.id);
	const videoSource = videoClip
		? sources[itemClips.indexOf(videoClip)] || project?.sources?.find((candidate) => candidate.id === videoClip.sourceId)
		: null;
	const videoStartSeconds = videoClip && videoSource
		? videoClip.sourceStartFrame / Math.max(1, videoSource.sampleRate || project?.sampleRate || 48_000)
		: 0;
	const videoEndSeconds = videoClip && videoSource
		? (videoClip.sourceStartFrame + videoClip.sourceDurationFrames) / Math.max(1, videoSource.sampleRate || project?.sampleRate || 48_000)
		: 0;

	useEffect(() => {
		const media = videoRef.current;
		if (!media) return;
		if (!previewActive) {
			media.pause();
			return;
		}
		if (Math.abs(media.currentTime - videoStartSeconds) > .1 && (media.currentTime < videoStartSeconds || media.currentTime >= videoEndSeconds)) {
			media.currentTime = videoStartSeconds;
		}
		if (previewPlaying) void media.play().catch(() => controller.actions.projectBin.stopPreview());
		else media.pause();
	}, [controller, previewActive, previewPlaying, videoEndSeconds, videoStartSeconds]);

	return (
		<li
			className={`kw-audio-editor__project-bin-card${unavailable ? ' kw-audio-editor__project-bin-card--unavailable' : ''}`}
			data-project-bin-item={clip.binItemId || clip.id}
			data-project-bin-media-kind={videoClip ? 'video' : 'audio'}
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
			{videoClip ? (
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
							playsInline
							preload="metadata"
							onTimeUpdate={(event) => {
								if (videoEndSeconds && event.currentTarget.currentTime >= videoEndSeconds) {
									event.currentTarget.pause();
									event.currentTarget.currentTime = videoStartSeconds;
									run(() => controller.actions.projectBin.stopPreview());
								}
							}}
							onEnded={() => run(() => controller.actions.projectBin.stopPreview())}
						/>
					) : posterUrl
						? <img src={posterUrl} alt="" draggable="false" />
						: <span aria-hidden="true">▶</span>}
					<span>{itemClips.some((itemClip) => itemClip.kind === 'audio') ? copy.videoHasAudio : copy.videoSilent}</span>
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
						title={copy.projectBinMoreActions}
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
						title={copy.projectBinAddToTimeline}
						onClick={() => run(() => controller.actions.projectBin.place(clip.id, {
							...(selectedMediaTrack ? { trackId: selectedMediaTrack.id } : {}),
							timelineStartFrame: positionFrame,
						}))}
					>
						<Icon name="plus" size={15} />
					</button>
					{clip.kind === 'video' && <button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						data-bin-action="insert"
						disabled={disabled}
						aria-label={`${copy.editInsert}: ${name}`}
						title={copy.editInsert}
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
						title={copy.editOverwrite}
						onClick={() => run(() => controller.actions.video.overwrite({ binItemId: clip.binItemId || clip.id }))}
					>
						<Icon name="chevron-down" size={15} />
					</button>}
					<button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						disabled={mutationBlocked || instanceCount === 0}
						aria-label={`${copy.projectBinSelectInstances}: ${name}`}
						title={copy.projectBinSelectInstances}
						onClick={() => run(() => controller.actions.projectBin.selectInstances(clip.id))}
					>
						<span className="kw-audio-editor__project-bin-ibeam" aria-hidden="true" />
					</button>
					<button
						type="button"
						className="kw-audio-editor__project-bin-icon-button"
						disabled={unavailable}
						aria-label={`${previewPlaying ? copy.pause : copy.play}: ${name}`}
						title={previewPlaying ? copy.pause : copy.play}
						aria-pressed={previewPlaying}
						onClick={() => run(() => controller.actions.projectBin.playPause(clip.id))}
					>
						<Icon name={previewPlaying ? 'pause' : 'play'} size={15} />
					</button>
					</div>
				</div>
			</div>
		</li>
	);
}

function ProjectBinNameEditor({ clip, name, copy, disabled, onCommit }) {
	const [draft, setDraft] = useState(name);
	useEffect(() => setDraft(name), [clip.id, name]);
	const commit = () => {
		const nextName = draft.trim();
		if (!nextName) {
			setDraft(name);
			return;
		}
		if (nextName !== name) onCommit(nextName);
	};
	return (
		<label className="kw-audio-editor__project-bin-name">
			<span className="kw-audio-editor-sr-only">{copy.projectBinRename}</span>
			<input
				data-project-bin-name
				aria-label={`${copy.projectBinRename}: ${name}`}
				value={draft}
				disabled={disabled}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						event.preventDefault();
						setDraft(name);
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}
