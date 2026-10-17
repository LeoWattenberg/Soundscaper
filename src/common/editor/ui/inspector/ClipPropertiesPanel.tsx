/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from 'react';
import UpstreamClipPropertiesPanel from '@soundscaper/design-system/ClipPropertiesPanel/ClipPropertiesPanel';
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
import { upstreamClipPropertiesLabels } from './upstream-clip-properties-copy.ts';
import ClipPropertiesColorPicker from './ClipPropertiesColorPicker.tsx';
import ClipAudioSettingsMenu from './ClipAudioSettingsMenu.tsx';
import { clipPropertiesTimeFields } from './ClipPropertiesTimeFields.tsx';
import { NumberField } from '@soundscaper/design-system/ClipPropertiesPanel/clip-properties-controls';
import { PitchGlyph } from '@soundscaper/design-system/ClipPropertiesPanel/clip-properties-glyphs';
import { clipLinkedPitchSpeed } from './clip-properties-linked-pitch.ts';
import { clipPitchInUnit, clipPitchUnitToCents } from './inspector-helpers.ts';

export type { ClipPropertiesFocusRequest } from '../../controller/composition/clip-properties-panel-opening.ts';
interface Props {
	readonly controller: object;
	readonly run: (operation: () => unknown) => unknown;
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
		readonly clipSourcePreview?: { trim(id: string, changes: Readonly<Record<string, number>>): unknown; focus(id: string): unknown };
		readonly preferences: { setPanelVisibility(panel: string, visible: boolean): unknown };
	};
}

