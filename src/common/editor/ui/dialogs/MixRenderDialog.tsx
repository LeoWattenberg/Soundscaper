/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import '../audio-editor-design-system/28-mix-render.css';

import type { MixRenderOptions } from '../../controller/mix-render-options.ts';
import { predictMixRenderOutputChannelCount } from '../../controller/mix-render-output-layout.ts';
import { selectAudioTracksForMix } from '../../controller/mix-render-model.ts';
import type { ControllerProject } from '../../controller/track-domain-types.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { formatLocalizedTemplate } from '../localization-template.ts';
import {
	runAwaitedAudioEditorOperation,
	type AudioEditorWorkspaceRunner,
} from '../workspace/audio-editor-workspace-runner.ts';

interface MixRenderDialogCopy {
	readonly mixRenderTitle: string;
	readonly mixDown: string;
	readonly mixDownToMono: string;
	readonly mixDownToStereo: string;
	readonly mixDownToChannels: string;
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
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const activeOperationRef = useRef<symbol | null>(null);
	const outputChannelCount = useMemo(() => project
		? predictMixRenderOutputChannelCount(project, targetTracks, renderEffects)
		: null, [project, renderEffects, targetTracks]);
	const mixDownLabel = outputLayoutLabel(copy, outputChannelCount);

	useEffect(() => {
		activeOperationRef.current = null;
		setMixDown(true);
		setRenderEffects(true);
		setReplaceOriginals(true);
		setPending(false);
		setError('');
	}, [projectId]);
	useEffect(() => () => { activeOperationRef.current = null; }, []);

	const emptyOperation = !mixDown && !renderEffects;
	const submitDisabled = pending || emptyOperation || outputChannelCount === null;
	const submit = (): void => {
		if (submitDisabled || activeOperationRef.current !== null) return;
		const operationId = Symbol('mix-render');
		const submittedProjectId = projectId;
		const options: MixRenderOptions = { mixDown, renderEffects, replaceOriginals };
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
				label={mixDownLabel}
				description={copy.mixDownDescription}
				checked={mixDown}
				disabled={pending}
				onChange={setMixDown}
			/>
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

function Option({ label, description, checked, disabled, onChange }: Readonly<{
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onChange(checked: boolean): void;
}>) {
	const descriptionId = useId();
	return <div className="audio-editor-mix-render__option">
		<PreferenceCheckbox label={label} ariaDescribedBy={descriptionId}
			checked={checked} disabled={disabled} onChange={onChange} />
		<p id={descriptionId}>{description}</p>
	</div>;
}

export function outputLayoutLabel(copy: MixRenderDialogCopy, channelCount: number | null): string {
	if (channelCount === 1) return copy.mixDownToMono;
	if (channelCount === 2) return copy.mixDownToStereo;
	if (channelCount !== null && channelCount > 2) {
		return formatLocalizedTemplate(copy.mixDownToChannels, { count: channelCount });
	}
	return copy.mixDown;
}
