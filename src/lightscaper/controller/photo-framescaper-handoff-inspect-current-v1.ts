/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectPhotoFramescaperHandoffSourcesForProfileV1, type PhotoFramescaperHandoffInspectionForProfileV1, type PhotoFramescaperHandoffSourceChoiceForProfileV1 } from './internal/photo-framescaper-handoff-read-kernel-v1.ts';
export interface PhotoFramescaperHandoffSourceChoiceCurrentV1 extends Omit<PhotoFramescaperHandoffSourceChoiceForProfileV1, 'processVersion'> { readonly processVersion: 1 | 2 | 3 | 4 }
export interface PhotoFramescaperHandoffInspectionCurrentV1 extends Omit<PhotoFramescaperHandoffInspectionForProfileV1, 'schemaVersion' | 'sources'> { readonly schemaVersion: 2; readonly sources: readonly Readonly<PhotoFramescaperHandoffSourceChoiceCurrentV1>[] }
export function inspectPhotoFramescaperHandoffSourcesCurrentV1(value: Readonly<{ archive: Blob; signal?: AbortSignal }>): Promise<Readonly<PhotoFramescaperHandoffInspectionCurrentV1>> { return inspectPhotoFramescaperHandoffSourcesForProfileV1('current3', value) as Promise<Readonly<PhotoFramescaperHandoffInspectionCurrentV1>>; }
