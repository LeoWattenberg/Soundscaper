export class LegacyAupError extends Error {
	constructor(message, code = 'LEGACY_AUP_ERROR', details = {}) {
		super(message);
		this.name = 'LegacyAupError';
		this.code = code;
		this.details = details;
	}
}

/**
 * Parse an Audacity 1.x/2.x `.aup` XML project plus user-selected `_data`
 * files into the same structured representation used by AUP3 conversion.
 */
export async function decodeLegacyAupProject(projectFile, dataFiles, options = {}) {
	if (!projectFile || typeof projectFile.text !== 'function') throw new TypeError('A legacy Audacity project file is required.');
	const xml = await projectFile.text();
	const root = parseLegacyXml(xml);
	const project = root.name === 'project' ? root : findDescendant(root, 'project');
	if (!project) throw new LegacyAupError('The AUP file has no project element.', 'INVALID_PROJECT_XML');
	const files = indexLegacyFiles(dataFiles || []);
	const projectRate = positiveRate(attribute(project, 'rate', 44_100));
	const waveTracks = children(project, 'wavetrack');
	const missing = new Set();
	const corrupt = [];
	const physicalTracks = [];
	let completed = 0;
	const totalBlocks = descendants(project, 'simpleblockfile').length;
	for (const [trackIndex, trackNode] of waveTracks.entries()) {
		const trackRate = positiveRate(attribute(trackNode, 'rate', projectRate));
		const clips = [];
		for (const [clipIndex, clipNode] of children(trackNode, 'waveclip').entries()) {
			const sequence = children(clipNode, 'sequence')[0];
			if (!sequence) continue;
			const parts = [];
			for (const waveBlock of children(sequence, 'waveblock')) {
				const silent = children(waveBlock, 'silentblockfile')[0];
				if (silent) {
					const length = nonNegativeInteger(attribute(silent, 'len', attribute(waveBlock, 'len', 0)));
					parts.push(new Float32Array(length));
					continue;
				}
				const block = children(waveBlock, 'simpleblockfile')[0];
				const alias = children(waveBlock, 'pcmaliasblockfile')[0];
				if (alias) throw new LegacyAupError('Legacy projects with aliased external audio require the original media and are not self-contained.', 'UNSUPPORTED_ALIAS_BLOCK', { filename: attribute(alias, 'aliasfile', '') });
				if (!block) continue;
				const filename = String(attribute(block, 'filename', '')).trim();
				const file = findLegacyFile(files, filename);
				if (!file) { missing.add(filename); continue; }
				try {
					const decoded = decodeAuBlockFile(new Uint8Array(await file.arrayBuffer()));
					const declared = nonNegativeInteger(attribute(block, 'len', decoded.length));
					if (declared && decoded.length < declared) throw new LegacyAupError(`${filename} is truncated.`, 'CORRUPT_BLOCK_FILE');
					parts.push(declared ? decoded.subarray(0, declared) : decoded);
				} catch (error) {
					corrupt.push({ filename, code: error.code || 'CORRUPT_BLOCK_FILE', message: error.message });
				}
				completed += 1;
				options.onProgress?.({ progress: totalBlocks ? completed / totalBlocks : 1, phase: 'reading-blocks', filename });
			}
			if (missing.size || corrupt.length) continue;
			const samples = concatenate(parts);
			if (!samples.length) continue;
			const trimLeftSeconds = nonNegative(attribute(clipNode, 'trimleft', 0));
			const trimRightSeconds = nonNegative(attribute(clipNode, 'trimright', 0));
			const sourceStart = Math.min(samples.length - 1, Math.round(trimLeftSeconds * trackRate));
			const sourceEnd = Math.max(sourceStart + 1, samples.length - Math.round(trimRightSeconds * trackRate));
			clips.push({
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
			});
		}
		physicalTracks.push({
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
		});
	}
	if (missing.size) throw new LegacyAupError(`Missing legacy Audacity block files: ${[...missing].join(', ')}.`, 'MISSING_BLOCK_FILES', { filenames: [...missing] });
	if (corrupt.length) throw new LegacyAupError(`Corrupt legacy Audacity block files: ${corrupt.map((entry) => entry.filename).join(', ')}.`, 'CORRUPT_BLOCK_FILES', { files: corrupt });
	const tracks = linkLegacyAupTracks(physicalTracks);
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

export function decodeAuBlockFile(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24) throw new LegacyAupError('Audacity AU block file is truncated.', 'CORRUPT_BLOCK_FILE');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, false) !== 0x2e736e64) throw new LegacyAupError('Audacity block file has no AU header.', 'CORRUPT_BLOCK_FILE');
	const dataOffset = view.getUint32(4, false);
	const declaredBytes = view.getUint32(8, false);
	const encoding = view.getUint32(12, false);
	const channelCount = view.getUint32(20, false);
	if (dataOffset < 24 || dataOffset > bytes.byteLength || channelCount !== 1) throw new LegacyAupError('Audacity AU block header is invalid.', 'CORRUPT_BLOCK_FILE');
	const bytesPerSample = { 3: 2, 4: 3, 5: 4, 6: 4, 7: 8 }[encoding];
	if (!bytesPerSample) throw new LegacyAupError(`Unsupported AU sample encoding: ${encoding}.`, 'UNSUPPORTED_SAMPLE_FORMAT');
	const available = bytes.byteLength - dataOffset;
	const dataBytes = declaredBytes === 0xffff_ffff ? available : declaredBytes;
	if (dataBytes > available || dataBytes % bytesPerSample) throw new LegacyAupError('Audacity AU block sample data is truncated.', 'CORRUPT_BLOCK_FILE');
	const output = new Float32Array(dataBytes / bytesPerSample);
	for (let index = 0, offset = dataOffset; index < output.length; index += 1, offset += bytesPerSample) {
		if (encoding === 3) output[index] = view.getInt16(offset, false) / 32_768;
		else if (encoding === 4) output[index] = signed24(view, offset) / 8_388_608;
		else if (encoding === 5) output[index] = view.getInt32(offset, false) / 2_147_483_648;
		else if (encoding === 6) output[index] = finite(view.getFloat32(offset, false));
		else output[index] = finite(view.getFloat64(offset, false));
	}
	return output;
}

