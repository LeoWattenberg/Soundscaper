/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	splitAdmRiffChunkSequence,
	validateAdmPassthroughPayload,
	validateAdmRiffChunkSequence,
} from './adm-riff-passthrough.ts';
import { AUDIO_EDITOR_MASTER_CHANNELS } from './project.js';
import {
	createAdmChna,
	createRiffAxmlChunk,
	createRiffChnaChunk,
} from './adm-metadata.ts';
import { decodeWavOpaqueRiffChunk } from './wav-opaque-chunks.ts';
import { findUnsafeAdmRenderEffects } from './adm-render-safety.ts';
import {
	isNeutralAdmSignalPath,
	resolveExactAdmPassthroughTimelineSource,
} from './adm-passthrough-project.ts';
import {
	admBedChannelOrder,
	authoredAdmDeliveryChannelCount,
	evaluateAdmPassthroughEligibility,
	normalizeAdmProjectMetadata,
	validateAdmAuthoredRouting,
} from './adm-project-metadata.ts';

/**
 * Building the BW64 / ADM half of an audio export plan.
 *
 * Split out of `export.js` so the plan seam itself stays readable: ADM is two
 * distinct modes — an authored bed and a byte-preserving passthrough — and the
 * rules that keep them apart are most of the volume here, not most of the
 * decisions a plan makes.
 */

export function resolveBw64Adm(project, options) {
	const transient = options.adm !== undefined;
	const requestedMetadata = transient ? options.adm : project.metadata?.adm;
	const metadata = requestedMetadata == null ? null : normalizeAdmProjectMetadata(requestedMetadata);
	if (!metadata) throw new Error('BW64 export requires ADM metadata.');
	if (options.channelMapping != null && options.channelMapping !== 'preserve') {
		throw new Error('BW64 / ADM export requires the preserve channel mapping and ADM channel order.');
	}
	const channelCount = metadata.mode === 'authored'
		? authoredAdmDeliveryChannelCount(metadata)
		: metadata.geometry.channelCount;
	const masterChannels = Number(options.inputChannelCount ?? project.masterChannels ?? AUDIO_EDITOR_MASTER_CHANNELS);
	if ((metadata.mode === 'passthrough' || !transient) && masterChannels !== channelCount) {
		throw new Error(`The ${channelCount}-channel ADM bed does not match the ${masterChannels}-channel project master.`);
	}
	if (metadata.mode === 'authored') {
		const issues = validateAdmAuthoredRouting(metadata, {
			...project,
			masterChannels: transient ? channelCount : masterChannels,
		});
		if (issues.length) throw new Error(`ADM routing is incomplete: ${issues.map(({ message }) => message).join(' ')}`);
		const unsafeEffects = findUnsafeAdmRenderEffects(project, channelCount);
		if (unsafeEffects.length) {
			throw new Error(`ADM export cannot use effects that change terminal channel width: ${unsafeEffects
				.map(({ effectType, scope, targetId }) => `${effectType} on ${scope}${targetId ? ` ${targetId}` : ''}`)
				.join(', ')}.`);
		}
		return Object.freeze({
			metadata,
			channelCount,
			channelOrder: authoredAdmChannelOrder(metadata),
		});
	}
	const channelOrder = validateAdmPassthroughPayload(metadata);
	validateAdmRiffChunkSequence(metadata);
	return Object.freeze({
		metadata,
		channelCount,
		channelOrder,
	});
}

