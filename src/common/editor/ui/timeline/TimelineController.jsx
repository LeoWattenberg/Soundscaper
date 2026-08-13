import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { createTimelineMenuModel } from './timeline-menu-model.js';
import { TimelineWorkspaceView } from './TimelineWorkspaceView.jsx';
import { useTimelineHitTesting } from './useTimelineHitTesting.js';
import { useTimelineInteractionState } from './useTimelineInteractionState.js';
import { useTimelineMenuActions } from './useTimelineMenuActions.js';
import { useTimelineNavigation } from './useTimelineNavigation.js';
import { useTimelinePointerFinish } from './useTimelinePointerFinish.js';
import { useTimelinePointerMove } from './useTimelinePointerMove.js';
import { useTimelinePointerStart } from './useTimelinePointerStart.js';
import { useTimelineProjectBinDnd } from './useTimelineProjectBinDnd.js';
import { useTimelineViewportModel } from './useTimelineViewportModel.js';

export default function TimelineController({
	controller,
	snapshot,
	runtimeProject,
	locale,
	copy,
	geometry: geometryInput,
	selection: selectionInput,
	preview: previewInput,
	navigation: navigationInput,
	actions: actionInput,
}) {
	const { mobile, showArmControls, displayAudioSupported } = geometryInput;
	const { searchRevealRequest } = selectionInput;
	const { overlayTarget } = previewInput;
	const { splitToolEnabled, automationToolEnabled, spectralBrushEnabled } = navigationInput;
	const {
		onToggleSplitTool,
		onError,
		onOpenEffects,
		onOpenClipProperties,
		onExportClip,
		onRevealProjectBin,
		onToggleArmControls,
	} = actionInput;
	const editBlock = selectAudioEditorEditBlock(snapshot);
	const mutationsBlocked = editBlock.blocked;
	const state = useTimelineInteractionState();
	const model = useTimelineViewportModel({
		controller,
		snapshot,
		runtimeProject,
		mobile,
		showArmControls,
		state,
	});
	const navigationRuntime = useTimelineNavigation({
		controller,
		showArmControls,
		splitToolEnabled,
		onToggleSplitTool,
		searchRevealRequest,
		state,
		model,
	});
	const menuActions = useTimelineMenuActions({
		controller,
		copy,
		onError,
		state,
		model,
	});
	const hitTesting = useTimelineHitTesting({ state, model });
	const pointerFinish = useTimelinePointerFinish({
		controller,
		snapshot,
		onRevealProjectBin,
		state,
		model,
		hitTesting,
		menuActions,
	});
	const splitToolActive = Boolean(splitToolEnabled || state.splitToolHeld);
	const pointerStart = useTimelinePointerStart({
		controller,
		snapshot,
		automationToolEnabled,
		showArmControls,
		splitToolActive,
		mutationsBlocked,
		state,
		model,
		hitTesting,
		menuActions,
	});
	const pointerMove = useTimelinePointerMove({
		controller,
		snapshot,
		state,
		model,
		hitTesting,
		menuActions,
	});
	const projectBinDnd = useTimelineProjectBinDnd({
		controller,
		mutationsBlocked,
		state,
		model,
		hitTesting,
		menuActions,
	});

	if (!model.project) {
		return <div className="audio-editor-timeline-loading" role="status">{copy.loading}</div>;
	}

	const menuModel = createTimelineMenuModel({
		controller,
		snapshot,
		locale,
		copy,
		showArmControls,
		onToggleArmControls,
		mutationsBlocked,
		state,
		model,
		menuActions,
	});
	const geometry = model;
	const selection = {
		documentSelection: model.documentSelection,
		timeSelection: model.timeSelection,
		selectedClipIdSet: model.selectedClipIdSet,
	};
	const preview = state;
	const navigation = {
		...navigationRuntime,
		...pointerFinish,
		...pointerStart,
		...pointerMove,
		...projectBinDnd,
		scrollRef: state.scrollRef,
		timelineScrollRef: state.timelineScrollRef,
		addTrackTriggerRef: state.addTrackTriggerRef,
		spectralBrushEnabled,
	};
	const actions = {
		...menuActions,
		editBlock,
		mutationsBlocked,
		splitToolActive,
		closeAddTrackFlyout: state.closeAddTrackFlyout,
		setTrackMenu: state.setTrackMenu,
		setOutputMenu: state.setOutputMenu,
		setFocusedOutputKey: state.setFocusedOutputKey,
		setClipMenu: state.setClipMenu,
		setTimelineRulerMenu: state.setTimelineRulerMenu,
		setTrackColorMenu: state.setTrackColorMenu,
		setTrackRulerFlyout: state.setTrackRulerFlyout,
		onOpenEffects,
		onOpenClipProperties,
		onExportClip,
		onRevealProjectBin,
	};

	return (
		<TimelineWorkspaceView
			controller={controller}
			snapshot={snapshot}
			copy={copy}
			locale={locale}
			mobile={mobile}
			showArmControls={showArmControls}
			displayAudioSupported={displayAudioSupported}
			automationToolEnabled={automationToolEnabled}
			geometry={geometry}
			selection={selection}
			preview={preview}
			navigation={navigation}
			actions={actions}
			menuModel={menuModel}
			overlayTarget={overlayTarget}
		/>
	);
}
