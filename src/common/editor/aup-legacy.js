import {
	LEGACY_AUP_XML_HARD_LIMITS,
	LegacyAupError,
	readLegacyAupXml,
} from './aup-legacy-xml.ts';
import {
	decodeAuBlockFile,
	LEGACY_AUP_BLOCK_HARD_LIMITS,
	LegacyAupBlockBudget,
	resolveLegacyAupBlockLimits,
} from './aup-legacy-block-budget.ts';

export {
	decodeAuBlockFile,
	LEGACY_AUP_BLOCK_HARD_LIMITS,
	LEGACY_AUP_XML_HARD_LIMITS,
	LegacyAupError,
};

/**
 * Parse an Audacity 1.x/2.x `.aup` XML project plus user-selected `_data`
 * files into the structured representation consumed by the legacy AUP converter.
 */
export async function decodeLegacyAupProject(projectFile, dataFiles, options = {}) {
	const blockLimits = resolveLegacyAupBlockLimits(options.blockLimits);
	const root = await readLegacyAupXml(projectFile, options.parseLimits);
	const project = root.name === 'project' ? root : findDescendant(root, 'project');
	if (!project) throw new LegacyAupError('The AUP file has no project element.', 'INVALID_PROJECT_XML');
	const budget = new LegacyAupBlockBudget(blockLimits);
	const files = indexLegacyFiles(dataFiles || [], budget);
	const projectRate = positiveRate(attribute(project, 'rate', 44_100));
	const waveTracks = children(project, 'wavetrack');
	const missing = new Set();
	const referencedFiles = new Map();
	const physicalPlans = [];
	for (const [trackIndex, trackNode] of waveTracks.entries()) {
		const trackRate = positiveRate(attribute(trackNode, 'rate', projectRate));
		const clipPlans = [];
		for (const [clipIndex, clipNode] of children(trackNode, 'waveclip').entries()) {
			const sequence = children(clipNode, 'sequence')[0];
			if (!sequence) continue;
			const clipPlan = {
				clipIndex,
				clipNode,
				frameCount: 0,
				samples: null,
				trackRate,
			};
			for (const waveBlock of children(sequence, 'waveblock')) {
				const silent = children(waveBlock, 'silentblockfile')[0];
				if (silent) {
					const length = positiveBlockLength(attribute(silent, 'len', undefined));
					budget.admitReference(length);
					clipPlan.frameCount = checkedFrameSum(clipPlan.frameCount, length);
					continue;
				}
				const block = children(waveBlock, 'simpleblockfile')[0];
				const alias = children(waveBlock, 'pcmaliasblockfile')[0];
				if (alias) throw new LegacyAupError('Legacy projects with aliased external audio require the original media and are not self-contained.', 'UNSUPPORTED_ALIAS_BLOCK', { filename: attribute(alias, 'aliasfile', '') });
				if (!block) continue;
				const filename = String(attribute(block, 'filename', '')).trim();
				const length = positiveBlockLength(attribute(block, 'len', undefined));
				budget.admitReference(length);
				const file = findLegacyFile(files, filename);
				const destinationOffset = clipPlan.frameCount;
				clipPlan.frameCount = checkedFrameSum(clipPlan.frameCount, length);
				if (!file) { missing.add(filename); continue; }
				let referenced = referencedFiles.get(file);
				if (!referenced) {
					referenced = { file, filename, placements: [] };
					referencedFiles.set(file, referenced);
				}
				referenced.placements.push({ clipPlan, destinationOffset, length, filename });
			}
			if (clipPlan.frameCount) clipPlans.push(clipPlan);
		}
		physicalPlans.push({ clipPlans, trackIndex, trackNode, trackRate });
	}
	if (missing.size) throw new LegacyAupError(`Missing legacy Audacity block files: ${[...missing].join(', ')}.`, 'MISSING_BLOCK_FILES', { filenames: [...missing] });
	for (const referenced of referencedFiles.values()) {
		referenced.declaredSize = referenced.file.size;
		budget.admitReferencedFile(referenced.filename, referenced.declaredSize);
	}
	admitLinkedTrackPadding(physicalPlans, budget);
	const physicalTracks = physicalPlans.map(materializePhysicalTrack);
	const tracks = linkLegacyAupTracks(physicalTracks);
	const totalBlocks = [...referencedFiles.values()].reduce((sum, entry) => sum + entry.placements.length, 0);
	const corrupt = [];
	let completed = 0;
	for (const { file, filename, declaredSize, placements } of referencedFiles.values()) {
		let decoded;
		try {
			const buffer = await file.arrayBuffer();
			if (!(buffer instanceof ArrayBuffer)) throw new TypeError(`${filename} did not return an ArrayBuffer.`);
			budget.assertActualFileSize(filename, declaredSize, buffer.byteLength);
			decoded = decodeAuBlockFile(new Uint8Array(buffer), blockLimits);
			const truncated = placements.find((placement) => decoded.length < placement.length);
			if (truncated) throw new LegacyAupError(`${truncated.filename} is truncated.`, 'CORRUPT_BLOCK_FILE');
		} catch (error) {
			if (isBlockAdmissionError(error)) throw error;
			corrupt.push({ filename, code: error?.code || 'CORRUPT_BLOCK_FILE', message: error?.message || String(error) });
			continue;
		}
		for (const placement of placements) {
			placement.clipPlan.samples.set(
				decoded.subarray(0, placement.length),
				placement.destinationOffset,
			);
			completed += 1;
			options.onProgress?.({ progress: totalBlocks ? completed / totalBlocks : 1, phase: 'reading-blocks', filename: placement.filename });
		}
	}
	if (corrupt.length) throw new LegacyAupError(`Corrupt legacy Audacity block files: ${corrupt.map((entry) => entry.filename).join(', ')}.`, 'CORRUPT_BLOCK_FILES', { files: corrupt });
	for (const [index, trackNode] of children(project, 'labeltrack').entries()) tracks.push({
		type: 'label',
		name: String(attribute(trackNode, 'name', `Labels ${index + 1}`)),
		labels: children(trackNode, 'label').map((label) => ({
			title: String(attribute(label, 'title', '')),
			startSeconds: nonNegative(attribute(label, 't', 0)),
			endSeconds: nonNegative(attribute(label, 't1', attribute(label, 't', 0))),
			opaqueExtensions: { legacyAupLabel: cloneNode(label) },
		})),
		opaqueExtensions: { legacyAupLabelTrack: cloneNode(trackNode) },
	});
	options.onProgress?.({ progress: 1, phase: 'complete' });
	return {
		sampleRate: projectRate,
		tempo: { bpm: positive(attribute(project, 'time_signature_tempo', 120), 120), timeSignature: { numerator: 4, denominator: 4 } },
		selection: { startSeconds: nonNegative(attribute(project, 'sel0', 0)), endSeconds: nonNegative(attribute(project, 'sel1', 0)) },
		view: { zoom: positive(attribute(project, 'zoom', 100), 100), horizontalPosition: nonNegative(attribute(project, 'h', 0)), verticalPosition: Math.round(nonNegative(attribute(project, 'vpos', 0))) },
		tracks,
		metadata: { title: String(attribute(project, 'projname', projectFile.name || 'Audacity project')).replace(/\.aup$/i, '') },
		warnings: [],
		opaqueExtensions: { legacyAupProject: cloneNode(project) },
	};
}

