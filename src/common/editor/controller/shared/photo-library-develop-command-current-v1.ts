/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopCommandCurrentV1, PhotoLibraryDevelopSettingsCurrentV1,
	PhotoLibraryDevelopPortCurrentV1 } from '../../photo-library-develop-port-current-v1.ts';
import type { PhotoDevelopExecutionContextCurrentV1 } from './photo-library-develop-workflow-current-v1.ts';
import { detachPhotoDevelopCommandForProfileV1, detachPhotoDevelopSettingsForProfileV1,
	capturePhotoDevelopPortForProfileV1, capturePhotoDevelopContextForProfileV1 } from './internal/photo-library-develop-command-kernel-v1.ts';

export function detachPhotoLibraryDevelopCommandCurrentV1(value: unknown): PhotoLibraryDevelopCommandCurrentV1 {
	return detachPhotoDevelopCommandForProfileV1('current4', value);
}
export function detachPhotoLibraryDevelopSettingsCurrentV1(value: unknown): PhotoLibraryDevelopSettingsCurrentV1 {
	return detachPhotoDevelopSettingsForProfileV1('current4', value);
}
export function capturePhotoLibraryDevelopPortCurrentV1(value: PhotoLibraryDevelopPortCurrentV1): Readonly<PhotoLibraryDevelopPortCurrentV1> {
	return capturePhotoDevelopPortForProfileV1('current4', value);
}
export function capturePhotoDevelopExecutionContextCurrentV1(value: PhotoDevelopExecutionContextCurrentV1,
	signal: AbortSignal): Readonly<PhotoDevelopExecutionContextCurrentV1> {
	return capturePhotoDevelopContextForProfileV1('current4', value, signal);
}