function parseLegacyXml(xml) {
	const synthetic = { name: '#document', attributes: {}, children: [] };
	const stack = [synthetic];
	const tokens = String(xml).match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<[^>]+>/gi) || [];
	for (const token of tokens) {
		if (/^<\/?[!?]/.test(token)) continue;
		if (/^<\//.test(token)) {
			const name = normalizedName(token.slice(2, -1));
			const node = stack.pop();
			if (!node || normalizedName(node.name) !== name) throw new LegacyAupError(`Mismatched legacy AUP XML tag: ${name}.`, 'INVALID_PROJECT_XML');
			continue;
		}
		if (stack.length > 512) throw new LegacyAupError('Legacy AUP XML is nested too deeply.', 'INVALID_PROJECT_XML');
		const selfClosing = /\/\s*>$/.test(token);
		const content = token.slice(1, selfClosing ? token.lastIndexOf('/') : -1).trim();
		const nameMatch = /^([^\s/>]+)/.exec(content);
		if (!nameMatch) continue;
		const node = { name: nameMatch[1], attributes: {}, children: [] };
		const attributeText = content.slice(nameMatch[0].length);
		for (const match of attributeText.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
			node.attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
		}
		stack.at(-1).children.push(node);
		if (!selfClosing) stack.push(node);
	}
	if (stack.length !== 1) throw new LegacyAupError('Legacy AUP XML has unclosed elements.', 'INVALID_PROJECT_XML');
	if (synthetic.children.length !== 1) throw new LegacyAupError('Legacy AUP XML must have one root element.', 'INVALID_PROJECT_XML');
	return synthetic.children[0];
}

function indexLegacyFiles(values) {
	const map = new Map();
	for (const file of values) {
		if (!file || typeof file.arrayBuffer !== 'function') continue;
		for (const key of [file.name, file.webkitRelativePath].filter(Boolean)) map.set(String(key).replaceAll('\\', '/').toLowerCase(), file);
	}
	return map;
}

function findLegacyFile(files, filename) {
	const normalized = filename.replaceAll('\\', '/').toLowerCase();
	if (files.has(normalized)) return files.get(normalized);
	for (const [path, file] of files) if (path.endsWith(`/${normalized}`) || path.split('/').at(-1) === normalized.split('/').at(-1)) return file;
	return null;
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
				const leftSamples = left.clips[clipIndex]?.channels[0] || new Float32Array(first.channels[0].length);
				const rightSamples = right.clips[clipIndex]?.channels[0] || new Float32Array(first.channels[0].length);
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

function concatenate(parts) {
	const length = parts.reduce((sum, part) => sum + part.length, 0);
	const output = new Float32Array(length);
	let offset = 0;
	for (const part of parts) { output.set(part, offset); offset += part.length; }
	return output;
}

function children(node, name) { const expected = normalizedName(name); return (node?.children || []).filter((child) => normalizedName(child.name) === expected); }
function descendants(node, name) { const output = []; const expected = normalizedName(name); const visit = (entry) => { for (const child of entry.children || []) { if (normalizedName(child.name) === expected) output.push(child); visit(child); } }; visit(node); return output; }
function findDescendant(node, name) { return descendants({ children: [node] }, name)[0] || null; }
function attribute(node, name, fallback) { const expected = normalizedName(name); for (const [key, value] of Object.entries(node?.attributes || {})) if (normalizedName(key) === expected) return value; return fallback; }
function booleanAttribute(node, name, fallback) { const value = attribute(node, name, fallback); return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'; }
function normalizedName(value) { return String(value || '').trim().toLowerCase(); }
function decodeEntities(value) { return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function cloneNode(node) { return JSON.parse(JSON.stringify(node)); }
function signed24(view, offset) { const value = view.getUint8(offset) << 16 | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2); return value & 0x800000 ? value - 0x1000000 : value; }
function positiveRate(value) { const number = Math.round(Number(value)); if (!Number.isSafeInteger(number) || number <= 0 || number > 768_000) throw new LegacyAupError('Legacy project sample rate is invalid.', 'INVALID_SAMPLE_RATE'); return number; }
function nonNegativeInteger(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new LegacyAupError('Legacy block length is invalid.', 'CORRUPT_BLOCK_FILE'); return number; }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function nonNegative(value) { return Math.max(0, finite(value)); }
function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