function indexLegacyFiles(values, budget) {
	if (!values || typeof values[Symbol.iterator] !== 'function') throw new TypeError('Legacy AUP block files must be iterable.');
	const exact = new Map();
	const basename = new Map();
	for (const file of values) {
		budget.admitSelectedFile();
		if (!file || typeof file.arrayBuffer !== 'function') continue;
		const paths = [...new Set([file.name, file.webkitRelativePath]
			.filter(Boolean)
			.map(normalizedPath))];
		for (const path of paths) {
			addLegacyFileMatch(exact, path, file);
			addLegacyFileMatch(basename, path.split('/').at(-1), file);
		}
	}
	return { basename, exact };
}

function findLegacyFile(files, filename) {
	const normalized = normalizedPath(filename);
	const exact = files.exact.get(normalized);
	if (exact?.size) return oneLegacyFile(exact, filename);
	const fallback = files.basename.get(normalized.split('/').at(-1));
	return fallback?.size ? oneLegacyFile(fallback, filename) : null;
}

function addLegacyFileMatch(index, key, file) {
	let matches = index.get(key);
	if (!matches) {
		matches = new Set();
		index.set(key, matches);
	}
	matches.add(file);
}

function oneLegacyFile(matches, filename) {
	if (matches.size > 1) {
		throw new LegacyAupError(
			`Multiple selected files match legacy block ${filename}.`,
			'AMBIGUOUS_BLOCK_FILE',
			{ filename, matches: matches.size },
		);
	}
	return matches.values().next().value;
}

