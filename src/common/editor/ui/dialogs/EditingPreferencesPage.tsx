/* SPDX-License-Identifier: AGPL-3.0-only */

import { Fragment, type ReactNode } from 'react';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { Separator } from '@soundscaper/design-system/Separator';

import {
	AUDIO_EDITOR_DEFAULT_ZOOM_PRECISION,
	AUDIO_EDITOR_MAXIMUM_ZOOM_PRECISION,
	AUDIO_EDITOR_MINIMUM_ZOOM_PRECISION,
	AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS,
	type AudioEditorEditingPreferences,
	type AudioEditorRippleMode,
	type AudioEditorZoomTogglePreset,
} from '../../editing-preferences.ts';
import { AUDIO_EDITOR_BUILT_IN_WORKSPACES } from '../../workspace-layout-defaults.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

interface EditingPreferencesCopy {
	readonly allTracks: string;
	readonly editingAlwaysConvertToMono: string;
	readonly editingApplyEffectsToAllAudio: string;
	readonly editingAsymmetricAlways: string;
	readonly editingAsymmetricNever: string;
	readonly editingAsymmetricStereoHeights: string;
	readonly editingAsymmetricStereoHeightsDescription: string;
	readonly editingAsymmetricWorkspace: string;
	readonly editingCloseGapAllTracks: string;
	readonly editingCloseGapBehavior: string;
	readonly editingCloseGapClip: string;
	readonly editingCloseGapRipple: string;
	readonly editingCloseGapTrack: string;
	readonly editingDeleteBehavior: string;
	readonly editingEffectBehavior: string;
	readonly editingLeaveGap: string;
	readonly editingMonoStereoConversion: string;
	readonly editingPasteBehavior: string;
	readonly editingPasteInsertAllTracks: string;
	readonly editingPasteInsertBehavior: string;
	readonly editingPasteInsertTrack: string;
	readonly editingPasteOverlaps: string;
	readonly editingPastePushes: string;
	readonly editingAlwaysPasteAsNewClip: string;
	readonly editingZoomFitToWidth: string;
	readonly editingZoomFourPixelsPerSample: string;
	readonly editingZoomMax: string;
	readonly editingZoomMilliseconds: string;
	readonly editingZoomMinutes: string;
	readonly editingZoomPreset100ths: string;
	readonly editingZoomPreset10ths: string;
	readonly editingZoomPreset20ths: string;
	readonly editingZoomPreset500ths: string;
	readonly editingZoomPreset50ths: string;
	readonly editingZoomPreset5ths: string;
	readonly editingZoomSamples: string;
	readonly editingZoomSeconds: string;
	readonly editingZoomState1: string;
	readonly editingZoomState2: string;
	readonly editingZoomToggle: string;
	readonly editingZoomToggleDescription: string;
	readonly editingZoomToSelection: string;
	readonly editingZoomDefault: string;
	readonly editingWorkspaces: string;
	readonly mouseZoomPrecision: string;
	readonly mouseZoomPrecisionNote: string;
	readonly preferenceOff: string;
	readonly preferencePerTrack: string;
	readonly rippleEditing: string;
	readonly snapZeroCrossings: string;
	readonly workspaceAudacity: string;
	readonly workspaceClassic: string;
	readonly workspaceModern: string;
	readonly workspaceMusic: string;
	readonly workspaceVideo: string;
}

interface CustomWorkspace {
	readonly id: string;
	readonly name: string;
}

interface EditingPagePreferences {
	readonly editing: AudioEditorEditingPreferences;
	readonly workspace: {
		readonly custom: readonly CustomWorkspace[];
	};
}

type EditingUpdate = Partial<AudioEditorEditingPreferences>;

interface EditingPreferencesController {
	readonly actions: {
		readonly preferences: {
			readonly update: (changes: { readonly editing: EditingUpdate }) => unknown;
		};
	};
}

interface EditingPreferencesPageProps {
	readonly controller: EditingPreferencesController;
	readonly preferences: EditingPagePreferences;
	readonly copy: EditingPreferencesCopy;
	readonly run: (operation: () => unknown) => unknown;
}

