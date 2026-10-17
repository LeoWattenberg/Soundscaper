/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV2, PhotoLibraryDevelopPresetSnapshotV2 } from '../../photo-library-develop-presets-port-v2.ts';
import type { PhotoDevelopSettingsCopyV1 } from '../../../i18n/lightscaper-develop-settings-copy.ts';

import PhotoImportDevelopPresetsKernelV1 from './internal/PhotoImportDevelopPresetsKernelV1.tsx';

export interface PhotoImportDevelopPresetsPropsV2 {
	readonly readPresets: (options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoLibraryDevelopPresetSnapshotV2>;
	readonly value: PhotoLibraryDevelopPresetReadV2 | null;
	readonly onChange: (value: PhotoLibraryDevelopPresetReadV2 | null) => void;
	readonly busy: boolean;
	readonly copy: PhotoDevelopSettingsCopyV1;
	/** Remains true until the borrowed list actually settles, including after unmount. */
	readonly onPending: (pending: boolean) => void;
}
/** The permanent V2 selector accepts only its original closed scalar menu. */
export default function PhotoImportDevelopPresetsV2(props: PhotoImportDevelopPresetsPropsV2) {
	return <PhotoImportDevelopPresetsKernelV1 {...props} profile="legacy2" />;
}
