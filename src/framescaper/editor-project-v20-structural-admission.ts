/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	admitAudioEditorProjectV9ValidationStructure,
	resolveAudioEditorProjectV9ValidationLimits,
	type AudioEditorProjectV9ValidationLimits,
} from '../common/editor/project-v9-validation-budget.ts';

export interface FramescaperProjectV20ValidationOptions {
	readonly limits?: Partial<AudioEditorProjectV9ValidationLimits>;
}

/** Apply the same whole-document structural budget before every V20 semantic entry. */
export function admitFramescaperProjectV20Structure(
	project: unknown,
	optionsValue: FramescaperProjectV20ValidationOptions | unknown = {},
): Readonly<AudioEditorProjectV9ValidationLimits> {
	const options = readClosedDomainRecord(
		optionsValue,
		'Framescaper V20 validation options',
		['limits'],
		[],
	);
	const limits = Object.hasOwn(options, 'limits')
		? resolveLimits(readClosedDomainField(options, 'limits', 'Framescaper V20 validation options'))
		: resolveAudioEditorProjectV9ValidationLimits();
	admitAudioEditorProjectV9ValidationStructure(project, limits);
	return limits;
}

function resolveLimits(value: unknown): Readonly<AudioEditorProjectV9ValidationLimits> {
	const limits = readClosedDomainRecord(value, 'Framescaper V20 validation limits', [
		'maximumTraversalNodes', 'maximumTraversalDepth',
	], []);
	return resolveAudioEditorProjectV9ValidationLimits({
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
