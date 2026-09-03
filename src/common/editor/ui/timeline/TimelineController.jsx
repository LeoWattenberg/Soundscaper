import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { createTimelineMenuModel } from './timeline-menu-model.js';
import { TimelineWorkspaceView } from './TimelineWorkspaceView.jsx';
import { useTimelineHitTesting } from './useTimelineHitTesting.js';
import { useTimelineInteractionState } from './useTimelineInteractionState.js';
import { useTimelineMenuActions } from './useTimelineMenuActions.js';
import { useTimelineNavigation } from './useTimelineNavigation.js';
import { useTimelinePointerFinish } from './useTimelinePointerFinish.js';
import { useTimelinePointerMove } from './useTimelinePointerMove.js';
import { useTrackHeaderDrawerDismissal } from './useTrackHeaderDrawerDismissal.js';
import { useTimelinePointerStart } from './useTimelinePointerStart.js';
import { useTimelineProjectBinDnd } from './useTimelineProjectBinDnd.js';
import { useTimelineViewportModel } from './useTimelineViewportModel.js';
import { useTrackAutomationControls } from '../soundscaper-workflow-product-runtime.tsx';
import { resolveTimelineToolPrecedence } from './timeline-tool-precedence.ts';

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
	const { mobile, showArmControls, displayAudioSupported, trackHeaderDrawer = null } = geometryInput;
	const { searchRevealRequest } = selectionInput;
	const { overlayTarget } = previewInput;
	const {
		splitToolEnabled,
		splitToolMomentary,
		automationToolEnabled,
		spectralBrushEnabled,
	} = navigationInput;
	const {
		onError,
		onOpenEffects,
		onOpenClipProperties,
		onExportClip,
		onRevealProjectBin,
		onToggleArmControls,
		onOpenSurface,
		automationRuntime,
		freezeRuntime,
		productId,
		capabilities,
	} = actionInput;
	const editBlock = selectAudioEditorEditBlock(snapshot);
	const mutationsBlocked = editBlock.blocked;
	const state = useTimelineInteractionState();
	const automationControls = useTrackAutomationControls(
		runtimeProject ?? snapshot.project,
		productId === 'soundscaper' && capabilities?.audioAutomation === true,
		automationRuntime,
	);
	const model = useTimelineViewportModel({
		controller,
		snapshot,
		runtimeProject,
		mobile,
		trackHeaderDrawer,
		showArmControls,
		automationVisibleTrackIds: automationControls.visibleTrackIds,
		state,
	});
	const navigationRuntime = useTimelineNavigation({
		controller,
		trackHeaderDrawer,
		showArmControls,
		automationVisibleTrackIds: automationControls.visibleTrackIds,
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
	const splitToolActive = Boolean(splitToolEnabled || splitToolMomentary);
	const pointerFinish = useTimelinePointerFinish({
		controller,
		snapshot,
		splitToolActive,
		onRevealProjectBin,
		state,
		model,
		hitTesting,
		menuActions,
	});
	const toolPrecedence = resolveTimelineToolPrecedence({
		automationToolEnabled,
		spectralBrushEnabled,
		splitToolActive,
	});
	const pointerStart = useTimelinePointerStart({
		controller,
		snapshot,
		automationToolEnabled: toolPrecedence.automationToolEnabled,
		showArmControls,
		automationVisibleTrackIds: automationControls.visibleTrackIds,
		splitToolActive,
		mutationsBlocked,
		state,
		model,
		hitTesting,
		menuActions,
	});
	const headerDrawerDismissal = useTrackHeaderDrawerDismissal({
		drawer: trackHeaderDrawer,
		onPointerDown: pointerStart.onPointerDown,
	});
	const pointerMove = useTimelinePointerMove({
		controller,
		snapshot,
		splitToolActive,
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
		onOpenSurface,
		automationControls,
		freezeRuntime,
		productId,
		capabilities,
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
		onPointerDown: headerDrawerDismissal.onPointerDownCapture,
		onTrackHeaderDrawerKeyDown: headerDrawerDismissal.onKeyDown,
		...pointerMove,
		...projectBinDnd,
		scrollRef: state.scrollRef,
		timelineScrollRef: state.timelineScrollRef,
		addTrackTriggerRef: state.addTrackTriggerRef,
		spectralBrushEnabled: toolPrecedence.spectralBrushEnabled,
	};
	const actions = {
		...menuActions,
		editBlock,
		mutationsBlocked,
		splitToolActive,
		showAutomationOverlay: toolPrecedence.showAutomationOverlay,
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
		automationControls,
		automationRuntime,
	};

	return (
		<TimelineWorkspaceView
			controller={controller}
			snapshot={snapshot}
			copy={copy}
			locale={locale}
			mobile={mobile}
			trackHeaderDrawer={trackHeaderDrawer}
			showArmControls={showArmControls}
			displayAudioSupported={displayAudioSupported}
			automationToolEnabled={toolPrecedence.automationToolEnabled}
			automationRuntime={automationRuntime}
			automationControls={automationControls}
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
