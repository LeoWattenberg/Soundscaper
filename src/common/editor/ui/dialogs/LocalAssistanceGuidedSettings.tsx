/* SPDX-License-Identifier: AGPL-3.0-only */

import { LOCAL_ASSISTANCE_ADDITIONAL_COPY } from '../../../i18n/editor-local-assistance-additional-copy.ts';

/** Workflow-specific Guided controls that always emit a complete settings-v1 body. */

import { Children, isValidElement, type ReactNode } from 'react';
import { Checkbox } from '@soundscaper/design-system/Checkbox';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

import type {
	AssistanceWorkflowSettingsV1,
} from '../../assistance/workflow-settings-v1.ts';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';

type Copy = Readonly<Record<string, string | undefined>>;
type EditorialField = 'title' | 'hook' | 'chapters' | 'explanation';

export interface LocalAssistanceGuidedSettingsProps {
	readonly copy: Copy;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly disabled: boolean;
	readonly onChange: (settings: AssistanceWorkflowSettingsV1) => unknown;
}

export default function LocalAssistanceGuidedSettings({
	copy, settings, disabled, onChange,
}: LocalAssistanceGuidedSettingsProps) {
	const commit = (next: AssistanceWorkflowSettingsV1): void => { void onChange(next); };
	switch (settings.workflowId) {
		case 'transcribe-captions': return <SettingsGroup copy={copy}>
			<SelectSetting label={text(copy, 'localAssistanceRecognizer', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceRecognizer)}
				value={settings.recognizer} disabled={disabled} onChange={(recognizer) => commit({
					...settings, recognizer: recognizer as 'parakeet' | 'whisper',
				})}>
				<option value="parakeet">{text(copy, 'localAssistanceRecognizerParakeet', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceRecognizerParakeet)}</option>
				<option value="whisper">{text(copy, 'localAssistanceRecognizerWhisper', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceRecognizerWhisper)}</option>
			</SelectSetting>
			<SelectSetting label={text(copy, 'localAssistanceLanguage', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceLanguage)}
				value={settings.language} disabled={disabled} onChange={(language) => commit({
					...settings, language: language as 'auto' | 'en',
				})}>
				<option value="auto">{text(copy, 'localAssistanceLanguageAuto', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceLanguageAuto)}</option>
				<option value="en">{text(copy, 'localAssistanceLanguageEnglish', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceLanguageEnglish)}</option>
			</SelectSetting>
			<CheckboxSetting disabled={disabled || settings.recognizer !== 'whisper'}
				checked={settings.englishWhisperAlignment === 'when-installed'}
				onChange={(checked) => commit({ ...settings,
					englishWhisperAlignment: checked ? 'when-installed' : 'off' })}>
				{text(copy, 'localAssistanceEnglishAlignment',
					'Use installed wav2vec2 alignment for English Whisper')}
			</CheckboxSetting>
		</SettingsGroup>;
		case 'clean-filler-silence': return <SettingsGroup copy={copy}>
			<SelectSetting label={text(copy, 'localAssistanceCleanupPreset', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceCleanupPreset)}
				value={settings.preset} disabled={disabled} onChange={(preset) => commit({
					...settings, preset: preset as 'conservative' | 'balanced' | 'aggressive',
				})}>
				<option value="conservative">{text(copy, 'localAssistanceCleanupPresetConservative',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceCleanupPresetConservative)}</option>
				<option value="balanced">{text(copy, 'localAssistanceCleanupPresetBalanced', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceCleanupPresetBalanced)}</option>
				<option value="aggressive">{text(copy, 'localAssistanceCleanupPresetAggressive',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceCleanupPresetAggressive)}</option>
			</SelectSetting>
		</SettingsGroup>;
		case 'identify-speakers': return <FixedSettings copy={copy}>
			{text(copy, 'localAssistanceAnonymousSpeakers',
				LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceAnonymousSpeakers)}
		</FixedSettings>;
		case 'enhance-dialogue': return <SettingsGroup copy={copy}>
			<SelectSetting label={text(copy, 'localAssistancePlacement', 'Acceptance placement')}
				value={settings.placement} disabled={disabled} onChange={(placement) => commit({
					...settings, placement: placement as 'project-bin' | 'replace-selection',
				})}>
				<option value="project-bin">{text(copy, 'localAssistanceProjectBin', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceProjectBin)}</option>
				<option value="replace-selection">{text(copy, 'localAssistanceReplaceSelection',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceReplaceSelection)}</option>
			</SelectSetting>
		</SettingsGroup>;
		case 'reduce-reverb': return <SettingsGroup copy={copy}>
			<SelectSetting label={text(copy, 'localAssistancePlacement', 'Acceptance placement')}
				value={settings.placement} disabled={disabled} onChange={(placement) => commit({
					...settings, placement: placement as 'project-bin' | 'replace-selection',
				})}>
				<option value="project-bin">{text(copy, 'localAssistanceProjectBin', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceProjectBin)}</option>
				<option value="replace-selection">{text(copy, 'localAssistanceReplaceSelection',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceReplaceSelection)}</option>
			</SelectSetting>
		</SettingsGroup>;
		case 'separate-dialogue-music-effects': return <SettingsGroup copy={copy}>
			<SelectSetting label={text(copy, 'localAssistancePlacement', 'Acceptance placement')}
				value={settings.placement} disabled={disabled} onChange={(placement) => commit({
					...settings, placement: placement as 'project-bin' | 'muted-aligned-tracks',
				})}>
				<option value="project-bin">{text(copy, 'localAssistanceProjectBin', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceProjectBin)}</option>
				<option value="muted-aligned-tracks">{text(copy, 'localAssistanceMutedAlignedStems',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceMutedAlignedStems)}</option>
			</SelectSetting>
		</SettingsGroup>;
		case 'mark-reactions': return <SettingsGroup copy={copy}>
			<NumberSetting label={text(copy, 'localAssistanceReactionThreshold', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceReactionThreshold)}
				value={settings.threshold} min={0} max={1} step={0.05} disabled={disabled}
				onChange={(threshold) => commit({ ...settings, threshold })} />
		</SettingsGroup>;
		case 'index-transcript': return <FixedSettings copy={copy}>
			{text(copy, 'localAssistanceTranscriptChunking',
				'256-token document chunks with a 32-token overlap.')}
		</FixedSettings>;
		case 'detect-beats-tempo': return <SettingsGroup copy={copy}>
			<CheckboxSetting disabled={disabled} checked={settings.publishBeatLabels}
				onChange={(publishBeatLabels) => commit({ ...settings, publishBeatLabels })}>
				{text(copy, 'localAssistancePublishBeatLabels', 'Publish an owned Beats label track')}
			</CheckboxSetting>
			<CheckboxSetting disabled={disabled} checked={settings.applyTempoMap}
				onChange={(applyTempoMap) => commit({ ...settings, applyTempoMap })}>
				{text(copy, 'localAssistanceApplyTempoMap', 'Offer the exactly representable tempo-map diff')}
			</CheckboxSetting>
		</SettingsGroup>;
		case 'mark-cuts': return <ModeSettings copy={copy} name="guided-mark-cuts-mode"
			legend={text(copy, 'localAssistanceShotDetectionMode', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceShotDetectionMode)}
			value={settings.mode} disabled={disabled}
			onChange={(mode) => commit({ ...settings, mode })} />;
		case 'index-video': return <SettingsGroup copy={copy}>
			<ModeSettings copy={copy} name="guided-index-video-mode"
				legend={text(copy, 'localAssistanceShotDetectionMode', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceShotDetectionMode)}
				value={settings.shotMode} disabled={disabled}
				onChange={(shotMode) => commit({ ...settings, shotMode })} />
			<CheckboxSetting disabled={disabled} checked={settings.includeOcr}
				onChange={(includeOcr) => commit({ ...settings, includeOcr })}>
				{text(copy, 'localAssistanceIncludeOcr', 'Index visible text with PP-OCR')}
			</CheckboxSetting>
		</SettingsGroup>;
		case 'reframe': return <SettingsGroup copy={copy}>
			<NumberSetting label={text(copy, 'localAssistanceAspectWidth', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceAspectWidth)}
				value={settings.targetAspectWidth} min={Math.ceil(settings.targetAspectHeight / 4)}
				max={Math.min(64, settings.targetAspectHeight * 4)} step={1} disabled={disabled}
				onChange={(targetAspectWidth) => commit({ ...settings, targetAspectWidth })} />
			<NumberSetting label={text(copy, 'localAssistanceAspectHeight', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceAspectHeight)}
				value={settings.targetAspectHeight} min={Math.ceil(settings.targetAspectWidth / 4)}
				max={Math.min(64, settings.targetAspectWidth * 4)} step={1} disabled={disabled}
				onChange={(targetAspectHeight) => commit({ ...settings, targetAspectHeight })} />
		</SettingsGroup>;
		case 'make-highlights': return <SettingsGroup copy={copy}>
			<NumberSetting label={text(copy, 'localAssistanceHighlightCount', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceHighlightCount)}
				value={settings.resultCount} min={1} max={20} step={1} disabled={disabled}
				onChange={(resultCount) => commit({ ...settings, resultCount })} />
			<TimeSetting label={text(copy, 'localAssistanceHighlightMaximum',
				LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceHighlightMaximum)} value={settings.maximumDurationSeconds}
				min={15} max={180} disabled={disabled}
				onChange={(maximumDurationSeconds) => commit({ ...settings, maximumDurationSeconds })} />
			<CheckboxSetting disabled={disabled} checked={settings.editorialRerank}
				onChange={(editorialRerank) => commit({ ...settings, editorialRerank })}>
				{text(copy, 'localAssistanceHighlightEditorialRerank',
					'Use installed Qwen to rerank known candidates')}
			</CheckboxSetting>
			<p>{text(copy, 'localAssistanceHighlightFormat', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceHighlightFormat)}</p>
		</SettingsGroup>;
		case 'generate-editorial-text': return <SettingsGroup copy={copy}>
			<CheckboxSetting disabled={disabled} checked={settings.enabled}
				onChange={(enabled) => commit({ ...settings, enabled })}>
				{text(copy, 'localAssistanceEnableEditorial', 'Run installed Qwen editorial generation')}
			</CheckboxSetting>
			<div className="kw-local-assistance__guided-fields">
				{(['title', 'hook', 'chapters', 'explanation'] as const).map((field) =>
					<CheckboxSetting key={field} disabled={disabled || (settings.fields.length === 1
						&& settings.fields[0] === field)} checked={settings.fields.includes(field)}
						onChange={(checked) => commit({ ...settings,
							fields: toggleEditorialField(settings.fields, field, checked) })}>
						{editorialLabel(copy, field)}
					</CheckboxSetting>)}
			</div>
		</SettingsGroup>;
		default: return <FixedSettings copy={copy}>
			{text(copy, 'localAssistanceAdvancedFixedSettings',
				LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceAdvancedFixedSettings)}
		</FixedSettings>;
	}
}