interface RadioChoice<Value extends string> {
	readonly value: Value;
	readonly label: string;
}

interface PreferenceRadioGroupProps<Value extends string> {
	readonly ariaLabel: string;
	readonly name: string;
	readonly value: Value;
	readonly choices: readonly RadioChoice<Value>[];
	readonly onChange: (value: Value) => void;
	readonly afterChoice?: (value: Value) => ReactNode;
}

const ZOOM_PRESET_COPY_KEYS = Object.freeze({
	'fit-to-width': 'editingZoomFitToWidth',
	'zoom-to-selection': 'editingZoomToSelection',
	'zoom-default': 'editingZoomDefault',
	minutes: 'editingZoomMinutes',
	seconds: 'editingZoomSeconds',
	'5ths-of-seconds': 'editingZoomPreset5ths',
	'10ths-of-seconds': 'editingZoomPreset10ths',
	'20ths-of-seconds': 'editingZoomPreset20ths',
	'50ths-of-seconds': 'editingZoomPreset50ths',
	'100ths-of-seconds': 'editingZoomPreset100ths',
	'500ths-of-seconds': 'editingZoomPreset500ths',
	milliseconds: 'editingZoomMilliseconds',
	samples: 'editingZoomSamples',
	'four-pixels-per-sample': 'editingZoomFourPixelsPerSample',
	'max-zoom': 'editingZoomMax',
} satisfies Readonly<Record<AudioEditorZoomTogglePreset, keyof EditingPreferencesCopy>>);

const BUILT_IN_WORKSPACE_COPY_KEYS = Object.freeze({
	classic: 'workspaceClassic',
	music: 'workspaceMusic',
	modern: 'workspaceModern',
	audacity: 'workspaceAudacity',
	'video-editor': 'workspaceVideo',
} satisfies Readonly<Record<typeof AUDIO_EDITOR_BUILT_IN_WORKSPACES[number], keyof EditingPreferencesCopy>>);

