/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReactNode } from 'react';

import type { ParameterAutomationControlRouterV21 } from '../common/editor/parameter-automation-control-router-v21.ts';
import type { SoundscaperWorkflowApplicationMenuItems } from '../common/editor/ui/soundscaper-workflow-application-menu.ts';
import type { TrackAutomationControlsModel } from '../common/editor/ui/timeline/useTrackAutomationControls.ts';

type BeginGesture = typeof import('../common/editor/parameter-automation-gesture-adapter-v21.ts').beginParameterAutomationGestureV21;
type CancelGesture = typeof import('../common/editor/parameter-automation-gesture-adapter-v21.ts').cancelParameterAutomationGestureV21;
type CaptureAvailable = typeof import('../common/editor/parameter-automation-gesture-adapter-v21.ts').parameterAutomationCaptureAvailableV21;
type PreviewGesture = typeof import('../common/editor/parameter-automation-gesture-adapter-v21.ts').previewParameterAutomationGestureV21;
type ReleaseGesture = typeof import('../common/editor/parameter-automation-gesture-adapter-v21.ts').releaseParameterAutomationGestureV21;
type AutomationRuntimeProvider = typeof import('../common/editor/ui/TrackAutomationRuntimeContext.tsx').TrackAutomationRuntimeProvider;
type UseAutomationRuntime = typeof import('../common/editor/ui/TrackAutomationRuntimeContext.tsx').useTrackAutomationRuntime;
type CreateWorkflowMenu = typeof import('../common/editor/ui/soundscaper-workflow-application-menu.ts').createSoundscaperWorkflowApplicationMenuItems;
type ResolveMasteringCopy = typeof import('../common/editor/ui/soundscaper-mastering-sequence-copy.ts').resolveSoundscaperMasteringSequenceCopy;
type AutomationCurveMenu = typeof import('../common/editor/ui/timeline/TrackAutomationCurveMenu.tsx').TrackAutomationCurveMenu;
type AutomationOverlay = typeof import('../common/editor/ui/timeline/TrackAutomationOverlay.tsx').TrackAutomationOverlay;
type AutomationSelectors = typeof import('../common/editor/ui/timeline/TrackAutomationSelectors.tsx').TrackAutomationSelectors;
type ResolveAutomationCopy = typeof import('../common/editor/ui/timeline/track-automation-copy.ts').resolveTrackAutomationCopy;
type UseAutomationControls = typeof import('../common/editor/ui/timeline/useTrackAutomationControls.ts').useTrackAutomationControls;
type UseWorkflowWorkspace = typeof import('../common/editor/ui/workspace/useSoundscaperWorkflowWorkspace.ts').useSoundscaperWorkflowWorkspace;
type ResolveRoutingCopy = typeof import('../common/editor/ui/workspace/soundscaper-routing-graph-copy.ts').resolveSoundscaperRoutingGraphCopy;

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP: ReadonlyMap<string, never> = new Map<string, never>();
const EMPTY_AUTOMATION_CONTROLS: TrackAutomationControlsModel = Object.freeze({
	visibleTrackIds: EMPTY_SET,
	targetsByTrackId: EMPTY_MAP,
	selectedTargetByTrackId: EMPTY_MAP,
	isVisible: () => false,
	toggle: () => undefined,
	selectTarget: () => undefined,
});
const EMPTY_WORKFLOW_MENU: SoundscaperWorkflowApplicationMenuItems = Object.freeze({
	tracks: Object.freeze([]),
	mixer: Object.freeze([]),
	effect: Object.freeze([]),
	analyze: Object.freeze([]),
	tools: Object.freeze([]),
});
const EMPTY_AUTOMATION_ROUTER: ParameterAutomationControlRouterV21 = Object.freeze({
	setContext: () => undefined,
	captureAvailable: () => false,
	owns: () => false,
	begin: () => false,
	preview: () => false,
	release: () => false,
	cancel: () => false,
	performAtomic: () => false,
});
const EmptyAutomationCurveMenu = (() => null) as unknown as AutomationCurveMenu;
const EmptyAutomationOverlay = (() => null) as unknown as AutomationOverlay;
const EmptyAutomationSelectors = (() => null) as unknown as AutomationSelectors;

export const TrackAutomationRuntimeProvider = ((props: Readonly<{
	runtime?: unknown;
	children: ReactNode;
}>) => props.children) as AutomationRuntimeProvider;
export const useTrackAutomationRuntime: UseAutomationRuntime = () => null;
export const useSoundscaperWorkflowWorkspace: UseWorkflowWorkspace = () => null;
export const useTrackAutomationControls: UseAutomationControls = () => EMPTY_AUTOMATION_CONTROLS;
export const TrackAutomationCurveMenu: AutomationCurveMenu = EmptyAutomationCurveMenu;
export const TrackAutomationOverlay: AutomationOverlay = EmptyAutomationOverlay;
export const TrackAutomationSelectors: AutomationSelectors = EmptyAutomationSelectors;
export const resolveTrackAutomationCopy: ResolveAutomationCopy = () => ({
	addAutomation: 'Add automation',
}) as ReturnType<ResolveAutomationCopy>;
export const createSoundscaperWorkflowApplicationMenuItems: CreateWorkflowMenu = () => EMPTY_WORKFLOW_MENU;
export const resolveSoundscaperMasteringSequenceCopy: ResolveMasteringCopy = () => ({}) as ReturnType<ResolveMasteringCopy>;
export const resolveSoundscaperRoutingGraphCopy: ResolveRoutingCopy = (copy = {}) => ({
	routing: copy.routing || 'Routing graph',
	channelStrips: copy.channelStrips || 'Channel strips',
}) as ReturnType<ResolveRoutingCopy>;
export const createParameterAutomationControlRouterV21 = (): ParameterAutomationControlRouterV21 => EMPTY_AUTOMATION_ROUTER;
export const parameterAutomationCaptureAvailableV21: CaptureAvailable = () => false;
export const beginParameterAutomationGestureV21: BeginGesture = () => null;
export const previewParameterAutomationGestureV21: PreviewGesture = () => undefined;
export const releaseParameterAutomationGestureV21: ReleaseGesture = () => undefined;
export const cancelParameterAutomationGestureV21: CancelGesture = () => undefined;
