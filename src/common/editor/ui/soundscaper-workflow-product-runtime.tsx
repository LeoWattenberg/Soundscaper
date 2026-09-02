/* SPDX-License-Identifier: AGPL-3.0-only */

import './audio-editor-design-system/08a-timeline-automation.css';

export {
	beginParameterAutomationGestureV21,
	cancelParameterAutomationGestureV21,
	parameterAutomationCaptureAvailableV21,
	previewParameterAutomationGestureV21,
	releaseParameterAutomationGestureV21,
} from '../parameter-automation-gesture-adapter-v21.ts';
export { createParameterAutomationControlRouterV21 } from '../parameter-automation-control-router-v21.ts';
export {
	TrackAutomationRuntimeProvider,
	useTrackAutomationRuntime,
} from './TrackAutomationRuntimeContext.tsx';
export { createSoundscaperWorkflowApplicationMenuItems } from './soundscaper-workflow-application-menu.ts';
export { resolveSoundscaperMasteringSequenceCopy } from './soundscaper-mastering-sequence-copy.ts';
export { TrackAutomationCurveMenu } from './timeline/TrackAutomationCurveMenu.tsx';
export { TrackAutomationOverlay } from './timeline/TrackAutomationOverlay.tsx';
export { TrackAutomationSelectors } from './timeline/TrackAutomationSelectors.tsx';
export { resolveTrackAutomationCopy } from './timeline/track-automation-copy.ts';
export { useTrackAutomationControls } from './timeline/useTrackAutomationControls.ts';
export { useSoundscaperWorkflowWorkspace } from './workspace/useSoundscaperWorkflowWorkspace.ts';
export { resolveSoundscaperRoutingGraphCopy } from './workspace/soundscaper-routing-graph-copy.ts';