function SettingsGroup({ copy, children }: Readonly<{ copy: Copy; children: ReactNode }>) {
	return <fieldset className="kw-local-assistance__guided-settings-controls">
		<legend>{text(copy, 'localAssistanceWorkflowSettings', 'Workflow settings')}</legend>
		{children}
	</fieldset>;
}

function FixedSettings({ copy, children }: Readonly<{ copy: Copy; children: ReactNode }>) {
	return <SettingsGroup copy={copy}><p>{children}</p></SettingsGroup>;
}

function SelectSetting({ label, value, disabled, onChange, children }: Readonly<{
	label: string; value: string; disabled: boolean; onChange: (value: string) => unknown;
	children: ReactNode;
}>) {
	const options = Children.toArray(children).filter(isValidElement<{ value: string; children: ReactNode }>)
		.map((child) => ({ value: child.props.value, label: String(child.props.children) }));
	return <PreferenceDropdownField label={label} value={value} disabled={disabled} options={options}
		onChange={(next: string) => { void onChange(next); }} />;
}

function CheckboxSetting({ disabled, checked, onChange, children }: Readonly<{
	disabled: boolean; checked: boolean; onChange: (checked: boolean) => unknown; children: ReactNode;
}>) {
	return <div className="kw-processing-checkbox"><Checkbox disabled={disabled} checked={checked}
		aria-label={typeof children === 'string' ? children : undefined}
		onChange={(value) => { void onChange(value); }} /><span>{children}</span></div>;
}

