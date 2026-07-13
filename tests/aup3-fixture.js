import initSqlJs from 'sql.js';

const FIELD = Object.freeze({
	CHAR_SIZE: 0,
	START_TAG: 1,
	END_TAG: 2,
	STRING: 3,
	INT: 4,
	BOOL: 5,
	DOUBLE: 10,
	DATA: 11,
	RAW: 12,
	NAME: 15,
});

export const AUP3_SAMPLE_FORMAT = Object.freeze({
	INT16: 0x00020001,
	INT24: 0x00040001,
	FLOAT32: 0x0004000f,
});

let sqlPromise;

export async function createAup3Fixture(options = {}) {
	const SQL = options.SQL || await loadSqlJs();
	const { dictionary, document, sampleBlocks } = createAup3ProjectData(options);
	const database = new SQL.Database();
	try {
		database.run('PRAGMA application_id = 0x41554459');
		database.run('CREATE TABLE project (id INTEGER PRIMARY KEY, dict BLOB, doc BLOB)');
		database.run('CREATE TABLE autosave (id INTEGER PRIMARY KEY, dict BLOB, doc BLOB)');
		database.run(`CREATE TABLE sampleblocks (
			blockid INTEGER PRIMARY KEY,
			sampleformat INTEGER,
			summin BLOB,
			summax BLOB,
			sumrms BLOB,
			summary256 BLOB,
			summary64k BLOB,
			samples BLOB
		)`);
		database.run('INSERT INTO project (id, dict, doc) VALUES (1, ?, ?)', [dictionary, document]);
		if (options.autosave) {
			database.run('INSERT INTO autosave (id, dict, doc) VALUES (1, ?, ?)', [dictionary, document]);
		}
		for (const block of sampleBlocks) {
			if (block.missing || block.id <= 0) continue;
			database.run('INSERT INTO sampleblocks (blockid, sampleformat, samples) VALUES (?, ?, ?)', [
				block.id,
				block.sampleFormat,
				encodeSamples(block.samples, block.sampleFormat),
			]);
		}
		return database.export();
	} finally {
		database.close();
	}
}

export function createAup3ProjectData(options = {}) {
	const projectRate = options.sampleRate || 48000;
	const tracks = options.tracks || [{
		name: 'Fixture track',
		channel: 0,
		clips: [{ samples: [0.25, -0.5, 0.75, 0] }],
	}];
	const sampleBlocks = [];
	let nextBlockId = 1;
	const trackNodes = tracks.map((track, trackIndex) => {
		const rate = track.rate || projectRate;
		const clips = track.clips || (track.samples ? [{ samples: track.samples }] : []);
		const clipNodes = clips.map((clip) => {
			const format = clip.sampleFormat || track.sampleFormat || AUP3_SAMPLE_FORMAT.FLOAT32;
			const configuredBlocks = clip.blocks || [{
				id: clip.blockId,
				samples: clip.samples || [],
				start: clip.blockStart,
				missing: clip.missingBlock,
			}];
			let cumulative = 0;
			const blockNodes = configuredBlocks.map((configured) => {
				const id = Number.isInteger(configured.id) ? configured.id : nextBlockId++;
				const samples = Array.from(configured.samples || []);
				const length = id <= 0 ? -id : samples.length;
				const node = xmlNode('waveblock', {
					start: configured.start ?? cumulative,
					blockid: id,
				});
				if (id > 0) sampleBlocks.push({
					id,
					sampleFormat: configured.sampleFormat || format,
					samples,
					missing: configured.missing,
				});
				cumulative += length;
				return node;
			});
			const sequence = xmlNode('sequence', {
				maxsamples: Math.max(cumulative, 1),
				sampleformat: format,
				numsamples: clip.declaredSamples ?? cumulative,
			}, blockNodes);
			const children = [sequence];
			if (clip.envelope) {
				children.push(xmlNode('envelope', { numpoints: 1 }, [xmlNode('controlpoint', { t: 0, val: 0.5 })]));
			}
			if (clip.cutline) {
				children.push(xmlNode('waveclip', { offset: 0 }, [
					xmlNode('sequence', { sampleformat: format, numsamples: 1 }, [xmlNode('waveblock', { start: 0, blockid: -1 })]),
				]));
			}
			return xmlNode('waveclip', {
				offset: clip.offset || 0,
				trimLeft: clip.trimLeft || 0,
				trimRight: clip.trimRight || 0,
				...(clip.stretchRatio == null ? {} : { clipStretchRatio: clip.stretchRatio }),
				...(clip.rawAudioTempo == null ? {} : { rawAudioTempo: clip.rawAudioTempo }),
				...(clip.centShift == null ? {} : { centShift: clip.centShift }),
			}, children);
		});
		return xmlNode('wavetrack', {
			name: track.name || `Track ${trackIndex + 1}`,
			channel: track.channel ?? 0,
			linked: track.linked || false,
			mute: track.mute || false,
			solo: track.solo || false,
			gain: track.gain ?? 1,
			pan: track.pan || 0,
			rate,
		}, clipNodes);
	});
	if (options.realtimeEffect) trackNodes.push(xmlNode('effects', { active: true }, [xmlNode('effectstate', { name: 'Fixture effect' })]));
	const project = xmlNode('project', {
		rate: projectRate,
		projname: options.projectName || 'fixture.aup3',
		...(options.projectTempo == null ? {} : { time_signature_tempo: options.projectTempo }),
	}, trackNodes);
	const { dictionary, document } = serializeAup3Xml(project);
	return { dictionary, document, sampleBlocks, project };
}

