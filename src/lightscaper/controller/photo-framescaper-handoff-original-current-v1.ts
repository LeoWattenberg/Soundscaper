/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditableSource as Source } from './internal/photo-image-handoff-model-kernel-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { preparePhotoFramescaperHandoffOriginalForProfileV1, type PhotoFramescaperHandoffOriginalV1 } from './internal/photo-framescaper-handoff-original-kernel-v1.ts';
export type { PhotoFramescaperHandoffOriginalV1 } from './internal/photo-framescaper-handoff-original-kernel-v1.ts';
export interface PhotoFramescaperHandoffOriginalRequestCurrentV1 { readonly source: Readonly<Source>; readonly originalBlob: Blob; readonly canonicalFrameSha256: string; readonly signal?: AbortSignal }
export function preparePhotoFramescaperHandoffOriginalCurrentV1(value: Readonly<PhotoFramescaperHandoffOriginalRequestCurrentV1>, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Promise<Readonly<PhotoFramescaperHandoffOriginalV1>> { return preparePhotoFramescaperHandoffOriginalForProfileV1('current3', value, dependencies); }
