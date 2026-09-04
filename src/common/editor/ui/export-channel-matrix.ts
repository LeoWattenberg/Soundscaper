/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The checkbox matrix behind Audacity's custom channel mapping.
 *
 * A mapping is a list of output channels, each naming the input channels that
 * feed it and at what gain. The matrix editor states routing only, so every
 * checked cell is unity gain and every unchecked one is absent — which is what
 * makes it a grid of checkboxes rather than a grid of faders. A mapping already
 * holding gains the grid cannot express is left exactly as it is until the
 * operator applies an edit, so opening the window never rewrites it.
 */

export const MAXIMUM_EXPORT_CHANNELS = 32;

type DataRecord = Readonly<Record<string, unknown>>;

/** `matrix[input][output]` — a row per delivered input, a column per output. */
export type ExportChannelMatrix = readonly (readonly boolean[])[];

export function exportChannelMatrixOutputCount(matrix: ExportChannelMatrix): number {
	return matrix[0]?.length ?? 0;
}

/**
 * Read one mapping into the grid, falling back to an identity routing.
 *
 * An empty or unreadable mapping is not an error here: the operator is opening
 * the editor to write one, and the identity routing is the mapping the delivery
 * would have made without them.
 */
export function parseExportChannelMatrix(
	value: unknown,
	inputChannelCount: number,
): ExportChannelMatrix {
	const inputs = boundedChannelCount(inputChannelCount, 2);
	const channels = readOutputChannels(value);
	if (!channels) return identityExportChannelMatrix(inputs);
	const outputs = boundedChannelCount(channels.length, inputs);
	const matrix = Array.from({ length: inputs }, () => Array.from({ length: outputs }, () => false));
	for (const [outputIndex, channel] of channels.slice(0, outputs).entries()) {
		for (const input of readInputs(channel)) {
			if (input.channel < inputs && input.gain !== 0) matrix[input.channel][outputIndex] = true;
		}
	}
	return freezeMatrix(matrix);
}

export function identityExportChannelMatrix(inputChannelCount: number): ExportChannelMatrix {
	const inputs = boundedChannelCount(inputChannelCount, 2);
	return freezeMatrix(Array.from({ length: inputs }, (_, input) => (
		Array.from({ length: inputs }, (__, output) => input === output)
	)));
}

/**
 * Widen the grid to hold at least this many outputs, never narrowing it.
 *
 * The output count is typed a digit at a time, so trimming the grid to match it
 * would delete the routing of every column past the first digit before the
 * second one arrived. The count decides what is shown and delivered; the grid
 * only ever remembers more than that.
 */
export function ensureExportChannelMatrixWidth(
	matrix: ExportChannelMatrix,
	outputChannelCount: number,
): ExportChannelMatrix {
	const outputs = Math.max(
		boundedChannelCount(outputChannelCount, exportChannelMatrixOutputCount(matrix)),
		exportChannelMatrixOutputCount(matrix),
	);
	if (outputs === exportChannelMatrixOutputCount(matrix)) return matrix;
	return freezeMatrix(matrix.map((row) => Array.from(
		{ length: outputs },
		(_, output) => row[output] ?? false,
	)));
}

/** The output count a stepper's text means, kept inside the delivered bounds. */
export function boundedExportChannelCount(value: unknown, fallback: number): number {
	return boundedChannelCount(value, fallback);
}

export function toggleExportChannelMatrix(
	matrix: ExportChannelMatrix,
	input: number,
	output: number,
	checked: boolean,
): ExportChannelMatrix {
	return freezeMatrix(matrix.map((row, rowIndex) => row.map((cell, cellIndex) => (
		rowIndex === input && cellIndex === output ? checked : cell
	))));
}

/** The mapping the grid means, in the shape the export request already parses. */
export function serializeExportChannelMatrix(
	matrix: ExportChannelMatrix,
	outputChannelCount: number = exportChannelMatrixOutputCount(matrix),
): string {
	const outputs = boundedChannelCount(outputChannelCount, exportChannelMatrixOutputCount(matrix));
	return `${JSON.stringify({
		channels: Array.from({ length: outputs }, (_, output) => ({
			inputs: matrix.flatMap((row, input) => (row[output] ? [{ channel: input, gain: 1 }] : [])),
		})),
	}, null, 2)}\n`;
}

function readOutputChannels(value: unknown): readonly unknown[] | null {
	const parsed = typeof value === 'string' ? parseJson(value) : value;
	if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null;
	const channels = (parsed as DataRecord | null)?.channels;
	return Array.isArray(channels) && channels.length > 0 ? channels : null;
}

function parseJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return null;
	try { return JSON.parse(trimmed); } catch { return null; }
}

function readInputs(channel: unknown): readonly Readonly<{ channel: number; gain: number }>[] {
	const inputs = Array.isArray(channel)
		? channel
		: Array.isArray((channel as DataRecord | null)?.inputs)
			? (channel as Readonly<{ inputs: readonly unknown[] }>).inputs
			: [];
	return inputs.flatMap((value) => {
		if (typeof value === 'number') {
			return Number.isSafeInteger(value) && value >= 0 ? [{ channel: value, gain: 1 }] : [];
		}
		const record = value as DataRecord | null;
		const channelIndex = Number(record?.channel);
		if (!Number.isSafeInteger(channelIndex) || channelIndex < 0) return [];
		const gain = Number(record?.gain ?? 1);
		return [{ channel: channelIndex, gain: Number.isFinite(gain) ? gain : 1 }];
	});
}

function boundedChannelCount(value: unknown, fallback: number): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 1) return fallback;
	return Math.min(count, MAXIMUM_EXPORT_CHANNELS);
}

function freezeMatrix(matrix: readonly (readonly boolean[])[]): ExportChannelMatrix {
	return Object.freeze(matrix.map((row) => Object.freeze([...row])));
}