/** Audacity 4's Audio editing preferences, backed by the editor preference model. */
export default function EditingPreferencesPage({
	controller,
	preferences,
	copy,
	run,
}: EditingPreferencesPageProps) {
	const editing = preferences.editing;
	const updateEditing = (changes: EditingUpdate) => run(() => (
		controller.actions.preferences.update({ editing: changes })
	));
	const workspaces = [
		...AUDIO_EDITOR_BUILT_IN_WORKSPACES.map((id) => ({ id, label: copy[BUILT_IN_WORKSPACE_COPY_KEYS[id]] })),
		...preferences.workspace.custom.map(({ id, name }) => ({ id, label: name })),
	];
	const selectedWorkspaceIds = new Set(editing.asymmetricStereoHeightWorkspaces);
	const setWorkspaceEnabled = (workspaceId: string, enabled: boolean) => updateEditing({
		asymmetricStereoHeightWorkspaces: workspaces
			.map(({ id }) => id)
			.filter((id) => id === workspaceId ? enabled : selectedWorkspaceIds.has(id)),
	});
	const zoomOptions = AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS.map((value) => ({
		value,
		label: copy[ZOOM_PRESET_COPY_KEYS[value]],
	}));

	return (
		<div className="kw-audio-editor-preferences__editing" data-editing-preferences>
			<section data-editing-preferences-section="effect-behavior">
				<PreferencePanel title={copy.editingEffectBehavior}>
					<PreferenceCheckbox
						label={copy.editingApplyEffectsToAllAudio}
						checked={editing.applyEffectsToAllAudio}
						onChange={(checked) => updateEditing({ applyEffectsToAllAudio: checked })}
					/>
				</PreferencePanel>
			</section>
			<Separator />

			<section data-editing-preferences-section="delete-behavior">
				<PreferencePanel title={copy.editingDeleteBehavior}>
					<PreferenceRadioGroup
						ariaLabel={copy.editingDeleteBehavior}
						name="audio-editor-delete-behavior"
						value={editing.deleteBehavior}
						onChange={(deleteBehavior) => updateEditing({ deleteBehavior })}
						choices={[
							{ value: 'leave-gap', label: copy.editingLeaveGap },
							{ value: 'close-gap', label: copy.editingCloseGapRipple },
						]}
					/>
					{editing.deleteBehavior === 'close-gap' && (
						<div>
							<p className="kw-audio-editor-preferences__note">{copy.editingCloseGapBehavior}</p>
							<PreferenceRadioGroup
								ariaLabel={copy.editingCloseGapBehavior}
								name="audio-editor-close-gap-behavior"
								value={editing.closeGapBehavior}
								onChange={(closeGapBehavior) => updateEditing({ closeGapBehavior })}
								choices={[
									{ value: 'clip', label: copy.editingCloseGapClip },
									{ value: 'track', label: copy.editingCloseGapTrack },
									{ value: 'all-tracks', label: copy.editingCloseGapAllTracks },
								]}
							/>
						</div>
					)}
					<div className="kw-audio-editor-preferences__grid">
						<PreferenceDropdownField
							label={copy.rippleEditing}
							value={editing.rippleMode}
							onChange={(rippleMode: AudioEditorRippleMode) => updateEditing({ rippleMode })}
							options={[
								{ value: 'off', label: copy.preferenceOff },
								{ value: 'per-track', label: copy.preferencePerTrack },
								{ value: 'all-tracks', label: copy.allTracks },
							]}
						/>
					</div>
					<div className="kw-audio-editor-preferences__checks">
						<PreferenceCheckbox
							label={copy.snapZeroCrossings}
							checked={editing.snapToZeroCrossings}
							onChange={(snapToZeroCrossings) => updateEditing({ snapToZeroCrossings })}
						/>
					</div>
				</PreferencePanel>
			</section>
			<Separator />

			<section data-editing-preferences-section="paste-behavior">
				<PreferencePanel title={copy.editingPasteBehavior}>
					<PreferenceRadioGroup
						ariaLabel={copy.editingPasteBehavior}
						name="audio-editor-paste-behavior"
						value={editing.pasteBehavior}
						onChange={(pasteBehavior) => updateEditing({ pasteBehavior })}
						choices={[
							{ value: 'overlap', label: copy.editingPasteOverlaps },
							{ value: 'insert', label: copy.editingPastePushes },
						]}
					/>
					{editing.pasteBehavior === 'insert' && (
						<div>
							<p className="kw-audio-editor-preferences__note">{copy.editingPasteInsertBehavior}</p>
							<PreferenceRadioGroup
								ariaLabel={copy.editingPasteInsertBehavior}
								name="audio-editor-paste-insert-behavior"
								value={editing.pasteInsertBehavior}
								onChange={(pasteInsertBehavior) => updateEditing({ pasteInsertBehavior })}
								choices={[
									{ value: 'track', label: copy.editingPasteInsertTrack },
									{ value: 'all-tracks', label: copy.editingPasteInsertAllTracks },
								]}
							/>
						</div>
					)}
					<PreferenceCheckbox
						label={copy.editingAlwaysPasteAsNewClip}
						checked={editing.alwaysPasteAsNewClip}
						onChange={(alwaysPasteAsNewClip) => updateEditing({ alwaysPasteAsNewClip })}
					/>
				</PreferencePanel>
			</section>
			<Separator />

			<section data-editing-preferences-section="asymmetric-stereo-heights">
				<PreferencePanel title={copy.editingAsymmetricStereoHeights}>
					<p className="kw-audio-editor-preferences__note">
						{copy.editingAsymmetricStereoHeightsDescription}
					</p>
					<PreferenceRadioGroup
						ariaLabel={copy.editingAsymmetricStereoHeights}
						name="audio-editor-asymmetric-stereo-heights"
						value={editing.asymmetricStereoHeights}
						onChange={(asymmetricStereoHeights) => updateEditing({ asymmetricStereoHeights })}
						choices={[
							{ value: 'always', label: copy.editingAsymmetricAlways },
							{ value: 'workspace-dependent', label: copy.editingAsymmetricWorkspace },
							{ value: 'never', label: copy.editingAsymmetricNever },
						]}
						afterChoice={(value) => value === 'workspace-dependent'
							&& editing.asymmetricStereoHeights === 'workspace-dependent' && (
							<div
								className="kw-audio-editor-preferences__checks"
								role="group"
								aria-label={copy.editingWorkspaces}
							>
								{workspaces.map(({ id, label }) => (
									<div key={id} data-asymmetric-stereo-workspace={id}>
										<PreferenceCheckbox
											label={label}
											checked={selectedWorkspaceIds.has(id)}
											onChange={(checked) => setWorkspaceEnabled(id, checked)}
										/>
									</div>
								))}
							</div>
						)}
					/>
				</PreferencePanel>
			</section>
			<Separator />

			<section data-editing-preferences-section="mono-stereo-conversion">
				<PreferencePanel title={copy.editingMonoStereoConversion}>
					<PreferenceCheckbox
						label={copy.editingAlwaysConvertToMono}
						checked={editing.alwaysConvertToMono}
						onChange={(alwaysConvertToMono) => updateEditing({ alwaysConvertToMono })}
					/>
				</PreferencePanel>
			</section>
			<Separator />

			<section data-editing-preferences-section="zoom-toggle">
				<PreferencePanel title={copy.editingZoomToggle}>
					<p className="kw-audio-editor-preferences__note">{copy.editingZoomToggleDescription}</p>
					<div className="kw-audio-editor-preferences__grid">
						<PreferenceDropdownField
							label={copy.editingZoomState1}
							value={editing.zoomTogglePreset1}
							onChange={(zoomTogglePreset1: AudioEditorZoomTogglePreset) => updateEditing({ zoomTogglePreset1 })}
							options={zoomOptions}
						/>
						<PreferenceDropdownField
							label={copy.editingZoomState2}
							value={editing.zoomTogglePreset2}
							onChange={(zoomTogglePreset2: AudioEditorZoomTogglePreset) => updateEditing({ zoomTogglePreset2 })}
							options={zoomOptions}
						/>
						<label className="kw-audio-editor-preferences__field">
							<span>{copy.mouseZoomPrecision}</span>
							<input
								type="number"
								min={AUDIO_EDITOR_MINIMUM_ZOOM_PRECISION}
								max={AUDIO_EDITOR_MAXIMUM_ZOOM_PRECISION}
								step="1"
								aria-label={copy.mouseZoomPrecision}
								value={editing.zoomPrecision ?? AUDIO_EDITOR_DEFAULT_ZOOM_PRECISION}
								onChange={(event) => {
									const zoomPrecision = Number(event.currentTarget.value);
									if (!Number.isInteger(zoomPrecision)
										|| zoomPrecision < AUDIO_EDITOR_MINIMUM_ZOOM_PRECISION
										|| zoomPrecision > AUDIO_EDITOR_MAXIMUM_ZOOM_PRECISION) return;
									updateEditing({ zoomPrecision });
								}}
							/>
						</label>
					</div>
					<p className="kw-audio-editor-preferences__note">{copy.mouseZoomPrecisionNote}</p>
				</PreferencePanel>
			</section>
		</div>
	);
}

function PreferenceRadioGroup<Value extends string>({
	ariaLabel,
	name,
	value,
	choices,
	onChange,
	afterChoice,
}: PreferenceRadioGroupProps<Value>) {
	return (
		<div className="kw-audio-editor-preferences__startup" role="radiogroup" aria-label={ariaLabel}>
			{choices.map((choice) => (
				<Fragment key={choice.value}>
					<div className="kw-audio-editor-preferences__startup-row">
						<label>
							<input
								type="radio"
								name={name}
								value={choice.value}
								checked={value === choice.value}
								onChange={() => onChange(choice.value)}
							/>
							<span>{choice.label}</span>
						</label>
					</div>
					{afterChoice?.(choice.value)}
				</Fragment>
			))}
		</div>
	);
}
