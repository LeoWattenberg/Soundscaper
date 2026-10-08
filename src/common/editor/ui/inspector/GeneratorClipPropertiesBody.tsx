/* SPDX-License-Identifier: AGPL-3.0-only */

import AudioEditorTimeCodeInput, { audioEditorProjectSampleRate } from '../AudioEditorTimeCodeInput.tsx';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';

interface Props {
	readonly controller: object;
	readonly project: unknown;
	readonly clipId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
}

/** Generated media uses its existing native timeline edits, never audio-source trimming. */
export default function GeneratorClipPropertiesBody({ controller, project, clipId, copy, disabled }: Props) {
	const owner = record(project);
	const clip = records(owner.clips).find(item => item.id === clipId);
	const source = records(owner.sources).find(item => item.id === clip?.sourceId);
	const track = records(owner.tracks).find(item => Array.isArray(item.clipIds) && item.clipIds.includes(clipId));
	if (clip?.kind !== 'generator' || !source || !track) throw new ReferenceError('Generator properties require their timeline source and track.');
	const sampleRate = audioEditorProjectSampleRate(project);
	const [error, setError] = usePresentationFeedback(copy);
	const commit = (field: 'startFrame' | 'durationFrame', value: number): unknown => {
		if (disabled) return false;
		const editor = controller as { readonly actions: { readonly clip: {
			move(id: string, trackId: string, frame: number, options: Readonly<{ exactFrame: true }>): unknown;
			trim(id: string, changes: Readonly<{ durationFrames: number }>): unknown;
		} } };
		try {
			const result = field === 'startFrame'
				? editor.actions.clip.move(clipId, String(track.id), value, { exactFrame: true })
				: editor.actions.clip.trim(clipId, { durationFrames: value });
			setError(''); return result;
		} catch (cause) { setError(feedbackFailure(cause)); return false; }
	};
	return <div className="audio-editor-clip-inspector">
		<div className="audio-editor-clip-properties" data-clip-fields aria-disabled={disabled}>
			<details className="audio-editor-clip-properties__drawer" data-clip-properties-drawer="media">
				<summary><h3>{copy.clipMediaSettings}</h3></summary>
				<div className="audio-editor-clip-properties__drawer-content">
					<label className="audio-editor-field"><span>{copy.clipName}</span>
						<input value={String(source.name ?? copy.clip)} readOnly /></label>
					<div className="audio-editor-clip-properties__time-grid">
						{(['startFrame', 'durationFrame'] as const).map(field => <label key={field} className="audio-editor-field" data-clip-field={field}>
							<span>{field === 'startFrame' ? copy.clipStart : copy.clipDuration}</span>
							<AudioEditorTimeCodeInput label={field === 'startFrame' ? copy.clipStart : copy.clipDuration}
								value={Number(field === 'startFrame' ? clip.timelineStartFrame : clip.durationFrames)}
								unit="samples" rate={sampleRate} format="hh:mm:ss+milliseconds"
								minimum={field === 'startFrame' ? 0 : 1} disabled={disabled} onCommit={value => commit(field, value)} />
						</label>)}
					</div>
				</div>
			</details>
		</div>
		{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
	</div>;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Generator properties require a document record.');
	return value as Readonly<Record<string, unknown>>;
}
function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError('Generator properties require a document collection.');
	return value.map(record);
}
