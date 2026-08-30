/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';

import AudioEditorSplitButton from '../AudioEditorSplitButton.tsx';
import {
	FRAMESCAPER_CAPTURE_PANEL_ID,
	capturePrimaryAction,
	framescaperCaptureRecordRequired,
	framescaperCaptureRecordVisible,
	persistFramescaperCaptureToolbarOptIn,
	readFramescaperCaptureToolbarOptIn,
	type FramescaperCaptureUiSnapshot,
} from '../framescaper-capture-ui-model.ts';
import {
	type WebVcrUiActions,
	type WebVcrUiSnapshot,
	webVcrCapabilityAvailable,
	webVcrPhaseIsActive,
	webVcrPrimaryAction,
} from '../web-vcr-ui-model.ts';

export { framescaperCaptureRecordRequired };

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
		readonly webVcr?: WebVcrUiActions;
		readonly preferences: Readonly<{
			setPanel(panelId: string, changes: Readonly<{ visible: boolean }>): unknown;
		}>;
	}>;
}

interface CaptureRecordSnapshot {
	readonly productId?: string;
	readonly capture?: FramescaperCaptureUiSnapshot;
	readonly webVcr?: WebVcrUiSnapshot;
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

export function framescaperCaptureRecordControlVisible(
	snapshot: Pick<CaptureRecordSnapshot, 'productId' | 'webVcr'> & Readonly<{
		readonly capture?: Pick<FramescaperCaptureUiSnapshot, 'phase'>;
	}>,
	locallyOptedIn: boolean,
): boolean {
	const productId = snapshot.productId ?? 'soundscaper';
	return productId === 'framescaper'
		&& framescaperCaptureRecordVisible(productId, snapshot.capture, locallyOptedIn);
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
	return framescaperCaptureRecordControlVisible(snapshot, locallyOptedIn);
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
	const webVcr = snapshot.webVcr;
	const webVcrActions = controller.actions.webVcr;
	const webVcrAvailable = webVcrCapabilityAvailable(webVcr);
	const webVcrActive = webVcr?.modeActive === true;
	const recordingBlocked = Boolean(blocked || snapshot.readOnly);
	const recoveryBlocked = Boolean(blocked);
	const capturePrimary = capturePrimaryAction(capture);
	const webVcrPrimary = webVcrPrimaryAction(webVcr);
	const active = webVcrActive && webVcr
		? webVcrPhaseIsActive(webVcr.phase)
		: ['countdown', 'recording', 'paused'].includes(capture.phase);
	const openSetup = (): void => {
		if (webVcrActive) invoke(webVcrActions?.close);
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
		if (webVcrActive) {
			if (webVcrPrimary.kind === 'record' && recordingBlocked) return;
			if (webVcrPrimary.kind === 'record') invoke(webVcrActions?.record);
			if (webVcrPrimary.kind === 'stop') invoke(webVcrActions?.stopAndImport);
			return;
		}
		if (capturePrimary.kind === 'start' && recordingBlocked) return;
		switch (capturePrimary.kind) {
			case 'start': invoke(actions?.start); break;
			case 'stop': invoke(actions?.stop); break;
			case 'open-setup': openSetup(); break;
			case 'finalizing': break;
		}
	};
	const primaryLabel = webVcrActive
		? webVcrPrimary.kind === 'record'
			? copy.webVcrRecord
			: webVcrPrimary.kind === 'stop'
				? copy.captureStopImport
				: webVcrPrimary.kind === 'finalizing'
					? copy.captureFinalizing
					: copy.webVcrTitle
		: capturePrimary.kind === 'start'
			? copy.captureStart
			: capturePrimary.kind === 'stop'
				? copy.captureStopImport
				: capturePrimary.kind === 'finalizing'
					? copy.captureFinalizing
					: copy.panelRecordingSetup;
	const actionAvailable = webVcrActive
		? webVcrPrimary.kind === 'record'
			? Boolean(webVcrActions?.record)
			: webVcrPrimary.kind === 'stop'
				? Boolean(webVcrActions?.stopAndImport)
				: false
		: capturePrimary.kind === 'start'
			? Boolean(actions?.start)
			: capturePrimary.kind === 'stop'
				? Boolean(actions?.stop)
				: capturePrimary.kind === 'open-setup';
	const disabled = (webVcrActive ? webVcrPrimary.disabled : capturePrimary.disabled)
		|| !actionAvailable
		|| ((webVcrActive ? webVcrPrimary.kind === 'record' : capturePrimary.kind === 'start')
			&& recordingBlocked);

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
				<CaptureMenuItem label={copy.panelRecordingSetup}
					disabled={Boolean(webVcrActive && webVcr && webVcrPhaseIsActive(webVcr.phase))}
					onClick={openSetup} close={close} />
				{webVcrAvailable && <CaptureMenuItem label={copy.webVcrMenu}
					disabled={!webVcrActions?.activate}
					onClick={() => invoke(webVcrActions?.activate)} close={close} />}
				{!webVcrActive && <CaptureMenuItem label={copy.captureStart}
					disabled={recordingBlocked || capture.phase !== 'armed' || !actions?.start}
					onClick={() => invoke(actions?.start)} close={close} />}
				{!webVcrActive && <CaptureMenuItem label={capture.phase === 'paused' ? copy.captureResume : copy.capturePause}
					disabled={!['recording', 'paused'].includes(capture.phase)
						|| (capture.phase === 'paused' ? !actions?.resume : !actions?.pause)}
					onClick={() => invoke(capture.phase === 'paused' ? actions?.resume : actions?.pause)} close={close} />}
				<CaptureMenuItem label={webVcrActive ? copy.webVcrRecord : copy.captureStopImport}
					disabled={webVcrActive
						? recordingBlocked || webVcr?.phase !== 'ready' || webVcr.navigation.loading || !webVcrActions?.record
					: !['countdown', 'recording', 'paused'].includes(capture.phase) || !actions?.stop}
					onClick={() => invoke(webVcrActive ? webVcrActions?.record : actions?.stop)} close={close} />
				{webVcrActive && <CaptureMenuItem label={copy.captureStopImport}
					disabled={!webVcr || !['preparing', 'recording'].includes(webVcr.phase) || !webVcrActions?.stopAndImport}
					onClick={() => invoke(webVcrActions?.stopAndImport)} close={close} />}
				{capture.phase === 'recovery' && <>
					<ContextMenuItem isDivider />
					<CaptureMenuItem label={copy.captureRecover} disabled={recoveryBlocked || !actions?.recover}
						onClick={() => invoke(actions?.recover)} close={close} />
					<CaptureMenuItem label={copy.captureImportAsIs}
						disabled={recoveryBlocked || !actions?.importAsIs}
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
