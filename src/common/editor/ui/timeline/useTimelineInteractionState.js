import { useCallback, useRef, useState } from 'react';

import { useElementSize } from '../DesignSystemRuntime.jsx';

export function useTimelineInteractionState() {
	const [timelineRef, timelineSize] = useElementSize();
	const navigationRootRef = useRef(null);
	const scrollRef = useRef(null);
	const pointerSession = useRef(null);
	const touchPointers = useRef(new Map());
	const pinchSession = useRef(null);
	const pendingPinchAnchorRef = useRef(null);
	const splitToolTimer = useRef(0);
	const splitToolPress = useRef(null);
	const splitToolHeldRef = useRef(false);
	const waveformCacheRef = useRef(new Map());
	const [splitToolHeld, setSplitToolHeld] = useState(false);
	const [scrollX, setScrollX] = useState(0);
	const [selectionPreview, setSelectionPreview] = useState(null);
	const [loopPreview, setLoopPreview] = useState(null);
	const [trackMenu, setTrackMenu] = useState(null);
	const [outputMenu, setOutputMenu] = useState(null);
	const [focusedOutputKey, setFocusedOutputKey] = useState(null);
	const [trackColorMenu, setTrackColorMenu] = useState(null);
	const [clipMenu, setClipMenu] = useState(null);
	const [timelineRulerMenu, setTimelineRulerMenu] = useState(null);
	const [trackRulerFlyout, setTrackRulerFlyout] = useState(null);
	const [waveformRulerState, setWaveformRulerState] = useState({});
	const [addTrackFlyout, setAddTrackFlyout] = useState(null);
	const addTrackTriggerRef = useRef(null);
	const closeAddTrackFlyout = useCallback(() => setAddTrackFlyout(null), []);
	const [draggingClipIds, setDraggingClipIds] = useState(null);
	const [clipDragPreview, setClipDragPreview] = useState(null);
	const [trackResizePreview, setTrackResizePreview] = useState(null);
	const [projectBinDragPreview, setProjectBinDragPreview] = useState(null);

	return {
		timelineRef,
		timelineSize,
		navigationRootRef,
		scrollRef,
		pointerSession,
		touchPointers,
		pinchSession,
		pendingPinchAnchorRef,
		splitToolTimer,
		splitToolPress,
		splitToolHeldRef,
		waveformCacheRef,
		splitToolHeld,
		setSplitToolHeld,
		scrollX,
		setScrollX,
		selectionPreview,
		setSelectionPreview,
		loopPreview,
		setLoopPreview,
		trackMenu,
		setTrackMenu,
		outputMenu,
		setOutputMenu,
		focusedOutputKey,
		setFocusedOutputKey,
		trackColorMenu,
		setTrackColorMenu,
		clipMenu,
		setClipMenu,
		timelineRulerMenu,
		setTimelineRulerMenu,
		trackRulerFlyout,
		setTrackRulerFlyout,
		waveformRulerState,
		setWaveformRulerState,
		addTrackFlyout,
		setAddTrackFlyout,
		addTrackTriggerRef,
		closeAddTrackFlyout,
		draggingClipIds,
		setDraggingClipIds,
		clipDragPreview,
		setClipDragPreview,
		trackResizePreview,
		setTrackResizePreview,
		projectBinDragPreview,
		setProjectBinDragPreview,
	};
}
