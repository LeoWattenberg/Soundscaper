/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useRef, useState } from 'react';

export function useVideoPreviewOpenFxIssue() {
	const [issue, setIssue] = useState(() => ({ degraded: false, rows: [] }));
	const signatureRef = useRef('');
	const update = useCallback((rows = [], degraded = false) => {
		const nextRows = rows.map(({ instanceId, outputOrdinal, mode, reportsDegradation }) => ({
			instanceId, outputOrdinal, mode, reportsDegradation,
		}));
		const signature = `${degraded ? '1' : '0'}:${nextRows.map((row) => (
			`${row.instanceId}\u0000${row.outputOrdinal}\u0000${row.mode}\u0000${row.reportsDegradation ? '1' : '0'}`
		)).join('\u0001')}`;
		if (signatureRef.current === signature) return;
		signatureRef.current = signature;
		setIssue({ degraded: degraded === true, rows: nextRows });
	}, []);
	return { issue, update };
}

export function videoPreviewOpenFxDispositionAttribute(issue) {
	return issue.rows.map((row) => `${row.instanceId}:${row.outputOrdinal}:${row.mode}`).join(' ');
}

export function boundedVideoPreviewOmissionSummary(effectIds) {
	const visible = effectIds.slice(0, 5);
	return effectIds.length > visible.length
		? `${visible.join(', ')} +${effectIds.length - visible.length}` : visible.join(', ');
}

export function VideoPreviewOpenFxStatus({ issue, copy }) {
	if (!issue.degraded) return null;
	const rows = issue.rows.filter(({ reportsDegradation }) => reportsDegradation)
		.map(({ instanceId, mode }) => `${instanceId}:${mode}`);
	return (
		<div className="kw-audio-editor__video-preview-status" data-video-preview-openfx-warning role="status">
			{copy.videoPreviewOpenFxDegraded
				|| 'OpenFX preview is using an authenticated CPU retry, frozen frame, or bypass.'}
			<small>{boundedVideoPreviewOmissionSummary(rows)}</small>
		</div>
	);
}
