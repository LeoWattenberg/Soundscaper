/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeMixerGraphV21,
	type MixerGraphV21,
} from '../mixer-graph-v21.ts';

interface Bw64RenderOptions {
	readonly channelCount: unknown;
	readonly metadata: unknown;
}

/**
 * Project authored BW64 delivery geometry without changing the saved mixer.
 *
 * Transient ADM metadata may widen a stereo project for one delivery. The
 * master, its main output, and the edge between them must describe the same
 * width or the production graph truncates the ADM programme before capture.
 */
export function createBw64RenderProject<Project extends object>(
	project: Project,
	options: Bw64RenderOptions,
): Project {
	const channelCount = positiveChannelCount(options.channelCount);
	const admMetadata = record(options.metadata, 'BW64 render ADM metadata');
	const source = project as Project & {
		readonly masterChannels?: unknown;
		readonly metadata?: unknown;
		readonly mixer?: unknown;
	};
	const metadata = source.metadata == null
		? Object.freeze({})
		: record(source.metadata, 'BW64 render project metadata');
	const mixer = admMetadata.mode !== 'authored' || source.mixer === undefined
		? undefined
		: createAuthoredBw64MixerProjection(source.mixer, channelCount);
	return {
		...source,
		masterChannels: channelCount,
		metadata: { ...metadata, adm: options.metadata },
		...(mixer === undefined ? {} : { mixer }),
	} as Project;
}

function createAuthoredBw64MixerProjection(value: unknown, channelCount: number): MixerGraphV21 {
	const mixer = normalizeMixerGraphV21(value);
	const mainOutput = mixer.outputs.find(({ role }) => role === 'main');
	if (!mainOutput) throw new TypeError('The BW64 render mixer has no main output.');
	const identity = Object.freeze(Array.from({ length: channelCount }, (_value, index) => index));
	return normalizeMixerGraphV21({
		...mixer,
		outputs: mixer.outputs.map((output) => output.id === mainOutput.id
			? { ...output, channelCount }
			: output),
		edges: mixer.edges.map((edge) => edge.source.kind === 'master'
			&& edge.destination.kind === 'output'
			&& edge.destination.id === mainOutput.id
			? { ...edge, channelMap: identity }
			: edge),
	});
}

function positiveChannelCount(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 32) {
		throw new RangeError('Authored BW64 render channel count must be an integer from 1 through 32.');
	}
	return Number(value);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
