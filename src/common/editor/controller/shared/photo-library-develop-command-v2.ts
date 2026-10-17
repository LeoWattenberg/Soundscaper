/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopCommandV2, PhotoLibraryDevelopSettingsV2, PhotoLibraryDevelopPortV2 } from '../../photo-library-develop-port-v2.ts';
import type { PhotoDevelopExecutionContextV2 } from './photo-library-develop-workflow-v2.ts';
import { detachPhotoDevelopCommandForProfileV1, detachPhotoDevelopSettingsForProfileV1,
	capturePhotoDevelopPortForProfileV1, capturePhotoDevelopContextForProfileV1 } from './internal/photo-library-develop-command-kernel-v1.ts';

export function detachPhotoLibraryDevelopCommandV2(value: unknown): PhotoLibraryDevelopCommandV2 {
	return detachPhotoDevelopCommandForProfileV1('legacy2', value);
}
export function detachPhotoLibraryDevelopSettingsV2(value: unknown): PhotoLibraryDevelopSettingsV2 {
	return detachPhotoDevelopSettingsForProfileV1('legacy2', value);
}
export function capturePhotoLibraryDevelopPortV2(port: PhotoLibraryDevelopPortV2): Readonly<PhotoLibraryDevelopPortV2> {
	return capturePhotoDevelopPortForProfileV1('legacy2', port);
}
export function capturePhotoDevelopExecutionContextV2(context: PhotoDevelopExecutionContextV2, signal: AbortSignal): Readonly<PhotoDevelopExecutionContextV2> {
	return capturePhotoDevelopContextForProfileV1('legacy2', context, signal);
}