export function serializeAup3Xml(root) {
	const names = new Map();
	collectNames(root, names);
	let identifier = 1;
	for (const name of names.keys()) names.set(name, identifier++);

	const dictionary = new ByteWriter();
	dictionary.u8(FIELD.CHAR_SIZE).u8(1);
	for (const [name, id] of names) {
		const bytes = utf8(name);
		dictionary.u8(FIELD.NAME).u16(id).u16(bytes.length).bytes(bytes);
	}

	const document = new ByteWriter();
	for (const raw of ['<?xml version="1.0" standalone="no" ?>\n', '<!DOCTYPE project PUBLIC "-//audacityproject-1.3.0//DTD//EN" "http://audacityteam.org/xml/audacityproject-1.3.0.dtd">\n']) {
		const bytes = utf8(raw);
		document.u8(FIELD.RAW).i32(bytes.length).bytes(bytes);
	}
	writeNode(document, root, names);
	return { dictionary: dictionary.finish(), document: document.finish() };
}

function writeNode(writer, node, names) {
	const tagId = names.get(node.name);
	writer.u8(FIELD.START_TAG).u16(tagId);
	for (const [name, value] of Object.entries(node.attributes || {})) {
		const nameId = names.get(name);
		if (typeof value === 'boolean') writer.u8(FIELD.BOOL).u16(nameId).u8(value ? 1 : 0);
		else if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) {
			writer.u8(FIELD.INT).u16(nameId).i32(value);
		} else if (typeof value === 'number') {
			writer.u8(FIELD.DOUBLE).u16(nameId).f64(value).i32(17);
		} else {
			const bytes = utf8(value);
			writer.u8(FIELD.STRING).u16(nameId).i32(bytes.length).bytes(bytes);
		}
	}
	if (node.data) {
		const bytes = utf8(node.data);
		writer.u8(FIELD.DATA).i32(bytes.length).bytes(bytes);
	}
	for (const child of node.children || []) writeNode(writer, child, names);
	writer.u8(FIELD.END_TAG).u16(tagId);
}

function collectNames(node, names) {
	names.set(node.name, 0);
	for (const name of Object.keys(node.attributes || {})) names.set(name, 0);
	for (const child of node.children || []) collectNames(child, names);
}

function xmlNode(name, attributes = {}, children = [], data = '') {
	return { name, attributes, children, data };
}

function encodeSamples(samples, format) {
	const values = Array.from(samples || []);
	const bytesPerSample = format >>> 16;
	const bytes = new Uint8Array(values.length * bytesPerSample);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < values.length; index += 1) {
		const sample = Number(values[index]) || 0;
		const offset = index * bytesPerSample;
		if (format === AUP3_SAMPLE_FORMAT.INT16) {
			view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(sample * 32768))), true);
		} else if (format === AUP3_SAMPLE_FORMAT.INT24) {
			view.setInt32(offset, Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388608))), true);
		} else if (format === AUP3_SAMPLE_FORMAT.FLOAT32) {
			view.setFloat32(offset, sample, true);
		} else {
			throw new Error(`Unsupported fixture sample format: ${format}.`);
		}
	}
	return bytes;
}

async function loadSqlJs() {
	if (!sqlPromise) sqlPromise = initSqlJs();
	return sqlPromise;
}

function utf8(value) {
	return new TextEncoder().encode(String(value));
}

class ByteWriter {
	constructor() { this.values = []; }
	u8(value) { this.values.push(value & 0xff); return this; }
	u16(value) { this.values.push(value & 0xff, value >>> 8 & 0xff); return this; }
	i32(value) {
		const buffer = new ArrayBuffer(4);
		new DataView(buffer).setInt32(0, value, true);
		return this.bytes(new Uint8Array(buffer));
	}
	f64(value) {
		const buffer = new ArrayBuffer(8);
		new DataView(buffer).setFloat64(0, value, true);
		return this.bytes(new Uint8Array(buffer));
	}
	bytes(values) { this.values.push(...values); return this; }
	finish() { return Uint8Array.from(this.values); }
}
