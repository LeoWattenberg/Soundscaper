import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useId, useMemo, useRef, useState } from 'react';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import '../audio-editor-design-system/28-mix-render.css';

import type { MixRenderOptions } from '../../controller/track-audio/mix-render-options.ts';
import {
	mixRenderOutputChannelChoices,
	nonemptyAudioTargets,
	predictMixRenderOutputChannelCount,
} from '../../controller/track-audio/mix-render-output-layout.ts';
import { selectAudioTracksForMix } from '../../controller/track-audio/mix-render-model.ts';
import type { ControllerProject } from '../../controller/track-audio/track-domain-types.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import EditorHelpTooltip from '../EditorHelpTooltip.tsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { LabeledDropdown } from '../inspector/inspector-controls.jsx';
import { formatLocalizedTemplate } from '../localization-template.ts';
import { useOwnedDialogOperation } from '../useOwnedDialogOperation.ts';
import type { AudioEditorWorkspaceRunner } from '../workspace/audio-editor-workspace-runner.ts';

interface MixRenderDialogCopy {
	readonly mixRenderTitle: string;
	readonly mixDown: string;
	readonly mixDownTo: string;
	readonly mixDownMono: string;
	readonly mixDownStereo: string;
	readonly mixDownChannels: string;
	readonly mixDownDescription: string;
	readonly renderEffects: string;
	readonly renderEffectsDescription: string;
	readonly replaceOriginals: string;
	readonly replaceOriginalsDescription: string;
	readonly mixRenderNoOperation: string;
	readonly mixRenderLockedOriginals: string;
	readonly cancel: string;
	readonly helpMenu: string;
}

interface MixRenderDialogProps {
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly track: Readonly<{
				mixAndRender(options: MixRenderOptions): unknown;
			}>;
		}>;
	}>;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<{
		readonly project?: ControllerProject | null;
		readonly selectedTrackId?: string | null;
		readonly selectedClipId?: string | null;
	}>;
	readonly copy: MixRenderDialogCopy;
	readonly run: AudioEditorWorkspaceRunner;
	readonly onClose: () => void;
}

