/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	bindFramescaperNativeProjectActionRuntime,
	framescaperNativeProjectActionRuntimeFor,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import {
	createFramescaperControllerFoundationViewV31,
} from './editor-controller-v31-foundation-view.ts';
import {
	bindFramescaperCubeLutActionsV27,
	createFramescaperCubeLutActionsV27,
} from './editor-cube-lut-actions-v27.ts';
import type { FramescaperEditorProjectEnvironmentV31 } from './editor-project-environment-v31.ts';
import {
	bindFramescaperNativeImageSequenceActionV28,
	framescaperNativeImageSequenceActionBridgeAvailableV28,
} from './editor-native-image-sequence-action-v28.ts';
import {
	adoptFramescaperNativeOpenFxAuthoringRuntimeV28,
	bindFramescaperNativeOpenFxActionV28,
	framescaperNativeOpenFxActionBridgeAvailableV28,
} from './editor-native-openfx-action-v28.ts';
import { bindFramescaperNativeRenderQueueActionV28 } from './editor-native-render-queue-action-v28.ts';
import type { FramescaperNativeRenderInputRequestV28 } from './editor-native-render-input-producer-v28.ts';
import type { FramescaperNativeRenderInputStreamV28 } from './editor-native-render-input-stream-producer-v28.ts';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from './editor-motion-analysis-actions-v27.ts';
import { createFramescaperMotionAnalysisFrameProviderV27 } from './editor-motion-analysis-frame-provider-v27.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { bindFramescaperSelectedAuthoringControllerV31 } from './editor-selected-authoring-controller-v31.ts';
import { bindFramescaperSelectedRenderSessionRuntimeV31 } from './editor-selected-render-session-v31.ts';
import { bindFramescaperSelectedVisualPreviewControllerV31 } from './editor-selected-v31-visual-preview-controller.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';

export const FRAMESCAPER_V31_INHERITED_PRODUCT_BINDINGS = Object.freeze([
	'selected-authoring', 'selected-visual-preview', 'selected-render-session',
	'motion-analysis', 'cube-lut', 'native-render-queue', 'native-image-sequence',
	'native-openfx',
] as const);

/** Install every controller-local selected-V28 runtime on the real F31 owner. */
export function bindFramescaperInheritedProductRuntimesV31(options: Readonly<{
	readonly controller: object;
	readonly environment: Readonly<FramescaperEditorProjectEnvironmentV31>;
	readonly bridge: FramescaperNativeServicesBridge | null;
	readonly prepareNativeRenderInputStreamV31: (
		request: FramescaperNativeRenderInputRequestV28,
	) => Promise<FramescaperNativeRenderInputStreamV28>;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'];
}>): void {
	const { controller, environment } = options;
	const view = createFramescaperControllerFoundationViewV31(
		controller,
		options.prepareNativeRenderInputStreamV31 as unknown as (request: unknown) => Promise<unknown>,
	);
	bindFramescaperSelectedAuthoringControllerV31({
		controller: controller as never,
		store: environment.controllerStore,
	});
	bindFramescaperMotionAnalysisActionsV27(controller, createFramescaperMotionAnalysisActionsV27({
		owner: view as never,
		store: environment.store,
		frameProvider: createFramescaperMotionAnalysisFrameProviderV27({
			store: environment.controllerStore,
		}),
	}));
	bindFramescaperCubeLutActionsV27(controller, createFramescaperCubeLutActionsV27({
		owner: view as never,
		store: environment.store,
	}));
	bindFramescaperSelectedVisualPreviewControllerV31({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
		...(options.openFxExecute ? { openFxExecute: options.openFxExecute } : {}),
	});
	bindFramescaperSelectedRenderSessionRuntimeV31(environment.runtime.profile, controller as never);
	bindFramescaperNativeRenderQueueActionV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, view as never);
	if (framescaperNativeImageSequenceActionBridgeAvailableV28(options.bridge)) {
		bindFramescaperNativeImageSequenceActionV28({
			profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			owner: view as never,
			store: environment.store,
			bridge: options.bridge,
		});
	}
	if (framescaperNativeOpenFxActionBridgeAvailableV28(options.bridge)) {
		bindFramescaperNativeOpenFxActionV28({
			profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			owner: view as never,
			bridge: options.bridge,
		});
		adoptFramescaperNativeOpenFxAuthoringRuntimeV28(view, controller);
	}
	const nativeRuntime = framescaperNativeProjectActionRuntimeFor(view);
	if (!nativeRuntime) throw new Error('F31 lost its selected native project-action runtime.');
	bindFramescaperNativeProjectActionRuntime(controller, nativeRuntime);
}
