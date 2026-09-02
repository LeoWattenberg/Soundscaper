/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../../automation-lane-v21.ts';
import type { ParameterDescriptor } from '../../parameter-address.ts';
import {
	selectedTrackAutomationSegmentKind,
	trackAutomationSegmentKindLabel,
	trackAutomationSegmentKinds,
	type TrackAutomationSegmentKind,
} from './track-automation-overlay-bezier.ts';

export function TrackAutomationCurveMenu({
	menu,
	lane,
	descriptor,
	width,
	height,
	bodyTop,
	copy,
	onKind,
	onDelete,
	onClose,
}: Readonly<{
	menu: Readonly<{ x: number; y: number; segmentIndex: number | null }>;
	lane: AutomationLaneV21 | null;
	descriptor: ParameterDescriptor;
	width: number;
	height: number;
	bodyTop: number;
	copy: Readonly<Record<string, string | undefined>>;
	onKind: (kind: TrackAutomationSegmentKind) => void;
	onDelete: () => void;
	onClose: () => void;
}>) {
	return <foreignObject
		className="audio-editor-track-automation-menu"
		data-track-automation-interactive
		x={Math.max(2, Math.min(width - 154, menu.x))}
		y={Math.max(bodyTop, Math.min(height - 154, menu.y))}
		width={152}
		height={152}
	>
		<div
			className="audio-editor-track-automation-menu__surface"
			role="menu"
			aria-label={copy.automationCurveMenu || 'Automation curve'}
			onPointerDown={(event) => event.stopPropagation()}
		>
			{menu.segmentIndex !== null && trackAutomationSegmentKinds(descriptor).map((kind) => <button
				key={kind}
				type="button"
				role="menuitemradio"
				aria-checked={selectedTrackAutomationSegmentKind(lane, menu.segmentIndex) === kind}
				onClick={() => onKind(kind)}
			>
				{trackAutomationSegmentKindLabel(kind, copy)}
			</button>)}
			{lane && <button
				type="button"
				role="menuitem"
				className="audio-editor-track-automation-menu__delete"
				onClick={onDelete}
			>
				{copy.automationDeleteLane || 'Delete automation lane'}
			</button>}
			<button type="button" role="menuitem" onClick={onClose}>{copy.close || 'Close'}</button>
		</div>
	</foreignObject>;
}
