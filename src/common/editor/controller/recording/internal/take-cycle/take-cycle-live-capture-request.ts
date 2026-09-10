/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TakeCycleLiveLaneRequest {
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly lane: Readonly<{
		readonly groupId: string;
		readonly trackId: string;
		readonly sequenceId: string;
		readonly name: string;
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly chunkFrames: number;
	}>;
}

export function normalizeTakeCycleLiveLaneRequest(
	value: TakeCycleLiveLaneRequest,
): TakeCycleLiveLaneRequest {
	const loopStartSample = nonNegativeInteger(value.loopStartSample, 'take cycle loopStartSample');
	const loopEndSample = nonNegativeInteger(value.loopEndSample, 'take cycle loopEndSample');
	if (loopEndSample <= loopStartSample) throw new RangeError('Take cycle loop extent must be positive.');
	const lane = value.lane;
	return Object.freeze({
		projectId: stableId(value.projectId, 'take cycle projectId'),
		publicationGeneration: positiveInteger(value.publicationGeneration, 'take cycle publicationGeneration'),
		loopStartSample,
		loopEndSample,
		lane: Object.freeze({
			groupId: stableId(lane.groupId, 'take cycle groupId'),
			trackId: stableId(lane.trackId, 'take cycle trackId'),
			sequenceId: stableId(lane.sequenceId, 'take cycle sequenceId'),
			name: stableName(lane.name),
			sampleRate: positiveInteger(lane.sampleRate, 'take cycle sampleRate', 768_000),
			channelCount: positiveInteger(lane.channelCount, 'take cycle channelCount', 64),
			chunkFrames: positiveInteger(lane.chunkFrames, 'take cycle chunkFrames', 65_536),
		}),
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function stableName(value: unknown): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > 255) {
		throw new TypeError('Take cycle source name is invalid.');
	}
	return value;
}

function positiveInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${name} must be a supported positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
