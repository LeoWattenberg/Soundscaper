/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	admitAudioEditorProjectValidationStructure,
	resolveAudioEditorProjectValidationLimits,
	type AudioEditorProjectValidationLimits,
} from '../common/editor/project-validation-budget.ts';

export interface FramescaperProjectV20ValidationOptions {
	readonly limits?: Partial<AudioEditorProjectValidationLimits>;
}

/** Apply the same whole-document structural budget before every V20 semantic entry. */
export function admitFramescaperProjectV20Structure(
	project: unknown,
	optionsValue: FramescaperProjectV20ValidationOptions | unknown = {},
): Readonly<AudioEditorProjectValidationLimits> {
	const options = readClosedDomainRecord(
		optionsValue,
		'Framescaper V20 validation options',
		['limits'],
		[],
	);
	const limits = Object.hasOwn(options, 'limits')
		? resolveLimits(readClosedDomainField(options, 'limits', 'Framescaper V20 validation options'))
		: resolveAudioEditorProjectValidationLimits();
	admitAudioEditorProjectValidationStructure(project, limits);
	return limits;
}

function resolveLimits(value: unknown): Readonly<AudioEditorProjectValidationLimits> {
	const limits = readClosedDomainRecord(value, 'Framescaper V20 validation limits', [
		'maximumTraversalNodes', 'maximumTraversalDepth',
	], []);
	return resolveAudioEditorProjectValidationLimits({
		...(Object.hasOwn(limits, 'maximumTraversalNodes') ? {
			maximumTraversalNodes: readClosedDomainField(
				limits, 'maximumTraversalNodes', 'Framescaper V20 validation limits',
			),
		} : {}),
		...(Object.hasOwn(limits, 'maximumTraversalDepth') ? {
			maximumTraversalDepth: readClosedDomainField(
				limits, 'maximumTraversalDepth', 'Framescaper V20 validation limits',
			),
		} : {}),
	});
}