function materializePhysicalTrack({ clipPlans, trackIndex, trackNode, trackRate }) {
	const clips = clipPlans.map((plan) => {
		const { clipIndex, clipNode, frameCount } = plan;
		const samples = new Float32Array(frameCount);
		plan.samples = samples;
		const trimLeftSeconds = nonNegative(attribute(clipNode, 'trimleft', 0));
		const trimRightSeconds = nonNegative(attribute(clipNode, 'trimright', 0));
		const sourceStart = Math.min(samples.length - 1, Math.round(trimLeftSeconds * trackRate));
		const sourceEnd = Math.max(sourceStart + 1, samples.length - Math.round(trimRightSeconds * trackRate));
		return {
			name: String(attribute(clipNode, 'name', `Audio ${clipIndex + 1}`)),
			channels: [samples],
			sourceStart,
			sourceEnd: Math.min(samples.length, sourceEnd),
			startSeconds: finite(attribute(clipNode, 'offset', 0)) + trimLeftSeconds,
			trimLeftSeconds,
			trimRightSeconds,
			stretch: 1,
			pitchCents: 0,
			speedRatio: 1,
			groupId: null,
			color: String(attribute(clipNode, 'colorindex', 'auto')),
			envelope: readLegacyAupEnvelope(clipNode, trackRate),
			opaqueExtensions: { legacyAupWaveClip: cloneNode(clipNode) },
		};
	});
	return {
		type: 'audio',
		name: String(attribute(trackNode, 'name', `Track ${trackIndex + 1}`)),
		rate: trackRate,
		channel: Number(attribute(trackNode, 'channel', 2)),
		linked: booleanAttribute(trackNode, 'linked', false),
		gain: finite(attribute(trackNode, 'gain', 1)),
		pan: clamp(finite(attribute(trackNode, 'pan', 0)), -1, 1),
		mute: booleanAttribute(trackNode, 'mute', false),
		solo: booleanAttribute(trackNode, 'solo', false),
		sampleFormat: Number(attribute(trackNode, 'sampleformat', 0x0004000f)),
		displayMode: Number(attribute(trackNode, 'display', 0)) === 1 ? 'spectrogram' : 'waveform',
		clips,
		opaqueExtensions: { legacyAupTrack: cloneNode(trackNode) },
	};
}

function admitLinkedTrackPadding(physicalPlans, budget) {
	for (let index = 0; index < physicalPlans.length; index += 1) {
		const left = physicalPlans[index];
		const right = physicalPlans[index + 1];
		if (!booleanAttribute(left.trackNode, 'linked', false) || !right) continue;
		for (let clipIndex = 0; clipIndex < Math.max(left.clipPlans.length, right.clipPlans.length); clipIndex += 1) {
			const leftClip = left.clipPlans[clipIndex];
			const rightClip = right.clipPlans[clipIndex];
			const first = leftClip || rightClip;
			if (leftClip && rightClip && !legacyClipPlanStartsAlign(
				leftClip, left.trackRate, rightClip, right.trackRate,
			)) {
				throw new LegacyAupError(
					'Legacy linked-track clip timeline offsets do not match.',
					'CORRUPT_LINKED_TRACK',
					{ clipIndex, leftStart: legacyClipPlanStart(leftClip),
						rightStart: legacyClipPlanStart(rightClip) },
				);
			}
			if (leftClip && rightClip && leftClip.frameCount !== rightClip.frameCount) {
				throw new LegacyAupError(
					'Legacy linked-track clip lengths do not match.',
					'CORRUPT_LINKED_TRACK',
					{ clipIndex, leftFrames: leftClip.frameCount, rightFrames: rightClip.frameCount },
				);
			}
			if (!leftClip) budget.admitStereoPadding(first.frameCount);
			if (!rightClip) budget.admitStereoPadding(first.frameCount);
		}
		index += 1;
	}
}

