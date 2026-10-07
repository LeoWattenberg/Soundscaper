/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperImageClipV1 } from '../../timeline-image-model.ts';
import { useImageClipPropertiesTarget } from './useClipPropertyPresentation.ts';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';

interface ImageClipPropertiesBodyProps {
	readonly controller: object;
	readonly project: unknown;
	readonly clipId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
}

/** Still-image timing belongs to its sequence; it has no audio sample clock. */
export default function ImageClipPropertiesBody({ controller, project, clipId, copy, disabled }: ImageClipPropertiesBodyProps) {
	const { clip, source, track, rate, sampleRate } = useImageClipPropertiesTarget(project, clipId);
	const [error, setError] = usePresentationFeedback(copy);
	const commit = (field: 'sequenceStartFrame' | 'sequenceFrameCount', value: number): unknown => {
		if (disabled) return false;
		try {
			const updated = normalizeFramescaperImageClipV1({ ...clip, [field]: value });
			const editor = controller as { readonly actions: { readonly edit: { commit(command: unknown): unknown } } };
			const placement = { scope: 'timeline', trackId: track.id };
			const result = editor.actions.edit.commit({ type: 'image-clip/set', clipId,
				expectedClip: clip, expectedPlacement: placement, clip: updated, placement });
			setError('');
			return result;
		} catch (cause) { setError(feedbackFailure(cause)); return false; }
	};
	return <div className="audio-editor-clip-inspector">
		<div className="audio-editor-clip-properties" data-clip-fields aria-disabled={disabled}>
			<details className="audio-editor-clip-properties__drawer" data-clip-properties-drawer="media">
				<summary><h3>{copy.clipMediaSettings}</h3></summary>
				<div className="audio-editor-clip-properties__drawer-content">
					<label className="audio-editor-field"><span>{copy.clipName}</span>
						<input value={String(source?.name ?? copy.clip)} readOnly /></label>
					<div className="audio-editor-clip-properties__time-grid">
						<label className="audio-editor-field" data-clip-field="startFrame"><span>{copy.clipStart}</span>
							<AudioEditorTimeCodeInput label={copy.clipStart} value={clip.sequenceStartFrame}
								unit="frames" rate={rate.num / rate.den} sampleRate={sampleRate} format="hh:mm:ss+milliseconds"
								disabled={disabled} onCommit={value => commit('sequenceStartFrame', value)} /></label>
						<label className="audio-editor-field" data-clip-field="durationFrame"><span>{copy.clipDuration}</span>
							<AudioEditorTimeCodeInput label={copy.clipDuration} value={clip.sequenceFrameCount}
								unit="frames" rate={rate.num / rate.den} sampleRate={sampleRate} format="hh:mm:ss+milliseconds"
								minimum={1} disabled={disabled} onCommit={value => commit('sequenceFrameCount', value)} /></label>
					</div>
				</div>
			</details>
		</div>
		{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
	</div>;
}
