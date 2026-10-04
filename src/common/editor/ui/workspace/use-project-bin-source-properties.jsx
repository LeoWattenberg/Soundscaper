/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { createPortal } from 'react-dom';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Flyout } from '@soundscaper/design-system/Flyout';

import { SourcePropertiesPanel } from '../toolbar/SourcePropertiesPanel.jsx';

/** Put a video source's facts on its Project Bin entry without adding card chrome. */
export function useProjectBinSourceProperties({ project, controller, copy, disabled, overlayTarget }) {
	const [selection, setSelection] = React.useState(null);
	const source = selection && project && selection.projectId === project.id
		? project.sources?.find((candidate) => candidate.id === selection.sourceId) || null
		: null;
	const flyout = <Flyout
		isOpen={Boolean(source)}
		onClose={() => setSelection(null)}
		x={selection?.x || 0}
		y={selection?.y || 0}
		direction="down"
		closeOnOutsideClick
		closeOnEscape
		ariaLabel={copy.sourceProperties}
		role="dialog"
		className="kw-audio-editor__source-properties-flyout"
	>
		<SourcePropertiesPanel source={source} copy={copy} disabled={disabled}
			onReprobe={(sourceId) => controller.actions.video.reprobeSource(sourceId)} />
	</Flyout>;
	return {
		menuItem(videoClip, menu, onClose) {
			if (!videoClip) return null;
			return <ContextMenuItem
				label={copy.sourceProperties}
				disabled={!project.sources?.some((candidate) => candidate.id === videoClip.sourceId)}
				onClick={() => setSelection({
					projectId: project.id, sourceId: videoClip.sourceId, x: menu.x, y: menu.y,
				})}
				onClose={onClose}
			/>;
		},
		// Escape the workspace stacking context so toolbars cannot cover source actions.
		flyout: overlayTarget ? createPortal(flyout, overlayTarget) : flyout,
	};
}
