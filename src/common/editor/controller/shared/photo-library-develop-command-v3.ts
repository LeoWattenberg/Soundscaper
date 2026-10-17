/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopCommandV3, PhotoLibraryDevelopSettingsV3, PhotoLibraryDevelopPortV3 } from '../../photo-library-develop-port-v3.ts';
import { detachPhotoDevelopCommandForProfileV1, detachPhotoDevelopSettingsForProfileV1,
	capturePhotoDevelopPortForProfileV1 } from './internal/photo-library-develop-command-kernel-v1.ts';
export { capturePhotoDevelopExecutionContextCurrentV1 } from './photo-library-develop-command-current-v1.ts';

export function detachPhotoLibraryDevelopCommandV3(value: unknown): PhotoLibraryDevelopCommandV3 {
	return detachPhotoDevelopCommandForProfileV1('current3', value);
}
export function detachPhotoLibraryDevelopSettingsV3(value: unknown): PhotoLibraryDevelopSettingsV3 {
	return detachPhotoDevelopSettingsForProfileV1('current3', value);
}
export function capturePhotoLibraryDevelopPortV3(port: PhotoLibraryDevelopPortV3): Readonly<PhotoLibraryDevelopPortV3> {
	return capturePhotoDevelopPortForProfileV1('current3', port);
}
