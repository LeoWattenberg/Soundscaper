/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from 'react';
import UpstreamClipPropertiesPanel from '@soundscaper/design-system/ClipPropertiesPanel/ClipPropertiesPanel';
import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-audio-factory.js';
import { projectForRuntimeConsumers } from '../../project-current-runtime.ts';
import type { RuntimeClipProject } from '../../runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { ClipPropertiesFocusRequest } from '../../controller/composition/clip-properties-panel-opening.ts';
import { END_FADE_SHAPE_PRESETS } from '../../clip-fade-presets.ts';
import { readClipLoop } from '../../audio-clip-loop.ts';
import type { ClipSourceTimingProject, ClipSourceTimingSource } from '../../clip-source-timing.ts';
import { clipSourceTrim } from './clip-source-view.ts';
import { clipPropertiesMediaRange } from './clip-properties-media-range.ts';
import { clipPropertiesPresentation, type PropertyProject, type PropertyClip } from './clip-properties-upstream-model.ts';
import { useClipPropertiesSelection } from './useClipPropertyPresentation.ts';
import type { ClipPropertiesSelectionSnapshot } from './clip-properties-selection.ts';
import ClipPropertiesBody from './ClipPropertiesBody.jsx';
import ImageClipPropertiesBody from './ImageClipPropertiesBody.tsx';
import GeneratorClipPropertiesBody from './GeneratorClipPropertiesBody.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { upstreamClipPropertiesLabels } from './upstream-clip-properties-copy.ts';

export type { ClipPropertiesFocusRequest } from '../../controller/composition/clip-properties-panel-opening.ts';
interface Props {
	readonly controller: object;
	readonly snapshot: ClipPropertiesSelectionSnapshot & Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly focusRequest?: ClipPropertiesFocusRequest | null;
	readonly panelActive?: boolean;
	readonly runtimeProject?: RuntimeClipProject | null;
}
interface Editor {
	readonly project?: { readonly id: string } | null;
	readonly actions: {
		readonly edit: { commit(command: AudioEditorCommand): unknown };
		readonly clip: {
			update(id: string, changes: Readonly<Record<string, unknown>>): unknown;
			move(id: string, track: string, frame: number, options: { exactFrame: true }): unknown;
			trim(id: string, changes: Readonly<Record<string, number>>): unknown;
			setTimePitch(id: string, changes: Readonly<Record<string, unknown>>): unknown;
			setTimePitchMany(ids: readonly string[], changes: Readonly<Record<string, unknown>>): unknown;
		};
		readonly clipSourcePreview?: { trim(id: string, changes: Readonly<Record<string, number>>): unknown };
	};
}

