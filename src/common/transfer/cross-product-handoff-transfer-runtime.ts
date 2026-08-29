/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CrossProductHandoffConversionReportV1 } from './cross-product-handoff-conversion.ts';
import {
	admitCrossProductHandoffLaunchIntent,
	type CrossProductHandoffLaunchIntentV1,
} from '../cross-product-handoff-intent.ts';
import type { TransferRuntime } from './transfer-archive-stream.ts';

/** Bind one invocation to the ordinary stream; the bundle layer creates archive custody metadata. */
export function createEditableCopyTransferRuntime(
	runtime: TransferRuntime,
	intentValue: unknown,
	onReport: (report: Readonly<CrossProductHandoffConversionReportV1>) => void = () => undefined,
): TransferRuntime {
	const intent = admitCrossProductHandoffLaunchIntent(intentValue);
	if (typeof runtime?.exportEditableCopy !== 'function') {
		throw new TypeError('The loaded transfer runtime cannot export editable cross-product copies.');
	}
	if (typeof onReport !== 'function') {
		throw new TypeError('An editable-copy report consumer must be a function.');
	}
	const exportProject: TransferRuntime['exportProject'] = async (project, store, options) => {
		try {
			const result = await runtime.exportEditableCopy!(project, store, {
				...options,
				intent: intent as CrossProductHandoffLaunchIntentV1,
			});
			onReport(result.conversionReport);
			return {
				blob: result.blob,
				projectId: result.projectId,
				title: result.title,
				fileExtension: result.fileExtension,
				conversionReport: result.conversionReport,
			};
		} catch (error) {
			const report = (error as { report?: unknown } | null)?.report;
			if (isConversionReport(report)) onReport(report);
			throw error;
		}
	};
	return Object.freeze({
		...runtime,
		exportProject,
	});
}

function isConversionReport(value: unknown): value is Readonly<CrossProductHandoffConversionReportV1> {
	return Boolean(value && typeof value === 'object'
		&& (value as { kind?: unknown }).kind === 'cross-product-editable-copy-report'
		&& (value as { version?: unknown }).version === 1);
}
