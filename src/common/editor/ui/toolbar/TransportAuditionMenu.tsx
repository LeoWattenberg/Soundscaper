/* SPDX-License-Identifier: AGPL-3.0-only */

import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { transportShortcutDisplayActionId } from '../../transport-shortcut-display.ts';

interface TransportAuditionMenuProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly snapshot: Readonly<{
		recording?: unknown;
		recordingKind?: string;
		recordingOptions?: Readonly<{ paused?: boolean }>;
		selection?: Readonly<{ startFrame: number; endFrame: number }> | null;
		preferences?: Readonly<{ shortcuts?: Readonly<Record<string, readonly string[]>> }>;
	}>;
	readonly blocked: boolean;
	readonly transportState: string;
	readonly controller: Readonly<{ actions: Readonly<{ transport: Readonly<{
		playPause(): unknown;
		playCutPreview(): unknown;
		playStopSelect(): unknown;
	}> }> }>;
	readonly run: (operation: () => unknown) => unknown;
	readonly close: () => void;
}

/** Optional audition commands live in the existing Play split-button menu. */
export default function TransportAuditionMenu({
	copy, snapshot, blocked, transportState, controller, run, close,
}: TransportAuditionMenuProps) {
	const recording = Boolean(snapshot.recording);
	const paused = recording ? snapshot.recordingOptions?.paused === true : transportState === 'paused';
	const shortcuts = snapshot.preferences?.shortcuts;
	const shortcut = (actionId: string) => shortcuts?.[transportShortcutDisplayActionId(actionId)]?.join(', ');
	const selection = snapshot.selection;
	const items = [
		{
			id: 'action://playback/pause',
			label: recording ? (paused ? copy.resumeRecording : copy.pauseRecording) : (paused ? copy.resumePlayback : copy.pause),
			disabled: recording ? snapshot.recordingKind === 'take-cycle' : !['playing', 'paused'].includes(transportState),
			onClick: () => controller.actions.transport.playPause(),
		},
		{
			id: 'play-cut-preview', label: copy.playCutPreview,
			disabled: blocked || recording || !selection || selection.endFrame <= selection.startFrame,
			onClick: () => controller.actions.transport.playCutPreview(),
		},
		{
			id: 'play-stop-select', label: copy.playStopSetCursor,
			disabled: recording || (blocked && !['playing', 'paused'].includes(transportState)),
			onClick: () => controller.actions.transport.playStopSelect(),
		},
	];
	return <>{items.map((item) => <ContextMenuItem
		key={item.id} label={item.label} shortcut={shortcut(item.id)} disabled={item.disabled}
		onClick={() => { close(); run(item.onClick); }}
	/>)}</>;
}
