/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectPhotoFramescaperHandoffSourcesForProfileV1, type PhotoFramescaperHandoffInspectionForProfileV1, type PhotoFramescaperHandoffSourceChoiceForProfileV1 } from './internal/photo-framescaper-handoff-read-kernel-v1.ts';
export interface PhotoFramescaperHandoffSourceChoiceV1 extends Omit<PhotoFramescaperHandoffSourceChoiceForProfileV1, 'processVersion'> { readonly processVersion: 1 | 2 }
export interface PhotoFramescaperHandoffInspectionV1 extends Omit<PhotoFramescaperHandoffInspectionForProfileV1, 'schemaVersion' | 'sources'> { readonly schemaVersion: 1; readonly sources: readonly Readonly<PhotoFramescaperHandoffSourceChoiceV1>[] }
export function inspectPhotoFramescaperHandoffSourcesV1(value: Readonly<{ archive: Blob; signal?: AbortSignal }>): Promise<Readonly<PhotoFramescaperHandoffInspectionV1>> { return inspectPhotoFramescaperHandoffSourcesForProfileV1('legacy2', value) as Promise<Readonly<PhotoFramescaperHandoffInspectionV1>>; }