/** Upstream glyph fields and merged selections, with the editor's native commands. */
export default function ClipPropertiesPanel({ controller, snapshot, copy, focusRequest = null, panelActive = true, runtimeProject = null, run: runCommand }: Props) {
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
	const [nativeTimeFields, setNativeTimeFields] = useState(false);
	const [pitchUnit, setPitchUnit] = useState<'semitones' | 'percent'>('semitones');
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
	const ownsTarget = () => mounted.current && liveTarget.current === targetKey
		&& !('project' in editor && editor.project?.id !== project?.id);
	const run = (operation: () => unknown) => {
		if (blocked || !ownsTarget()) return;
		return runCommand(() => Promise.resolve(operation()).catch(cause => { if (ownsTarget()) throw cause; }));
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
	const trimSourceFrame = (edge: 'start' | 'end', sourceFrame: number) => run(() => {
		if (!clip || !source || !project) return;
		const changes = clipSourceTrim(clip as Parameters<typeof clipSourceTrim>[0], source as Parameters<typeof clipSourceTrim>[1], project.sampleRate, edge, sourceFrame, project as unknown as ClipSourceTimingProject);
		return editor.actions.clipSourcePreview ? editor.actions.clipSourcePreview.trim(clip.id, changes) : editor.actions.clip.trim(clip.id, changes);
	});
	const trim = (edge: 'start' | 'end', seconds: number) => {
		const frames = Math.round(seconds * (source?.sampleRate || project?.sampleRate || 48_000));
		return trimSourceFrame(edge, edge === 'start' ? frames : (source?.frameCount ?? 0) - frames);
	};
	const setDuration = (durationFrames: number) => run(() => {
		if (!clip || !source || !project) return;
		const loop = readClipLoop(clip);
		if (loop) return editor.actions.clip.update(clip.id, { loop: { ...loop, durationFrames } });
		const changes = clipPropertiesMediaRange(clip as Parameters<typeof clipPropertiesMediaRange>[0], source.frameCount ?? 0, 'durationFrame', durationFrames,
			{ project: project as unknown as ClipSourceTimingProject, source: source as ClipSourceTimingSource });
		return editor.actions.clipSourcePreview ? editor.actions.clipSourcePreview.trim(clip.id, changes) : editor.actions.clip.trim(clip.id, changes);
	});
	const setStart = (frames: number) => run(() => clip && editor.actions.clip.move(clip.id, presentation.tracks[0]!.id, frames, { exactFrame: true }));
	const setFade = (side: 'in' | 'out', frames: number) => update(clip => ({ [side === 'in' ? 'fadeInFrames' : 'fadeOutFrames']: Math.min(clip.durationFrames, Math.max(0, frames)) }));
	const timingFields = nativeTimeFields && clip && source && project && !presentation.selection ? clipPropertiesTimeFields({
		controller: controller as Parameters<typeof clipPropertiesTimeFields>[0]['controller'], clip, source, sampleRate: project.sampleRate, copy, disabled: blocked,
		onStart: setStart, onDuration: setDuration, onFade: setFade,
		onTrimStart: readClipLoop(clip) ? undefined : frames => trimSourceFrame('start', frames),
		onTrimEnd: readClipLoop(clip) ? undefined : frames => trimSourceFrame('end', (source.frameCount ?? 0) - frames),
	}) : undefined;
	const reportFailure = (cause: unknown) => { runCommand(() => { throw cause; }); };
	const enabled = !blocked;
	const capabilities = snapshot.capabilities as { readonly audioEffects?: boolean } | undefined;
	const timePitchEnabled = enabled && capabilities?.audioEffects !== false;
	const shapeLabels: Record<string, string> = { linear: copy.fadeShapeLinear, logarithmic: copy.fadeShapeLogarithmic,
		exponential: copy.fadeShapeExponential, 's-curve': copy.fadeShapeSCurve, 'constant-power': copy.fadeShapeConstantPower };
	return <div ref={root} className="audio-editor-upstream-clip-properties" data-upstream-clip-properties data-native-time-fields={nativeTimeFields || undefined} tabIndex={-1}>
		{audio ? <><fieldset>
			<UpstreamClipPropertiesPanel key={targetKey} clip={presentation.clip} selection={presentation.selection}
				labels={upstreamClipPropertiesLabels(copy)} timingFields={timingFields}
				colors={[]}
				colorControl={<ClipPropertiesColorPicker key={targetKey} copy={copy} color={presentation.selection?.color ?? presentation.clip?.color}
					disabled={blocked} onChange={color => update(() => ({ color }))} />}
				onOpenSource={clip ? () => { if (ownsTarget()) runCommand(() => Promise.resolve(editor.actions.preferences.setPanelVisibility('source-monitor', true))
					.then(() => liveTarget.current === targetKey && (!('project' in editor) || editor.project?.id === project?.id) ? editor.actions.clipSourcePreview?.focus(clip.id) : undefined)); } : undefined}
				tracks={(project?.tracks ?? []).filter(track => track.type === 'audio' && !track.locked).map(track => ({ id: track.id, label: track.name }))}
				fadeShapes={END_FADE_SHAPE_PRESETS.map(preset => ({ ...preset, shape: preset.shape ?? 'linear', label: shapeLabels[preset.id]! }))}
				onRename={enabled && clip ? name => update(() => ({ title: name })) : undefined}
				onColorChange={enabled ? color => update(() => ({ color: color === 'track' ? 'auto' : color })) : undefined}
				onTrackChange={enabled ? trackId => run(() => editor.actions.edit.commit({ type: 'batch', commands: presentation.clips.map(clip => ({ type: 'clip/move', clipId: clip.id, trackId, timelineStartFrame: clip.timelineStartFrame })) })) : undefined}
				onStartChange={enabled && clip && project ? seconds => setStart(Math.max(0, Math.round(seconds * project.sampleRate))) : undefined}
				onDurationChange={enabled && clip && source && project ? seconds => setDuration(Math.max(1, Math.round(seconds * project.sampleRate))) : undefined}
				onTrimStartChange={enabled && !readClipLoop(clip ?? {}) ? seconds => trim('start', seconds) : undefined}
				onTrimEndChange={enabled && !readClipLoop(clip ?? {}) ? seconds => trim('end', seconds) : undefined}
				onFadeChange={enabled && project ? (side, seconds) => setFade(side, Math.round(seconds * project.sampleRate)) : undefined}
				onFadeShapeChange={enabled ? (side, id) => { const preset = END_FADE_SHAPE_PRESETS.find(preset => preset.id === id); if (preset) update(() => ({ [side === 'in' ? 'fadeInShape' : 'fadeOutShape']: preset.shape })); } : undefined}
				pitchControl={<NumberField testId="pitch" label={pitchUnit === 'percent' ? copy.clipPitchPercent : copy.clipPitchField} glyph={<PitchGlyph />}
					value={presentation.selection?.pitchSemitones === 'mixed' ? 'mixed' : Number(clipPitchInUnit((presentation.selection?.pitchSemitones ?? presentation.clip?.pitchSemitones ?? 0) * 100, pitchUnit))}
					step={pitchUnit === 'percent' ? 0.1 : 1} digits={pitchUnit === 'percent' ? 3 : 2}
					onCommit={timePitchEnabled ? value => { run(() => {
						if (presentation.clips.every(clip => clip.linkPitchAndTempo)) setTimePitch({ speedRatio: clipLinkedPitchSpeed(value, pitchUnit, copy.clipLinkedPitchRange) });
						else setTimePitch({ pitchCents: clipPitchUnitToCents(value, pitchUnit, copy) });
					}); } : undefined} />}
				onSpeedChange={timePitchEnabled ? percent => setTimePitch({ speedRatio: percent / 100 }) : undefined}
				onReverseChange={timePitchEnabled && !presentation.clips.some(clip => (clip as { readonly warpMap?: unknown }).warpMap != null) ? reversed => update(() => ({ reversed })) : undefined}
				onResetPitchSpeed={timePitchEnabled ? () => setTimePitch({ pitchCents: 0, speedRatio: 1, preserveFormants: false }) : undefined} />
		</fieldset>
			{clip && source && !presentation.selection && <ClipAudioSettingsMenu key={`settings:${targetKey}`} controller={controller} clip={clip} source={source}
				copy={copy} disabled={blocked} effectsEnabled={capabilities?.audioEffects !== false} run={run}
				nativeTimeFields={nativeTimeFields} onNativeTimeFields={() => setNativeTimeFields(value => !value)}
				pitchUnit={pitchUnit} onPitchUnit={setPitchUnit} />}
		</> : clip?.kind === 'image' ? <ImageClipPropertiesBody controller={controller} project={snapshot.project} clipId={clip.id} copy={copy} disabled={blocked} onError={reportFailure} />
			: clip?.kind === 'generator' ? <GeneratorClipPropertiesBody controller={controller} project={project} clipId={clip.id} copy={copy} disabled={blocked} onError={reportFailure} />
				: <ClipPropertiesBody key={targetKey} controller={controller} snapshot={{ ...snapshot, project }} copy={copy} clipId={clip?.id} onError={reportFailure} />}
	</div>;
}
