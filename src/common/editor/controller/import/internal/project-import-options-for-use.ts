/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeSourceProvenance } from '../../../source-provenance.ts';
import {
	freezeProjectImportOptions,
	isNormalizedProjectImportOptions,
	linkedOriginalLocatorReferencesFromImportOptions,
	normalizeLinkedOriginalImportLocator,
	normalizeProjectImportOptions,
	optionRecord,
	type LinkedOriginalImportLocatorReference,
	type NormalizedProjectImportOptions,
} from './project-import-options.ts';

/** Validate import-only attribution after the user has committed to importing. */
export async function normalizeProjectImportOptionsForUse(
	value: unknown,
	timelineFramesFinite: string,
	releaseLocator: (reference: LinkedOriginalImportLocatorReference) => PromiseLike<unknown> | unknown,
): Promise<Readonly<NormalizedProjectImportOptions>> {
	const locatorReferences = linkedOriginalLocatorReferencesFromImportOptions(value);
	try {
		const normalized = isNormalizedProjectImportOptions(value)
			? value
			: normalizeProjectImportOptions(value, timelineFramesFinite);
		if (isNormalizedProjectImportOptions(value)) {
			normalizeLinkedOriginalImportLocator(optionRecord(value));
		}
		if (normalized.sourceProvenance == null) return normalized;
		return freezeProjectImportOptions({
			...normalized,
			sourceProvenance: normalizeSourceProvenance(
				normalized.sourceProvenance,
				'import source provenance',
			),
		}, Boolean(normalized.timelineStartExplicit));
	} catch (error) {
		if (locatorReferences.length) {
			const cleanupErrors: unknown[] = [];
			try {
				for (const reference of locatorReferences) {
					try {
						await releaseLocator(reference);
					} catch (cleanupError) {
						cleanupErrors.push(cleanupError);
					}
				}
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Import option validation and linked-original locator cleanup both failed.',
					{ cause: error },
				);
			}
		}
		throw error;
	}
}