/** Upstream glyph fields and merged selections, with the editor's native commands. */
export default function ClipPropertiesPanel({ controller, snapshot, copy, focusRequest = null, panelActive = true, runtimeProject = null }: Props) {
	const selected = useClipPropertiesSelection(snapshot, copy.clip);
	const editor = controller as Editor;
	const project = useMemo(() => {
		const owner = runtimeProject ?? snapshot.project;
		return owner ? projectForRuntimeConsumers(owner as RuntimeClipProject) as unknown as PropertyProject : null;
	}, [runtimeProject, snapshot.project]);
	const presentation = clipPropertiesPresentation(project, selected.clips.map(clip => clip.id), copy.clip, selected.preferredClipId);
	const blocked = selectAudioEditorEditBlock(snapshot as Parameters<typeof selectAudioEditorEditBlock>[0]).blocked || presentation.locked;
	const audio = presentation.clips.every(clip => clip.kind === 'audio');
	const targetKey = JSON.stringify([project?.id, selected.clips.map(clip => clip.id)]);
	const liveTarget = useRef(targetKey);
	liveTarget.current = targetKey;
	const mounted = useRef(true);
	const handledFocus = useRef<ClipPropertiesFocusRequest | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const [extraOpen, setExtraOpen] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	useEffect(() => { setExtraOpen(false); setError(''); }, [targetKey, setError]);
	useEffect(() => {
		if (!panelActive || !focusRequest || handledFocus.current === focusRequest) return;
		const ownsProject = focusRequest.projectId === undefined || focusRequest.projectId === project?.id;
		const hasClip = selected.clips.some(clip => clip.id === focusRequest.clipId);
		if (ownsProject && hasClip) {
			const field = focusRequest.field === 'pitchCents' ? 'pitch' : focusRequest.field === 'speedRatio' ? 'speed' : 'name';
			const input = root.current?.querySelector(`[data-clip-properties-field="${field}"]`)?.querySelector<HTMLInputElement>('input');
			if (input && !input.disabled) input.focus(); else root.current?.focus();
		}
		handledFocus.current = focusRequest; focusRequest.onHandled?.();
	}, [focusRequest, panelActive, project?.id, selected.clips]);
	const run = (operation: () => unknown) => {
		if (blocked || !mounted.current || liveTarget.current !== targetKey
			|| ('project' in editor && editor.project?.id !== project?.id)) return;
		try {
			const result = operation();
			setError('');
			void Promise.resolve(result).catch(cause => {
				if (mounted.current && liveTarget.current === targetKey) setError(feedbackFailure(cause));
			});
		} catch (cause) { setError(feedbackFailure(cause)); }
	};
	const update = (changes: (clip: PropertyClip) => Readonly<Record<string, unknown>>) => run(() => {
		if (presentation.clips.length === 1) return editor.actions.clip.update(presentation.clips[0]!.id, changes(presentation.clips[0]!));
		return editor.actions.edit.commit({ type: 'batch', commands: presentation.clips.map(clip => ({ type: 'clip/update', clipId: clip.id, changes: changes(clip) })) });
	});
	const setTimePitch = (changes: Readonly<Record<string, unknown>>) => run(() => presentation.clips.length > 1
		? editor.actions.clip.setTimePitchMany(presentation.clips.map(clip => clip.id), changes)
		: editor.actions.clip.setTimePitch(presentation.clips[0]!.id, changes));
	const clip = presentation.clips[0];
	const source = project?.sources.find(source => source.id === clip?.sourceId);
	const trim = (edge: 'start' | 'end', seconds: number) => run(() => {
		if (!clip || !source || !project) return;
		const sourceRate = source.sampleRate || project.sampleRate;
		const sourceFrame = Math.round((edge === 'start' ? seconds : (source.frameCount ?? 0) / sourceRate - seconds) * sourceRate);
		const changes = clipSourceTrim(clip as Parameters<typeof clipSourceTrim>[0], source as Parameters<typeof clipSourceTrim>[1], project.sampleRate, edge, sourceFrame, project as unknown as ClipSourceTimingProject);
		return editor.actions.clipSourcePreview ? editor.actions.clipSourcePreview.trim(clip.id, changes) : editor.actions.clip.trim(clip.id, changes);
	});
	const enabled = !blocked;
	const capabilities = snapshot.capabilities as { readonly audioEffects?: boolean } | undefined;
	const timePitchEnabled = enabled && capabilities?.audioEffects !== false;
	const shapeLabels: Record<string, string> = { linear: copy.fadeShapeLinear, logarithmic: copy.fadeShapeLogarithmic,
		exponential: copy.fadeShapeExponential, 's-curve': copy.fadeShapeSCurve, 'constant-power': copy.fadeShapeConstantPower };
	return <div ref={root} className="audio-editor-upstream-clip-properties" data-upstream-clip-properties tabIndex={-1}>
		{audio ? <fieldset disabled={blocked}>
			<UpstreamClipPropertiesPanel key={targetKey} clip={presentation.clip} selection={presentation.selection}
				labels={upstreamClipPropertiesLabels(copy)}
				colors={[{ id: 'track', label: copy.followTrackColor }, ...AUDIO_EDITOR_TRACK_COLORS.map((color: string, index: number) => ({ id: color, label: `${copy.trackColor} ${index + 1}` }))]}
				tracks={(project?.tracks ?? []).filter(track => track.type === 'audio' && !track.locked).map(track => ({ id: track.id, label: track.name }))}
				fadeShapes={END_FADE_SHAPE_PRESETS.map(preset => ({ ...preset, shape: preset.shape ?? 'linear', label: shapeLabels[preset.id]! }))}
				onRename={enabled && clip ? name => update(() => ({ title: name })) : undefined}
				onColorChange={enabled ? color => update(() => ({ color: color === 'track' ? 'auto' : color })) : undefined}
				onTrackChange={enabled ? trackId => run(() => editor.actions.edit.commit({ type: 'batch', commands: presentation.clips.map(clip => ({ type: 'clip/move', clipId: clip.id, trackId, timelineStartFrame: clip.timelineStartFrame })) })) : undefined}
				onStartChange={enabled && clip && project ? seconds => run(() => editor.actions.clip.move(clip.id, presentation.tracks[0]!.id, Math.max(0, Math.round(seconds * project.sampleRate)), { exactFrame: true })) : undefined}
				onDurationChange={enabled && clip && source && project ? seconds => run(() => {
					const durationFrames = Math.max(1, Math.round(seconds * project.sampleRate));
					const loop = readClipLoop(clip);
					if (loop) return editor.actions.clip.update(clip.id, { loop: { ...loop, durationFrames } });
					const changes = clipPropertiesMediaRange(clip as Parameters<typeof clipPropertiesMediaRange>[0], source.frameCount ?? 0, 'durationFrame', durationFrames,
						{ project: project as unknown as ClipSourceTimingProject, source: source as ClipSourceTimingSource });
					return editor.actions.clipSourcePreview ? editor.actions.clipSourcePreview.trim(clip.id, changes) : editor.actions.clip.trim(clip.id, changes);
				}) : undefined}
				onTrimStartChange={enabled && !readClipLoop(clip ?? {}) ? seconds => trim('start', seconds) : undefined}
				onTrimEndChange={enabled && !readClipLoop(clip ?? {}) ? seconds => trim('end', seconds) : undefined}
				onFadeChange={enabled && project ? (side, seconds) => update(clip => ({ [side === 'in' ? 'fadeInFrames' : 'fadeOutFrames']: Math.min(clip.durationFrames, Math.max(0, Math.round(seconds * project.sampleRate))) })) : undefined}
				onFadeShapeChange={enabled ? (side, id) => { const preset = END_FADE_SHAPE_PRESETS.find(preset => preset.id === id); if (preset) update(() => ({ [side === 'in' ? 'fadeInShape' : 'fadeOutShape']: preset.shape })); } : undefined}
				onPitchChange={timePitchEnabled ? semitones => setTimePitch({ pitchCents: semitones * 100 }) : undefined}
				onSpeedChange={timePitchEnabled ? percent => setTimePitch({ speedRatio: percent / 100 }) : undefined}
				onReverseChange={timePitchEnabled && !presentation.clips.some(clip => (clip as { readonly warpMap?: unknown }).warpMap != null) ? reversed => update(() => ({ reversed })) : undefined}
				onResetPitchSpeed={timePitchEnabled ? () => setTimePitch({ pitchCents: 0, speedRatio: 1, preserveFormants: false }) : undefined} />
			{clip && !presentation.selection && <details className="audio-editor-upstream-clip-properties__additional" open={extraOpen}
				onToggle={event => setExtraOpen(event.currentTarget.open)}><summary>{copy.clipAdditionalProperties}</summary>
				{extraOpen && <ClipPropertiesBody key={targetKey} controller={controller} snapshot={{ ...snapshot, project }} copy={copy} clipId={clip.id} />}
			</details>}
		</fieldset> : clip?.kind === 'image' ? <ImageClipPropertiesBody controller={controller} project={snapshot.project} clipId={clip.id} copy={copy} disabled={blocked} />
			: clip?.kind === 'generator' ? <GeneratorClipPropertiesBody controller={controller} project={project} clipId={clip.id} copy={copy} disabled={blocked} />
				: <ClipPropertiesBody key={targetKey} controller={controller} snapshot={{ ...snapshot, project }} copy={copy} clipId={clip?.id} />}
		{error && <p role="alert">{error}</p>}
	</div>;
}
