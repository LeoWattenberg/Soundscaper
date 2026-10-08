/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBatchRenameReceiptV1 } from '../../photo-library-batch-rename-port-v1.ts';

export interface PhotoBatchRenameResultsCopyV1 {
	readonly photoBatchCurrentName: string;
	readonly photoBatchNewName: string;
	readonly photoBatchRenamed: string;
	readonly photoBatchRestored: string;
	readonly photoBatchUnchanged: string;
	readonly photoBatchFailed: string;
	readonly photoBatchCancelled: string;
	readonly photoBatchInterrupted: string;
	readonly photoBatchRefreshFailed: string;
}
export interface PhotoBatchRenameResultsPropsV1 {
	readonly receipt: PhotoLibraryBatchRenameReceiptV1;
	readonly notice: 'refresh-failed' | null;
	readonly copy: PhotoBatchRenameResultsCopyV1;
}

/** Acknowledged authored names only; unattempted slots never become successful rows. */
export default function PhotoBatchRenameResults({ receipt, notice, copy }: PhotoBatchRenameResultsPropsV1) {
	const labels = { renamed: copy.photoBatchRenamed, restored: copy.photoBatchRestored,
		unchanged: copy.photoBatchUnchanged, failed: copy.photoBatchFailed };
	return <div data-batch-rename-results data-batch-rename-completion={receipt.completion}>
		{receipt.completion === 'cancelled' && <p role="status">{copy.photoBatchCancelled}</p>}
		{receipt.completion === 'interrupted' && <p role="status">{copy.photoBatchInterrupted}</p>}
		{notice === 'refresh-failed' && <p role="status">{copy.photoBatchRefreshFailed}</p>}
		{receipt.message && <p role="alert">{receipt.message}</p>}
		<table className="lightscaper-batch-rename-table">
			<thead><tr><th scope="col">{copy.photoBatchCurrentName}</th><th scope="col">{copy.photoBatchNewName}</th></tr></thead>
			<tbody>{receipt.items.map(item => <tr key={item.index} data-batch-rename-result-row data-batch-rename-status={item.status}>
				<td><span data-batch-rename-current-name>{item.previousDisplayName}</span></td>
				<td><span data-batch-rename-new-name>{item.fileName}</span><span className="lightscaper-batch-rename-status">{labels[item.status]}</span>
					{item.message && <span className="lightscaper-batch-rename-status">{item.message}</span>}</td>
			</tr>)}</tbody>
		</table>
	</div>;
}
