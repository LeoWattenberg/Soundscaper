/* SPDX-License-Identifier: AGPL-3.0-only */

import { id } from './value-validation.ts';
import { readPhotoQueryBuildStateV1, readPhotoQueryRowV1, photoQueryRowKeyV1 } from './photo-query-index-v1.ts';
import { photoQueryMatcherV1 } from './photo-query-matcher-v1.ts';
import { photoQueryDigestV1 } from './photo-query-types-v1.ts';
import { authenticatePhotoStackQueryProgressV1, issuePhotoStackQueryProgressV1 } from './photo-stack-query-progress-v1.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { readPhotoStackQueryKernel } from './photo-stack-query-kernel.ts';
import { admitPhotoStackQueryPageRequestV1, type PhotoStackQueryPageRequestV1, type PhotoStackQueryPageV1 } from './photo-stack-query-types-v1.ts';

/** V1's closed admission, connection signature and exact returned protocol remain unchanged. */
export async function readPhotoStackQueryPageV1(database: IDBDatabase, catalogValue: string,
	options: PhotoStackQueryPageRequestV1 = {}): Promise<PhotoStackQueryPageV1> {
	const catalogId = id(catalogValue, 'collapsed query catalog ID'), admitted = admitPhotoStackQueryPageRequestV1(catalogId, options);
	const { query, signal, continuation } = admitted;
	authenticatePhotoStackQueryProgressV1(database, continuation);
	return withPhotoStackQuerySignalV1(signal, async privateSignal => {
		const result = await readPhotoStackQueryKernel(database, catalogId, query, continuation, {
			rowStore: 'photoQueryRows', buildStore: 'photoQueryBuildStates',
			readRow: readPhotoQueryRowV1, readBuild: readPhotoQueryBuildStateV1, rowKey: photoQueryRowKeyV1,
			summarize: row => row.summary, matcher: photoQueryMatcherV1,
			issueProgress: progress => issuePhotoStackQueryProgressV1(database, { schemaVersion: 1, kind: 'collapsed-photo-query',
				...progress, querySha256: photoQueryDigestV1(query) }, query),
		}, privateSignal);
		return Object.freeze({ catalogName: result.catalogName, totalCount: result.totalCount,
			items: result.items, scanned: result.scanned, continuation: result.continuation });
	});
}