export function createBw64AdmExport(project, resolved, { range, outputFrames, encoding }) {
	const { metadata, channelCount, channelOrder } = resolved;
	if (encoding.channelCount !== channelCount) {
		throw new Error('BW64 output channel count does not match its ADM bed.');
	}
	let preDataChunks;
	let trailingChunks;
	if (metadata.mode === 'authored') {
		preDataChunks = createRiffChnaChunk(createAdmChna({
			layout: metadata.bed.layout,
			objectCount: metadata.objects?.length ?? 0,
		}));
		trailingChunks = createRiffAxmlChunk({
			programmeName: metadata.programme.name,
			contentName: metadata.content.name,
			programmeLanguage: metadata.programme.language,
			contentLanguage: metadata.content.language,
			bedName: metadata.bed.name,
			layout: metadata.bed.layout,
			objects: metadata.objects ?? [],
		});
	} else {
		if (encoding.dither !== 'none') throw new Error('ADM passthrough export requires dither to be disabled.');
		if (!isNeutralAdmSignalPath(project)) {
			throw new Error('ADM passthrough requires a neutral project signal path.');
		}
		const source = resolveExactAdmPassthroughTimelineSource(
			project,
			metadata.geometry.frameCount,
		);
		if (!source) {
			throw new Error('ADM passthrough requires one exact full-source timeline clip and track path.');
		}
		if (source.storageKey !== metadata.source.storageKey || source.mimeType !== metadata.source.mimeType) {
			throw new Error('ADM passthrough is not eligible: source-changed.');
		}
		const outputEligibility = evaluateAdmPassthroughEligibility(metadata, {
			projectRevision: project.revision,
			sourceId: source?.id ?? '',
			sampleRate: encoding.sampleRate,
			channelCount: encoding.channelCount,
			frameCount: outputFrames,
			bitDepth: encoding.bitDepth,
			float: encoding.floatingPoint,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
		});
		if (!outputEligibility.eligible) {
			throw new Error(`ADM passthrough is not eligible: ${outputEligibility.reason}.`);
		}
		const sourceEligibility = evaluateAdmPassthroughEligibility(metadata, {
			projectRevision: project.revision,
			sourceId: source?.id ?? '',
			sampleRate: source?.sampleRate ?? 0,
			channelCount: source?.channelCount ?? 0,
			frameCount: source?.frameCount ?? 0,
			bitDepth: metadata.geometry.bitDepth,
			float: metadata.geometry.float,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
		});
		if (!sourceEligibility.eligible) {
			throw new Error(`ADM passthrough is not eligible: ${sourceEligibility.reason}.`);
		}
		if (metadata.riffChunkSequence?.length) {
			const sequence = splitAdmRiffChunkSequence(metadata);
			preDataChunks = compactRiffChunks(sequence.preDataChunks);
			trailingChunks = compactRiffChunks(sequence.trailingChunks);
		} else {
			const opaqueBefore = (metadata.opaqueRiffChunks ?? [])
				.filter(({ placement }) => placement === 'before-data')
				.map(decodeWavOpaqueRiffChunk);
			const chnaChunk = metadata.chna.rawBase64
				? createRiffChunk('chna', decodeBase64(metadata.chna.rawBase64))
				: undefined;
			preDataChunks = compactRiffChunks([...opaqueBefore, ...(chnaChunk ? [chnaChunk] : [])]);
			const payloads = [
				metadata.payload,
				...(metadata.auxiliaryPayloads ?? []),
				...(metadata.serialPayload ? [metadata.serialPayload] : []),
			];
			const chunks = payloads.map((payload) => createRiffChunk(
				payload.kind,
				payload.kind === 'axml'
					? decodeBase64(payload.rawBase64)
					: decodeBase64(payload.base64),
			));
			const opaqueAfter = (metadata.opaqueRiffChunks ?? [])
				.filter(({ placement }) => placement === 'after-data')
				.map(decodeWavOpaqueRiffChunk);
			trailingChunks = compactRiffChunks([...chunks, ...opaqueAfter]);
		}
	}
	return Object.freeze({
		mode: metadata.mode,
		metadata,
		channelCount,
		channelOrder,
		preDataChunks,
		trailingChunks,
	});
}

/**
 * The delivered channel names of an authored programme: bed channels, then one
 * per object. Object channels are named by object ID, which is what the CHNA and
 * the render both key on.
 */
function authoredAdmChannelOrder(metadata) {
	return Object.freeze([
		...admBedChannelOrder(metadata.bed.layout),
		...(metadata.objects ?? []).map((object) => object.id),
	]);
}

function compactRiffChunks(chunks) {
	if (chunks.length === 0) return undefined;
	return chunks.length === 1 ? chunks[0] : Object.freeze(chunks);
}

function decodeBase64(value) {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createRiffChunk(id, payload) {
	if (!/^[\x20-\x7e]{4}$/u.test(id)) throw new RangeError('ADM RIFF chunk ID must contain four ASCII characters.');
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(Uint8Array.from(id, (character) => character.charCodeAt(0)));
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}