function legacyClipPlanStartsAlign(left, leftRate, right, rightRate) {
	const tolerance = Math.max(1 / leftRate, 1 / rightRate) * 1.5 + 1e-9;
	return Math.abs(legacyClipPlanStart(left) - legacyClipPlanStart(right)) <= tolerance;
}

function legacyClipPlanStart(plan) {
	return finite(attribute(plan.clipNode, 'offset', 0))
		+ nonNegative(attribute(plan.clipNode, 'trimleft', 0));
}

function linkLegacyAupTracks(physical) {
	const output = [];
	for (let index = 0; index < physical.length; index += 1) {
		const left = physical[index];
		const right = physical[index + 1];
		if (left.linked && right) {
			const clips = [];
			for (let clipIndex = 0; clipIndex < Math.max(left.clips.length, right.clips.length); clipIndex += 1) {
				const first = left.clips[clipIndex] || right.clips[clipIndex];
				let leftSamples = left.clips[clipIndex]?.channels[0];
				let rightSamples = right.clips[clipIndex]?.channels[0];
				if (!leftSamples) {
					leftSamples = new Float32Array(first.channels[0].length);
				}
				if (!rightSamples) {
					rightSamples = new Float32Array(first.channels[0].length);
				}
				clips.push({ ...first, channels: [leftSamples, rightSamples] });
			}
			output.push({ ...left, channelCount: 2, channelLayout: 'stereo', clips });
			index += 1;
		} else output.push({ ...left, channelCount: 1, channelLayout: 'mono' });
	}
	return output;
}

function readLegacyAupEnvelope(clip, sampleRate) {
	const envelope = children(clip, 'envelope')[0];
	return envelope ? children(envelope, 'controlpoint').map((point) => ({ frame: Math.max(0, Math.round(nonNegative(attribute(point, 't', 0)) * sampleRate)), value: clamp(finite(attribute(point, 'val', 1)), 0, 16) })) : [];
}

function children(node, name) { const expected = normalizedName(name); return (node?.children || []).filter((child) => normalizedName(child.name) === expected); }
function findDescendant(node, name) { const expected = normalizedName(name); const pending = [node]; while (pending.length) { const entry = pending.pop(); if (normalizedName(entry?.name) === expected) return entry; appendPending(pending, entry?.children); } return null; }
function appendPending(pending, values) { for (let index = (values?.length || 0) - 1; index >= 0; index -= 1) pending.push(values[index]); }
function attribute(node, name, fallback) { const expected = normalizedName(name); for (const [key, value] of Object.entries(node?.attributes || {})) if (normalizedName(key) === expected) return value; return fallback; }
function booleanAttribute(node, name, fallback) { const value = attribute(node, name, fallback); return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'; }
function normalizedName(value) { return String(value || '').trim().toLowerCase(); }
function normalizedPath(value) { return String(value || '').replaceAll('\\', '/').toLowerCase(); }
function cloneNode(node) { return JSON.parse(JSON.stringify(node)); }
function positiveRate(value) { const number = Math.round(Number(value)); if (!Number.isSafeInteger(number) || number <= 0 || number > 768_000) throw new LegacyAupError('Legacy project sample rate is invalid.', 'INVALID_SAMPLE_RATE'); return number; }
function nonNegativeInteger(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new LegacyAupError('Legacy block length is invalid.', 'CORRUPT_BLOCK_FILE'); return number; }
function positiveBlockLength(value) { const number = nonNegativeInteger(value); if (!number) throw new LegacyAupError('Legacy block length is missing or invalid.', 'CORRUPT_BLOCK_FILE'); return number; }
function checkedFrameSum(left, right) { if (right > Number.MAX_SAFE_INTEGER - left) throw new LegacyAupError('Legacy clip length exceeds safe arithmetic.', 'CORRUPT_BLOCK_FILE'); return left + right; }
function isBlockAdmissionError(error) { return /^(?:PROJECT_BLOCK_|PROJECT_PCM_LIMIT|INVALID_BLOCK_FILE_SIZE)/u.test(String(error?.code || '')); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function nonNegative(value) { return Math.max(0, finite(value)); }
function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
