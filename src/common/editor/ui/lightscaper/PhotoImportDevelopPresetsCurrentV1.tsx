/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV3, PhotoLibraryDevelopPresetSnapshotV3 } from '../../photo-library-develop-presets-port-v3.ts';
import type { PhotoDevelopSettingsCopyV1 } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import PhotoImportDevelopPresetsKernelV1 from './internal/PhotoImportDevelopPresetsKernelV1.tsx';

export interface PhotoImportDevelopPresetsPropsCurrentV1 {
	readonly readPresets: (options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoLibraryDevelopPresetSnapshotV3>;
	readonly value: PhotoLibraryDevelopPresetReadV3 | null;
	readonly onChange: (value: PhotoLibraryDevelopPresetReadV3 | null) => void;
	readonly busy: boolean;
	readonly copy: PhotoDevelopSettingsCopyV1;
	/** Remains true until the actual borrowed list joins, including after unmount. */
	readonly onPending: (pending: boolean) => void;
}
export default function PhotoImportDevelopPresetsCurrentV1(props: PhotoImportDevelopPresetsPropsCurrentV1) {
	return <PhotoImportDevelopPresetsKernelV1 {...props} profile="current3" />;
}
