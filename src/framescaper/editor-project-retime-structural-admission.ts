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

export interface FramescaperProjectRetimeValidationOptions {
	readonly limits?: Partial<AudioEditorProjectValidationLimits>;
}

/** Apply the same whole-document structural budget before every retime semantic entry. */
export function admitFramescaperProjectRetimeStructure(
	project: unknown,
	optionsValue: FramescaperProjectRetimeValidationOptions | unknown = {},
): Readonly<AudioEditorProjectValidationLimits> {
	const options = readClosedDomainRecord(
		optionsValue,
		'Framescaper retime validation options',
		['limits'],
		[],
	);
	const limits = Object.hasOwn(options, 'limits')
		? resolveLimits(readClosedDomainField(options, 'limits', 'Framescaper retime validation options'))
		: resolveAudioEditorProjectValidationLimits();
	admitAudioEditorProjectValidationStructure(project, limits);
	return limits;
}

function resolveLimits(value: unknown): Readonly<AudioEditorProjectValidationLimits> {
	const limits = readClosedDomainRecord(value, 'Framescaper retime validation limits', [
		'maximumTraversalNodes', 'maximumTraversalDepth',
	], []);
	return resolveAudioEditorProjectValidationLimits({
		...(Object.hasOwn(limits, 'maximumTraversalNodes') ? {
			maximumTraversalNodes: readClosedDomainField(
				limits, 'maximumTraversalNodes', 'Framescaper retime validation limits',
			),
		} : {}),
		...(Object.hasOwn(limits, 'maximumTraversalDepth') ? {
			maximumTraversalDepth: readClosedDomainField(
				limits, 'maximumTraversalDepth', 'Framescaper retime validation limits',
			),
		} : {}),
	});
}
