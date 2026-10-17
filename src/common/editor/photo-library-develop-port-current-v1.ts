/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateThroughV4 } from './imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopPortV3, PhotoLibraryDevelopSnapshotV3, PhotoLibraryDevelopCommandV3,
	PhotoLibraryDevelopReadV3, PhotoLibraryDevelopApplyV3, PhotoLibraryDevelopAcknowledgementV3 } from './photo-library-develop-port-v3.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from './photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from './photo-library-develop-original-current-v1.ts';
import type { PhotoLibraryDevelopSettingsPortCurrentV1 } from './photo-library-develop-settings-port-current-v1.ts';
import type { PhotoLibraryDevelopPresetsPortCurrentV1 } from './photo-library-develop-presets-port-current-v1.ts';

export type PhotoLibraryDevelopSettingsCurrentV1 = ImageDevelopStateThroughV4;
export interface PhotoLibraryDevelopSnapshotCurrentV1 extends Omit<PhotoLibraryDevelopSnapshotV3, 'develop'> {
	readonly develop: Readonly<PhotoLibraryDevelopSettingsCurrentV1>;
}
export type PhotoLibraryDevelopCommandCurrentV1 = Exclude<PhotoLibraryDevelopCommandV3, { type: 'record-develop' }>
	| Readonly<{ type: 'record-develop'; versionId: string; develop: PhotoLibraryDevelopSettingsCurrentV1; label: string; createdAt: string }>;
export type PhotoLibraryDevelopReadCurrentV1 = PhotoLibraryDevelopReadV3;
export interface PhotoLibraryDevelopApplyCurrentV1 extends Omit<PhotoLibraryDevelopApplyV3, 'command'> {
	readonly command: PhotoLibraryDevelopCommandCurrentV1;
}
export interface PhotoLibraryDevelopAcknowledgementCurrentV1 extends Omit<PhotoLibraryDevelopAcknowledgementV3, 'snapshot'> {
	readonly snapshot: Readonly<PhotoLibraryDevelopSnapshotCurrentV1>;
}
/** Canonical-only hosts remain usable; a derived operation must independently
 * require the named method rather than treating that fallback as recovery. */
export type PhotoLibraryDevelopOriginalCapabilityCurrentV1 = PhotoLibraryDevelopOriginalPortV1
	& Partial<Pick<PhotoLibraryDevelopOriginalPortCurrentV1, 'withDerivedFrame'>>;

/** Native scalar identity remains3. Only this explicit evolving owner admits
 * process4 and its derived-source capability; the permanent V3 facade stays3. */
export interface PhotoLibraryDevelopPortCurrentV1 extends Omit<PhotoLibraryDevelopPortV3,
	'read' | 'apply' | 'original' | 'settingsCurrent' | 'presetsCurrent'> {
	readonly original?: Readonly<PhotoLibraryDevelopOriginalCapabilityCurrentV1>;
	readonly settingsCurrent?: Readonly<PhotoLibraryDevelopSettingsPortCurrentV1>;
	readonly presetsCurrent?: Readonly<PhotoLibraryDevelopPresetsPortCurrentV1>;
	read(request: PhotoLibraryDevelopReadCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopSnapshotCurrentV1>;
	apply(request: PhotoLibraryDevelopApplyCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopAcknowledgementCurrentV1>;
}
