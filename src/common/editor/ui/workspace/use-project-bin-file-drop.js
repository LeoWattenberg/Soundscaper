/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';

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
export function useProjectBinFileDrop({ blocked, onFiles }) {
	const dragDepthRef = useRef(0);
	const [dropActive, setDropActive] = useState(false);

	const isFileDrag = (dataTransfer) => {
		const types = [...(dataTransfer?.types || [])];
		return types.includes('Files') || [...(dataTransfer?.items || [])].some((item) => item.kind === 'file');
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
				if (blocked || !isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				dragDepthRef.current += 1;
				setDropActive(true);
			},
			onDragOver: (event) => {
				if (blocked || !isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'copy';
				setDropActive(true);
			},
			onDragLeave: (event) => {
				if (!isFileDrag(event.dataTransfer)) return;
				event.stopPropagation();
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (!dragDepthRef.current) setDropActive(false);
			},
			onDrop: (event) => {
				if (!isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				resetDropState(event.currentTarget);
				if (blocked) return;
				const files = [...(event.dataTransfer.files || [])];
				if (files.length) onFiles(files);
			},
		},
	};
}
