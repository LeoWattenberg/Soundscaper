/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { Icon } from '@soundscaper/design-system/Icon';

/**
 * The content of the ruler corner above the track headers: the Tracks label,
 * the Add track trigger and, with the marker lane visible, the annotation
 * actions. The desktop layout renders it in the sticky corner; the compact
 * layout renders it inside the track-header drawer's handle strip.
 */
export function TimelineRulerCornerContent({
	addTrackTabIndex,
	addTrackTriggerRef,
	annotationActions = null,
	copy,
	onOpenAddTrackFlyout,
}) {
	return (
		<>
			<span>{copy.tracks}</span>
			<Button
				ref={addTrackTriggerRef}
				variant="secondary"
				size="small"
				icon={<Icon name="plus" size={14} />}
				tabIndex={addTrackTabIndex}
				onClick={onOpenAddTrackFlyout}
			>
				{copy.addTrack}
			</Button>
			{annotationActions}
		</>
	);
}
