/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';
import type { SequenceTimingProject } from '../../sequence-timing-model.ts';
import { projectDurationFrames } from '../../project.js';
import { useElementSize } from '../DesignSystemRuntime.jsx';
import TelemetryTimeCode, { type TimeCodeTelemetryController } from '../toolbar/TelemetryTimeCode.tsx';
import { clockPanelDisplayScale } from './clock-panel-display-model.ts';
import { focusWorkspaceToolbarTimeCode } from './workspace-panel-focus.js';

interface ClockPanelProps {
	readonly controller: TimeCodeTelemetryController & { readonly actions: {
		readonly preferences: { update(changes: unknown): unknown };
	} };
	readonly copy: Readonly<Record<string, string>>;
	readonly snapshot: {
		readonly project?: SequenceTimingProject | null;
		readonly recording?: unknown;
		readonly productId?: string;
		readonly preferences?: { readonly workspace?: {
			readonly timeDisplayFormat?: TimeCodeFormat | null;
			readonly panels?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
		} };
	};
	readonly run: (operation: () => unknown) => unknown;
}

/** Resize the readout with its host; the native digit controls stay editable. */
export default function ClockPanel({ controller, snapshot, copy, run }: ClockPanelProps) {
	const [panelRef, panelSize] = useElementSize();
	const [displayRef, displaySize] = useElementSize();
	const scale = clockPanelDisplayScale(panelSize, displaySize);
	const workspace = snapshot.preferences?.workspace;
	return <div ref={panelRef} className="kw-audio-editor__clock-panel" data-clock-panel aria-label={copy.panelClock}>
		<div ref={displayRef} className="kw-audio-editor__clock-panel-sizer">
			<div className="kw-audio-editor__clock-panel-display" style={{ transform: `scale(${scale})` }}>
				<TelemetryTimeCode controller={controller} project={snapshot.project} copy={copy}
					durationFrames={snapshot.project ? projectDurationFrames(snapshot.project) : 0}
					sequenceTiming={snapshot.productId === 'framescaper'}
					recording={snapshot.recording} run={run} preferredFormat={workspace?.timeDisplayFormat}
					onFormatChange={(format) => run(() => controller.actions.preferences.update({ workspace: { timeDisplayFormat: format } }))}
					onRedock={() => {
						run(() => controller.actions.preferences.update({ workspace: {
							panels: { clock: { ...workspace?.panels?.clock, visible: false } },
							toolbarButtons: { 'time-display': true },
						} }));
						focusWorkspaceToolbarTimeCode(document);
					}}
				/>
			</div>
		</div>
	</div>;
}
