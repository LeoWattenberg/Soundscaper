/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperImageSourceV2 as Source } from '../../common/editor/timeline-image-model-v2.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { preparePhotoFramescaperHandoffOriginalForProfileV1, type PhotoFramescaperHandoffOriginalV1 } from './internal/photo-framescaper-handoff-original-kernel-v1.ts';
export type { PhotoFramescaperHandoffOriginalV1 } from './internal/photo-framescaper-handoff-original-kernel-v1.ts';
export interface PhotoFramescaperHandoffOriginalRequestV1 { readonly source: Readonly<Source>; readonly originalBlob: Blob; readonly canonicalFrameSha256: string; readonly signal?: AbortSignal }
export function preparePhotoFramescaperHandoffOriginalV1(value: Readonly<PhotoFramescaperHandoffOriginalRequestV1>, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Promise<Readonly<PhotoFramescaperHandoffOriginalV1>> { return preparePhotoFramescaperHandoffOriginalForProfileV1('legacy2', value, dependencies); }
