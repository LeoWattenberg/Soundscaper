/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import {
	AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
	parseFreesoundResultDragPayload,
} from '../../project-bin-dnd.js';

/**
 * Dragging files onto the Project Bin.
 *
 * Drag events fire on descendants as well as the drop target, so a naive enter/leave pair
 * flickers the highlight as the pointer crosses each child. Counting depth instead of
 * tracking a boolean is what keeps the highlight steady, and the count is reset rather
 * than decremented on drop so an interrupted drag cannot leave it stuck above zero.
 *
 * A blocked bin still accepts the drag events — it must, to stop the browser navigating to
 * the dropped file — but refuses the import and never lights up.
 */
export function useProjectBinFileDrop({ blocked, onFiles, onFreesoundSound }) {
	const dragDepthRef = useRef(0);
	const [dropActive, setDropActive] = useState(false);

	const isImportDrag = (dataTransfer) => {
		const types = [...(dataTransfer?.types || [])];
		return types.includes(AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE)
			|| types.includes('Files') || [...(dataTransfer?.items || [])].some((item) => item.kind === 'file');
	};

	const resetDropState = (element = null) => {
		dragDepthRef.current = 0;
		setDropActive(false);
		element?.removeAttribute('data-drop-active');
	};

	return {
		dropActive,
		resetDropState,
		dropHandlers: {
			onDragEnter: (event) => {
				if (!isImportDrag(event.dataTransfer)) return;
				// Cancelling comes before the block check, as it does on drop: an element
				// whose dragenter/dragover is not cancelled is not a drop target at all,
				// and the browser navigates to the dropped file instead.
				event.preventDefault();
				event.stopPropagation();
				if (blocked) return;
				dragDepthRef.current += 1;
				setDropActive(true);
			},
			onDragOver: (event) => {
				if (!isImportDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
				if (blocked) return;
				setDropActive(true);
			},
			onDragLeave: (event) => {
				if (!isImportDrag(event.dataTransfer)) return;
				event.stopPropagation();
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (!dragDepthRef.current) setDropActive(false);
			},
			onDrop: (event) => {
				if (!isImportDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				resetDropState(event.currentTarget);
				if (blocked) return;
				const freesoundSoundId = parseFreesoundResultDragPayload(
					event.dataTransfer.getData?.(AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE),
				);
				if (freesoundSoundId !== null) {
					onFreesoundSound?.(freesoundSoundId);
					return;
				}
				const files = [...(event.dataTransfer.files || [])];
				if (files.length) onFiles(files);
			},
		},
	};
}