function NumberSetting({ label, value, min, max, step, disabled, onChange }: Readonly<{
	label: string; value: number; min: number; max: number; step: number; disabled: boolean;
	onChange: (value: number) => unknown;
}>) {
	return <label>{label}<input type="number" value={value} min={min} max={max} step={step}
		disabled={disabled} onChange={(event) => {
			if (event.currentTarget.value !== '') void onChange(event.currentTarget.valueAsNumber);
		}} /></label>;
}

function TimeSetting({ label, value, min, max, disabled, onChange }: Readonly<{
	label: string; value: number; min: number; max: number; disabled: boolean;
	onChange: (value: number) => unknown;
}>) {
	return <label>{label}<AudioEditorTimeCodeInput label={label} value={value}
		minimum={min} maximum={max} disabled={disabled}
		onChange={(next) => { void onChange(next); }} /></label>;
}

function ModeSettings({ copy, name, legend, value, disabled, onChange }: Readonly<{
	copy: Copy; name: string; legend: string; value: 'fast' | 'accurate'; disabled: boolean;
	onChange: (value: 'fast' | 'accurate') => unknown;
}>) {
	return <fieldset className="kw-local-assistance__guided-mode" disabled={disabled}>
		<legend>{legend}</legend>
		<label><input type="radio" name={name} value="fast" checked={value === 'fast'}
			onChange={() => { void onChange('fast'); }} />
			{text(copy, 'localAssistanceShotDetectionFast', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceShotDetectionFast)}</label>
		<label><input type="radio" name={name} value="accurate" checked={value === 'accurate'}
			onChange={() => { void onChange('accurate'); }} />
			{text(copy, 'localAssistanceShotDetectionAccurate', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceShotDetectionAccurate)}</label>
	</fieldset>;
}

function toggleEditorialField(
	fields: readonly EditorialField[], field: EditorialField, checked: boolean,
): readonly EditorialField[] {
	return checked ? Object.freeze([...fields, field])
		: Object.freeze(fields.filter((candidate) => candidate !== field));
}

function editorialLabel(copy: Copy, field: EditorialField): string {
	const labels: Readonly<Record<EditorialField, string>> = {
		title: text(copy, 'localAssistanceEditorialTitle', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceEditorialTitle),
		hook: text(copy, 'localAssistanceEditorialHook', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceEditorialHook),
		chapters: text(copy, 'localAssistanceEditorialChapters', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceEditorialChapters),
		explanation: text(copy, 'localAssistanceEditorialExplanation', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceEditorialExplanation),
	};
	return labels[field];
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[`ui.localAssistance.${key}`] || copy[key] || fallback;
}
