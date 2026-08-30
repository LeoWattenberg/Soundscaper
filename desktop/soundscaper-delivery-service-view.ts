/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	sealSoundscaperDeliveryReportV1,
	validateSoundscaperDeliveryDescriptionV1,
	validateSoundscaperDeliveryResultV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryProjectIdentityV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	soundscaperDeliveryFailureCode,
	soundscaperDeliveryNonNegativeInteger,
	waitingSoundscaperDeliveryState,
	type SoundscaperDeliveryAttemptReportRow,
	type SoundscaperDeliveryQueueRow,
	type SoundscaperDeliverySummary,
} from './soundscaper-delivery-service-contract.ts';

export function soundscaperDeliveryDescription(
	row: SoundscaperDeliveryQueueRow,
): SoundscaperDeliveryDescriptionV1 {
	return validateSoundscaperDeliveryDescriptionV1(JSON.parse(String(row.description_json)));
}

export function soundscaperDeliverySummary(
	row: SoundscaperDeliveryQueueRow,
	current: SoundscaperDeliveryProjectIdentityV1 | null,
	reportRows: readonly SoundscaperDeliveryAttemptReportRow[] = [],
): SoundscaperDeliverySummary {
	const description = soundscaperDeliveryDescription(row);
	return Object.freeze({
		jobId: row.job_id,
		label: String(row.label),
		state: waitingSoundscaperDeliveryState(row.state, description.projectIdentity, current),
		attempt: Number(row.attempt),
		progress: row.progress === null ? null : Number(row.progress),
		lastFailureCode: row.last_failure_code === null ? null : String(row.last_failure_code),
		projectIdentity: description.projectIdentity,
		planFingerprint: description.planFingerprint,
		destinationGrantId: description.destinationGrantId,
		batchId: row.batch_id === null ? null : String(row.batch_id),
		batchMember: row.batch_member_json === null ? null
			: Object.freeze(JSON.parse(String(row.batch_member_json)) as Record<string, unknown>),
		report: row.report_json === null ? null
			: sealSoundscaperDeliveryReportV1(JSON.parse(String(row.report_json))),
		reportHistory: Object.freeze(reportRows.map((entry) => {
			const attempt = soundscaperDeliveryNonNegativeInteger(entry.attempt, 'report attempt');
			if (attempt < 1 || (entry.outcome !== 'completed' && entry.outcome !== 'failed')) {
				throw new TypeError('The persisted Soundscaper delivery attempt report is invalid.');
			}
			return Object.freeze({
				attempt, outcome: entry.outcome,
				failureCode: entry.failure_code === null ? null
					: soundscaperDeliveryFailureCode(entry.failure_code),
				report: sealSoundscaperDeliveryReportV1(JSON.parse(String(entry.report_json))),
			});
		})),
		result: row.result_json === null ? null : validateSoundscaperDeliveryResultV1(
			JSON.parse(String(row.result_json)), description,
		),
	});
}
