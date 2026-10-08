/* SPDX-License-Identifier: AGPL-3.0-only */

import { id } from './value-validation.ts';
import { readPhotoQueryRowV2, photoQueryRowKeyV2, photoQuerySummaryV2 } from './photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';
import { photoQueryMatcherV2 } from './photo-query-matcher-v2.ts';
import { photoQueryDigestV2 } from './photo-query-types-v2.ts';
import { readPhotoStackQueryKernel } from './photo-stack-query-kernel.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { authenticatePhotoStackQueryProgressV2, issuePhotoStackQueryProgressV2 } from './photo-stack-query-progress-v2.ts';
import { admitPhotoStackQueryPageRequestV2, type PhotoStackQueryPageRequestV2, type PhotoStackQueryPageV2 } from './photo-stack-query-types-v2.ts';

/** Metadata predicates share ordinary V2 eligibility and the original authenticated bounded stack traversal. */
export async function readPhotoStackQueryPageV2(database: IDBDatabase, catalogValue: string,
	options: PhotoStackQueryPageRequestV2 = {}): Promise<PhotoStackQueryPageV2> {
	const catalogId = id(catalogValue, 'collapsed query V2 catalog ID'), admitted = admitPhotoStackQueryPageRequestV2(catalogId, options);
	const { query, continuation, signal } = admitted;
	authenticatePhotoStackQueryProgressV2(database, continuation);
	return withPhotoStackQuerySignalV1(signal, async privateSignal => {
		const result = await readPhotoStackQueryKernel(database, catalogId, query, continuation, {
			rowStore: 'photoQueryRowsV2', buildStore: 'photoQueryBuildStatesV2', readRow: readPhotoQueryRowV2,
			readBuild: readPhotoQueryBuildStateV2, rowKey: photoQueryRowKeyV2, summarize: photoQuerySummaryV2, matcher: photoQueryMatcherV2,
			issueProgress: progress => issuePhotoStackQueryProgressV2(database, { schemaVersion: 2, kind: 'collapsed-photo-query',
				...progress, querySha256: photoQueryDigestV2(query) }, query),
		}, privateSignal);
		return Object.freeze({ schemaVersion: 2, kind: 'collapsed-photo-query-page', catalogId, ...result });
	});
}
