/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { ContextMenuItem } from '@dilsonspickles/components';

import AudioEditorSplitButton from '../AudioEditorSplitButton.tsx';
import {
	FRAMESCAPER_CAPTURE_PANEL_ID,
	capturePrimaryAction,
	framescaperCaptureRecordVisible,
	persistFramescaperCaptureToolbarOptIn,
	readFramescaperCaptureToolbarOptIn,
	type FramescaperCaptureUiSnapshot,
} from '../framescaper-capture-ui-model.ts';

interface CaptureActions {
	start?(): unknown;
	pause?(): unknown;
	resume?(): unknown;
	stop?(): unknown;
	recover?(): unknown;
	importAsIs?(): unknown;
	discard?(): unknown;
}

interface CaptureController {
	readonly actions: Readonly<{
		readonly capture?: CaptureActions;
		readonly preferences: Readonly<{
			setPanel(panelId: string, changes: Readonly<{ visible: boolean }>): unknown;
		}>;
	}>;
}

interface CaptureRecordSnapshot {
	readonly productId?: string;
	readonly capture?: FramescaperCaptureUiSnapshot;
	readonly preferences?: Readonly<{
		readonly workspace?: Readonly<{
			readonly panels?: Readonly<Record<string, Readonly<{ readonly visible?: boolean }> | undefined>>;
		}>;
	}>;
	readonly readOnly?: boolean;
}

interface FramescaperCaptureRecordControlProps {
	readonly controller: CaptureController;
	readonly snapshot: CaptureRecordSnapshot;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly blocked: boolean;
	run(action: () => unknown): unknown;
}

export function useFramescaperCaptureRecordVisibility(snapshot: CaptureRecordSnapshot): boolean {
	const productId = snapshot.productId ?? 'soundscaper';
	const panelVisible = snapshot.preferences?.workspace?.panels?.[FRAMESCAPER_CAPTURE_PANEL_ID]?.visible === true;
	const [locallyOptedIn, setLocallyOptedIn] = useState(() => readFramescaperCaptureToolbarOptIn(
		typeof localStorage === 'undefined' ? null : localStorage,
	));
	useEffect(() => {
		if (productId !== 'framescaper' || !panelVisible || locallyOptedIn) return;
		persistFramescaperCaptureToolbarOptIn(typeof localStorage === 'undefined' ? null : localStorage);
		setLocallyOptedIn(true);
	}, [locallyOptedIn, panelVisible, productId]);
	return framescaperCaptureRecordVisible(productId, snapshot.capture, locallyOptedIn);
}

export default function FramescaperCaptureRecordControl({
	controller,
	snapshot,
	copy,
	blocked,
	run,
}: FramescaperCaptureRecordControlProps) {
	const capture = snapshot.capture;
	if (!capture) return null;
	const actions = controller.actions.capture;
	const recordingBlocked = Boolean(blocked || snapshot.readOnly);
	const primary = capturePrimaryAction(capture);
	const active = ['countdown', 'recording', 'paused'].includes(capture.phase);
	const openSetup = (): void => {
		void run(() => controller.actions.preferences.setPanel(FRAMESCAPER_CAPTURE_PANEL_ID, { visible: true }));
		if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined') return;
		requestAnimationFrame(() => {
			const panel = document.querySelector(`[data-workspace-panel="${FRAMESCAPER_CAPTURE_PANEL_ID}"]`);
			if (!(panel instanceof HTMLElement)) return;
			panel.tabIndex = -1;
			panel.focus({ preventScroll: false });
		});
	};
	const invoke = (operation: (() => unknown) | undefined): void => {
		if (operation) void run(operation);
	};
	const executePrimary = (): void => {
		if (primary.kind === 'start' && recordingBlocked) return;
		switch (primary.kind) {
			case 'start': invoke(actions?.start); break;
			case 'stop': invoke(actions?.stop); break;
			case 'open-setup': openSetup(); break;
			case 'finalizing': break;
		}
	};
	const primaryLabel = primary.kind === 'start'
		? copy.captureStart
		: primary.kind === 'stop'
			? copy.captureStopImport
			: primary.kind === 'finalizing'
				? copy.captureFinalizing
				: copy.panelRecordingSetup;
	const actionAvailable = primary.kind === 'start'
		? Boolean(actions?.start)
		: primary.kind === 'stop'
			? Boolean(actions?.stop)
			: primary.kind === 'open-setup';
	const disabled = primary.disabled
		|| !actionAvailable
		|| (primary.kind === 'start' && recordingBlocked);

	return <span data-transport="framescaper-record" data-capture-active={active || undefined}>
		<AudioEditorSplitButton
			icon="record"
			className="kw-audio-editor__transport-record kw-framescaper-capture-record"
			ariaLabel={String(primaryLabel)}
			optionsAriaLabel={String(copy.captureOptions)}
			recording={active}
			pressed={active}
			disabled={disabled}
			onClick={disabled ? undefined : executePrimary}
		>
			{({ close }) => <div className="kw-audio-editor__split-button-options" data-framescaper-capture-record-options>
				<CaptureMenuItem label={copy.panelRecordingSetup} onClick={openSetup} close={close} />
				<CaptureMenuItem label={copy.captureStart}
					disabled={recordingBlocked || capture.phase !== 'armed' || !actions?.start}
					onClick={() => invoke(actions?.start)} close={close} />
				<CaptureMenuItem label={capture.phase === 'paused' ? copy.captureResume : copy.capturePause}
					disabled={!['recording', 'paused'].includes(capture.phase)
						|| (capture.phase === 'paused' ? !actions?.resume : !actions?.pause)}
					onClick={() => invoke(capture.phase === 'paused' ? actions?.resume : actions?.pause)} close={close} />
				<CaptureMenuItem label={copy.captureStopImport}
					disabled={!['countdown', 'recording', 'paused'].includes(capture.phase) || !actions?.stop}
					onClick={() => invoke(actions?.stop)} close={close} />
				{capture.phase === 'recovery' && <>
					<ContextMenuItem isDivider />
					<CaptureMenuItem label={copy.captureRecover} disabled={recordingBlocked || !actions?.recover}
						onClick={() => invoke(actions?.recover)} close={close} />
					<CaptureMenuItem label={copy.captureImportAsIs}
						disabled={recordingBlocked || !actions?.importAsIs}
						onClick={() => invoke(actions?.importAsIs)} close={close} />
					<CaptureMenuItem label={copy.captureDelete} disabled={!actions?.discard}
						onClick={() => invoke(actions?.discard)} close={close} />
				</>}
			</div>}
		</AudioEditorSplitButton>
	</span>;
}

function CaptureMenuItem({
	label,
	disabled = false,
	onClick,
	close,
}: Readonly<{
	label: string | undefined;
	disabled?: boolean;
	onClick(): void;
	close(): void;
}>) {
	return <ContextMenuItem
		label={String(label)}
		disabled={disabled}
		onClick={disabled ? undefined : () => {
			close();
			onClick();
		}}
	/>;
}
