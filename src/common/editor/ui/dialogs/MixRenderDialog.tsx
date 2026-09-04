/* SPDX-License-Identifier: AGPL-3.0-only */

import React, {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { Flyout } from '@soundscaper/design-system/Flyout';

import '../audio-editor-design-system/28-mix-render.css';

import type { MixRenderOptions } from '../../controller/mix-render-options.ts';
import {
	mixRenderOutputChannelChoices,
	predictMixRenderOutputChannelCount,
} from '../../controller/mix-render-output-layout.ts';
import { selectAudioTracksForMix } from '../../controller/mix-render-model.ts';
import type { ControllerProject } from '../../controller/track-domain-types.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { retainAudioEditorDialogEscapeOwner } from '../dialog-escape-ownership.ts';
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
	readonly helpMenu: string;
}

interface TooltipAnchor {
	readonly direction: 'down' | 'up';
	readonly x: number;
	readonly y: number;
}

type TooltipVisibilityReason = 'focus' | 'pointer' | 'press';

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
			{error && <p className="audio-editor-mix-render__message audio-editor-mix-render__error" role="alert">
				{error}
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
	const tooltipId = useId();
	const helpRef = useRef<HTMLButtonElement | null>(null);
	const visibilityReasonsRef = useRef(new Set<TooltipVisibilityReason>());
	const [tooltip, setTooltip] = useState<TooltipAnchor | null>(null);
	const tooltipOpen = tooltip !== null;
	const positionTooltip = useCallback((): void => {
		const bounds = helpRef.current?.getBoundingClientRect();
		if (!bounds) return;
		const viewportHeight = Number(window.innerHeight) || 768;
		const direction = bounds.top >= viewportHeight - bounds.bottom ? 'up' : 'down';
		setTooltip({
			direction,
			x: bounds.left + bounds.width / 2,
			y: direction === 'up' ? bounds.top : bounds.bottom,
		});
	}, []);
	const showTooltip = useCallback((reason: TooltipVisibilityReason): void => {
		visibilityReasonsRef.current.add(reason);
		positionTooltip();
	}, [positionTooltip]);
	const hideTooltip = useCallback((reason: TooltipVisibilityReason): void => {
		visibilityReasonsRef.current.delete(reason);
		if (visibilityReasonsRef.current.size === 0) setTooltip(null);
	}, []);
	const dismissTooltip = useCallback((): void => {
		visibilityReasonsRef.current.clear();
		setTooltip(null);
	}, []);
	useEffect(() => {
		if (!tooltip) return undefined;
		window.addEventListener('resize', positionTooltip);
		window.addEventListener('scroll', positionTooltip, true);
		return () => {
			window.removeEventListener('resize', positionTooltip);
			window.removeEventListener('scroll', positionTooltip, true);
		};
	}, [positionTooltip, tooltip]);
	useLayoutEffect(() => {
		if (!tooltipOpen) return undefined;
		return retainAudioEditorDialogEscapeOwner(document, dismissTooltip);
	}, [dismissTooltip, tooltipOpen]);
	return <div className="audio-editor-mix-render__option">
		<div className="audio-editor-mix-render__option-heading">
			<PreferenceCheckbox label={label} ariaDescribedBy={descriptionId}
				checked={checked} disabled={disabled} onChange={onChange} />
			<span
				className="audio-editor-mix-render__help-wrap"
				onPointerEnter={() => showTooltip('pointer')}
				onPointerLeave={() => hideTooltip('pointer')}
			>
				<button
					ref={helpRef}
					type="button"
					className="audio-editor-mix-render__help"
					aria-label={`${helpLabel}: ${label}`}
					aria-describedby={tooltip ? tooltipId : descriptionId}
					data-mix-render-help={helpHook}
					data-tooltip-ignore
					onFocus={() => showTooltip('focus')}
					onBlur={() => hideTooltip('focus')}
					onClick={() => {
						if (visibilityReasonsRef.current.has('press')) hideTooltip('press');
						else showTooltip('press');
					}}
				>
					<svg aria-hidden="true" viewBox="0 0 12 12">
						<circle cx="6" cy="2.5" r="1" fill="currentColor" />
						<path d="M6 5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
				</button>
				{tooltip && <Flyout
					id={tooltipId}
					isOpen
					onClose={dismissTooltip}
					x={tooltip.x}
					y={tooltip.y}
					direction={tooltip.direction}
					showArrow
					closeOnOutsideClick
					closeOnEscape={false}
					ariaLabel={description}
					role="tooltip"
					className="audio-editor-mix-render__tooltip"
				>
					<span data-mix-render-tooltip={helpHook}>{description}</span>
				</Flyout>}
			</span>
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
