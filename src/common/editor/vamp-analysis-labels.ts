/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure publication planning for timestamped Vamp features. */

import { createAddLabelTrackCommand } from './commands/factories.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';
import {
	normalizeVampAnalysisResult,
	vampFeatureFrameRange,
	type VampAnalysisResult,
} from './vamp-analysis.ts';

export const MAXIMUM_VAMP_LABELS = 10_000;

type AddTrackCommand = Extract<AudioEditorCommand, { readonly type: 'track/add' }>;

export interface VampFeatureLabelPlanOptions {
	/** Supplies the id that makes the recorded command replayable. */
	readonly createTrackId: () => string;
	readonly trackName?: string;
	readonly outputName: string;
	readonly outputUnit?: string;
}

export interface VampFeatureLabelTrackPlan {
	readonly targetTrackId: string;
	readonly labelCount: number;
	/** One command means one history entry and one undo operation. */
	readonly command: Readonly<AddTrackCommand>;
}

/**
 * Build a new label track in one atomic command. Timestamp arithmetic stays in
 * the Vamp domain so the command layer sees only project sample frames.
 */
export function planVampFeatureLabelTrack(
	resultValue: Readonly<VampAnalysisResult>,
	options: Readonly<VampFeatureLabelPlanOptions>,
): Readonly<VampFeatureLabelTrackPlan> {
	const result = normalizeVampAnalysisResult(resultValue);
	if (result.features.length === 0) throw new RangeError('A Vamp result with no features authors no labels.');
	if (result.features.length > MAXIMUM_VAMP_LABELS) {
		throw new RangeError('A Vamp result exceeds the 10,000-label ceiling.');
	}
	if (typeof options?.createTrackId !== 'function') {
		throw new TypeError('Creating a Vamp label track needs an id factory.');
	}
	const targetTrackId = boundedText(options.createTrackId(), 'Vamp label track id', false, 512);
	const outputName = boundedText(options.outputName, 'Vamp output name', false, 4_096);
	const outputUnit = boundedText(options.outputUnit ?? '', 'Vamp output unit', true, 512);
	const trackName = boundedText(options.trackName ?? outputName, 'Vamp label track name', false, 4_096).trim();
	if (trackName.length === 0) throw new TypeError('A Vamp label track name must be non-empty.');
	const labels = result.features.map((feature, index) => {
		const range = vampFeatureFrameRange(result.request, feature);
		return Object.freeze({
			title: featureTitle(feature.label, feature.values, outputName, outputUnit, index),
			startFrame: range.startFrame,
			endFrame: range.endFrame,
		});
	});
	const command = deepFreeze(createAddLabelTrackCommand({
		id: targetTrackId,
		name: trackName,
		labels,
	}));
	return Object.freeze({ targetTrackId, labelCount: labels.length, command });
}

function featureTitle(
	label: string,
	values: readonly number[],
	outputName: string,
	outputUnit: string,
	index: number,
): string {
	const authored = label.trim();
	if (authored) return authored;
	if (values.length === 0) return outputName;
	const rendered = values.map((value) => String(Object.is(value, -0) ? 0 : value)).join(', ');
	const title = `${outputName}: ${rendered}${outputUnit ? ` ${outputUnit}` : ''}`;
	return boundedText(title, `Vamp feature ${String(index)} title`, false, 16_384);
}

function boundedText(
	value: unknown,
	name: string,
	empty: boolean,
	maximum: number,
): string {
	if (typeof value !== 'string' || (!empty && value.length === 0)
		|| value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${name} must be ${empty ? 'a' : 'a non-empty'} bounded string.`);
	}
	return value;
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