export default function MixRenderDialog({
	controller,
	snapshot,
	copy,
	run,
	onClose,
}: MixRenderDialogProps) {
	const project = snapshot.project ?? null;
	const projectId = project?.id ?? null;
	const targetTracks = useMemo(() => project ? selectAudioTracksForMix(
		project,
		snapshot.selectedTrackId ?? null,
		snapshot.selectedClipId ?? null,
	) : [], [project, snapshot.selectedClipId, snapshot.selectedTrackId]);
	const [mixDown, setMixDown] = useState(true);
	const [renderEffects, setRenderEffects] = useState(true);
	const [replaceOriginals, setReplaceOriginals] = useState(true);
	const predictedOutputChannelCount = useMemo(() => project
		? predictMixRenderOutputChannelCount(project, targetTracks, true)
		: null, [project, targetTracks]);
	const [mixDownChannelCount, setMixDownChannelCount] = useState(
		predictedOutputChannelCount ?? 2,
	);
	const defaultOutputChannelCountRef = useRef(predictedOutputChannelCount ?? 2);
	defaultOutputChannelCountRef.current = predictedOutputChannelCount ?? 2;
	const [error, setError] = usePresentationFeedback(copy);
	const outputChannelCounts = useMemo(
		() => project ? mixRenderOutputChannelChoices(project) : Object.freeze([1, 2]),
		[project],
	);
	const outputChannelOptions = useMemo(() => outputChannelCounts.map((channelCount) => ({
		value: String(channelCount),
		label: outputLayoutChoiceLabel(copy, channelCount),
	})), [copy, outputChannelCounts]);

	const emptyOperation = !mixDown && !renderEffects;
	const lockedReplacement = replaceOriginals && Boolean(project
		&& nonemptyAudioTargets(project, targetTracks).some(track => track.locked === true));
	const operation = useOwnedDialogOperation({
		owner: projectId,
		blocked: selectAudioEditorEditBlock(snapshot).blocked || emptyOperation || lockedReplacement || predictedOutputChannelCount === null,
		run,
		onOwnerChange: () => {
			setMixDown(true);
			setRenderEffects(true);
			setReplaceOriginals(true);
			setMixDownChannelCount(defaultOutputChannelCountRef.current);
			setError('');
		},
	});

	const pending = operation.pending !== null;
	const submitDisabled = operation.disabled;
	const feedback = error || (lockedReplacement ? copy.mixRenderLockedOriginals : '');
	const submit = (): void => {
		const options = {
			mixDown,
			renderEffects,
			replaceOriginals,
			...(mixDown ? { mixDownChannelCount } : {}),
		};
		operation.perform('mix-render', () => controller.actions.track.mixAndRender(options), {
			onStart: () => { setError(''); },
			onSuccess: onClose,
			onFailure: (operationError) => {
				setError(feedbackFailure(operationError));
			},
		});
	};

	return <AudioEditorDialogShell
		title={copy.mixRenderTitle}
		onClose={pending ? undefined : onClose}
		width={520}
		initialFocus="[role='checkbox']"
		dataAttributes={{ 'data-mix-render-dialog': 'true' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			primaryText={copy.mixRenderTitle}
			secondaryText={copy.cancel}
			onPrimaryClick={submit}
			onSecondaryClick={onClose}
			primaryDisabled={submitDisabled}
			secondaryDisabled={pending}
		/>}
	>
		<form className="audio-editor-mix-render" aria-busy={pending} onSubmit={(event) => {
			event.preventDefault();
			submit();
		}}>
			<Option
				label={copy.mixDown}
				description={copy.mixDownDescription}
				checked={mixDown}
				disabled={pending}
				onChange={setMixDown}
				helpLabel={copy.helpMenu}
				helpHook="mix-down"
			>
				<div className="audio-editor-mix-render__layout" data-mix-render-channel-count>
					<LabeledDropdown
						label={copy.mixDownTo}
						hook={null}
						value={String(mixDownChannelCount)}
						disabled={pending || !mixDown}
						options={outputChannelOptions}
						onChange={(value: string) => {
							const channelCount = Number(value);
							if (outputChannelCounts.includes(channelCount)) {
								setMixDownChannelCount(channelCount);
							}
						}}
					/>
				</div>
			</Option>
			<Option
				label={copy.renderEffects}
				description={copy.renderEffectsDescription}
				checked={renderEffects}
				disabled={pending}
				onChange={setRenderEffects}
				helpLabel={copy.helpMenu}
				helpHook="render-effects"
			/>
			<Option
				label={copy.replaceOriginals}
				description={copy.replaceOriginalsDescription}
				checked={replaceOriginals}
				disabled={pending}
				onChange={setReplaceOriginals}
				helpLabel={copy.helpMenu}
				helpHook="replace-originals"
			/>
			{emptyOperation && <p className="audio-editor-mix-render__message" role="status">
				{copy.mixRenderNoOperation}
			</p>}
			{feedback && <p className="audio-editor-mix-render__message audio-editor-mix-render__error" role="alert">
				{feedback}
			</p>}
		</form>
	</AudioEditorDialogShell>;
}

function Option({
	label,
	description,
	checked,
	disabled,
	onChange,
	helpLabel,
	helpHook,
	children,
}: Readonly<{
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onChange(checked: boolean): void;
	helpLabel: string;
	helpHook: string;
	children?: React.ReactNode;
}>) {
	const descriptionId = useId();
	return <div className="audio-editor-mix-render__option">
		<div className="audio-editor-mix-render__option-heading">
			<PreferenceCheckbox label={label} ariaDescribedBy={descriptionId}
				checked={checked} disabled={disabled} onChange={onChange} />
			<EditorHelpTooltip
				subject={label}
				description={description}
				helpLabel={helpLabel}
				hook={helpHook}
				hookAttribute="data-mix-render-help"
				tooltipHookAttribute="data-mix-render-tooltip"
				describedBy={descriptionId}
			/>
			<span id={descriptionId} className="kw-audio-editor-sr-only">{description}</span>
		</div>
		{children}
	</div>;
}

export function outputLayoutChoiceLabel(copy: MixRenderDialogCopy, channelCount: number): string {
	if (channelCount === 1) return copy.mixDownMono;
	if (channelCount === 2) return copy.mixDownStereo;
	return formatLocalizedTemplate(copy.mixDownChannels, { count: channelCount });
}
