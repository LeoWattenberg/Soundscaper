/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CaptureFrameFinishing } from './selected-finishing-exact-frame-execution.ts';
import type { CreateFramescaperOpenFxExactExecutionNativeMedia, CreateFramescaperVideoExportSupplementalPictureExecutionFinishing, CreateFramescaperVideoExportSourceFramesFinishing } from './video-export-exact-execution-finishing.ts';
export interface FramescaperVideoExportExactDependencyOptionsFinishing {
	readonly captureExactFrame?: CaptureFrameFinishing;
	readonly createExactAcceleratorCanvas?: () => unknown;
	readonly createExactSourceFrames?: CreateFramescaperVideoExportSourceFramesFinishing;
}
export interface ExactExecutionDependenciesFinishing {
	readonly captureFrame?: CaptureFrameFinishing;
	readonly createAcceleratorCanvas?: () => unknown;
	readonly createSourceFrames?: CreateFramescaperVideoExportSourceFramesFinishing;
	readonly createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionNativeMedia;
	readonly createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing;
}
export function snapshotExactExecutionDependencies(
	value: FramescaperVideoExportExactDependencyOptionsFinishing | undefined,
	createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionNativeMedia,
	createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing,
): ExactExecutionDependenciesFinishing {
	const captureFrame = value ? optionalExactFunction(value, 'captureExactFrame') : undefined;
	const createAcceleratorCanvas = value ? optionalExactFunction(value, 'createExactAcceleratorCanvas') : undefined;
	const createSourceFrames = value ? optionalExactFunction(value, 'createExactSourceFrames') : undefined;
	return Object.freeze({
		...(captureFrame ? { captureFrame: captureFrame as CaptureFrameFinishing } : {}),
		...(createAcceleratorCanvas ? { createAcceleratorCanvas: createAcceleratorCanvas as () => unknown } : {}),
		...(createSourceFrames ? { createSourceFrames: createSourceFrames as CreateFramescaperVideoExportSourceFramesFinishing } : {}),
		...(createOpenFxExecution ? { createOpenFxExecution } : {}),
		...(createSupplementalPictureExecution ? { createSupplementalPictureExecution } : {}),
	});
}
function optionalExactFunction(value: object, key: keyof FramescaperVideoExportExactDependencyOptionsFinishing): ((...arguments_: never[]) => unknown) | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError(`finishing picture export dependencies.${key} must be an own function.`);
	return descriptor.value as (...arguments_: never[]) => unknown;
}
