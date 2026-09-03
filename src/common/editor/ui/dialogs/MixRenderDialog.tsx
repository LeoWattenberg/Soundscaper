/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import '../audio-editor-design-system/28-mix-render.css';

import type { MixRenderOptions } from '../../controller/mix-render-options.ts';
import {
	mixRenderOutputChannelChoices,
	predictMixRenderOutputChannelCount,
} from '../../controller/mix-render-output-layout.ts';
import { selectAudioTracksForMix } from '../../controller/mix-render-model.ts';
import type { ControllerProject } from '../../controller/track-domain-types.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { LabeledDropdown } from '../inspector/inspector-controls.jsx';
import { formatLocalizedTemplate } from '../localization-template.ts';
import {
	runAwaitedAudioEditorOperation,
	type AudioEditorWorkspaceRunner,
} from '../workspace/audio-editor-workspace-runner.ts';

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
	readonly cancel: string;
}

interface MixRenderDialogProps {
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly track: Readonly<{
				mixAndRender(options: MixRenderOptions): unknown;
			}>;
		}>;
	}>;
	readonly snapshot: Readonly<{
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
	const currentProjectIdRef = useRef(projectId);
	currentProjectIdRef.current = projectId;
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
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const activeOperationRef = useRef<symbol | null>(null);
	const outputChannelCounts = useMemo(
		() => project ? mixRenderOutputChannelChoices(project) : Object.freeze([1, 2]),
		[project],
	);
	const outputChannelOptions = useMemo(() => outputChannelCounts.map((channelCount) => ({
		value: String(channelCount),
		label: outputLayoutChoiceLabel(copy, channelCount),
	})), [copy, outputChannelCounts]);

	useEffect(() => {
		activeOperationRef.current = null;
		setMixDown(true);
		setRenderEffects(true);
		setReplaceOriginals(true);
		setMixDownChannelCount(defaultOutputChannelCountRef.current);
		setPending(false);
		setError('');
	}, [projectId]);
	useEffect(() => () => { activeOperationRef.current = null; }, []);

	const emptyOperation = !mixDown && !renderEffects;
	const submitDisabled = pending || emptyOperation || predictedOutputChannelCount === null;
	const submit = (): void => {
		if (submitDisabled || activeOperationRef.current !== null) return;
		const operationId = Symbol('mix-render');
		const submittedProjectId = projectId;
		const options = {
			mixDown,
			renderEffects,
			replaceOriginals,
			...(mixDown ? { mixDownChannelCount } : {}),
		};
		activeOperationRef.current = operationId;
		setPending(true);
		setError('');
		void runAwaitedAudioEditorOperation(run, () => {
			if (currentProjectIdRef.current !== submittedProjectId) return undefined;
			return controller.actions.track.mixAndRender(options);
		}).then(() => {
			if (activeOperationRef.current !== operationId
				|| currentProjectIdRef.current !== submittedProjectId) return;
			onClose();
		}).catch((operationError: unknown) => {
			if (activeOperationRef.current !== operationId
				|| currentProjectIdRef.current !== submittedProjectId) return;
			setError(operationError instanceof Error ? operationError.message : String(operationError));
		}).finally(() => {
			if (activeOperationRef.current !== operationId) return;
			activeOperationRef.current = null;
			setPending(false);
		});
	};

	return <AudioEditorDialogShell
		title={copy.mixRenderTitle}
		onClose={pending ? undefined : onClose}
		width={520}
		initialFocus="[role='checkbox']"
		dataAttributes={{ 'data-mix-render-dialog': 'true' }}
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
			/>
			<Option
				label={copy.replaceOriginals}
				description={copy.replaceOriginalsDescription}
				checked={replaceOriginals}
				disabled={pending}
				onChange={setReplaceOriginals}
			/>
			{emptyOperation && <p className="audio-editor-mix-render__message" role="status">
				{copy.mixRenderNoOperation}
			</p>}
			{error && <p className="audio-editor-mix-render__message audio-editor-mix-render__error" role="alert">
				{error}
			</p>}
			<div className="kw-audio-editor-dialog__actions">
				<button type="button" disabled={pending} onClick={onClose}>{copy.cancel}</button>
				<button type="submit" disabled={submitDisabled}>{copy.mixRenderTitle}</button>
			</div>
		</form>
	</AudioEditorDialogShell>;
}

function Option({ label, description, checked, disabled, onChange, children }: Readonly<{
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onChange(checked: boolean): void;
	children?: React.ReactNode;
}>) {
	const descriptionId = useId();
	return <div className="audio-editor-mix-render__option">
		<PreferenceCheckbox label={label} ariaDescribedBy={descriptionId}
			checked={checked} disabled={disabled} onChange={onChange} />
		{children}
		<p id={descriptionId}>{description}</p>
	</div>;
}

export function outputLayoutChoiceLabel(copy: MixRenderDialogCopy, channelCount: number): string {
	if (channelCount === 1) return copy.mixDownMono;
	if (channelCount === 2) return copy.mixDownStereo;
	return formatLocalizedTemplate(copy.mixDownChannels, { count: channelCount });
}
