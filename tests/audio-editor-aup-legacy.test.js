import assert from 'node:assert/strict';
import test from 'node:test';

import * as legacyAup from '../src/common/editor/aup-legacy.js';

const { decodeAuBlockFile, decodeLegacyAupProject } = legacyAup;
const EXPECTED_XML_HARD_LIMITS = Object.freeze({
	maximumBytes: 16 * 1024 * 1024,
	maximumElements: 100_000,
	maximumAttributes: 400_000,
	maximumDepth: 128,
});

test('legacy AUP import decodes AU blocks into structured tracks and labels', async () => {
	const block = auFloatBlock([0, 0.5, -0.5, 1], 44_100);
	const xml = `<?xml version="1.0"?>
		<project rate="44100" projname="Legacy.aup" sel0="0" sel1="1">
			<wavetrack name="Voice" channel="2" rate="44100">
				<waveclip offset="1"><sequence numsamples="4"><waveblock start="0"><simpleblockfile filename="e0000.au" len="4"/></waveblock></sequence></waveclip>
			</wavetrack>
			<labeltrack name="Markers"><label t="1" t1="2" title="Chorus"/></labeltrack>
		</project>`;
	const decoded = await decodeLegacyAupProject(
		legacyProjectFile('Legacy.aup', xml),
		[{ name: 'e0000.au', webkitRelativePath: 'Legacy_data/e00/d00/e0000.au', size: block.byteLength, arrayBuffer: async () => block.buffer.slice(0) }],
	);
	assert.equal(decoded.sampleRate, 44_100);
	assert.equal(decoded.tracks.length, 2);
	assert.deepEqual([...decoded.tracks[0].clips[0].channels[0]], [0, 0.5, -0.5, 1]);
	assert.equal(decoded.tracks[1].labels[0].title, 'Chorus');
	assert.equal(decoded.metadata.title, 'Legacy');
});

test('legacy AUP import reports missing and corrupt block files explicitly', async () => {
	const xml = '<project rate="44100"><wavetrack><waveclip><sequence><waveblock><simpleblockfile filename="missing.au" len="4"/></waveblock></sequence></waveclip></wavetrack></project>';
	await assert.rejects(
		decodeLegacyAupProject(legacyProjectFile('broken.aup', xml), []),
		(error) => error.code === 'MISSING_BLOCK_FILES' && error.details.filenames[0] === 'missing.au',
	);
	assert.throws(() => decodeAuBlockFile(new Uint8Array(24)), (error) => error.code === 'CORRUPT_BLOCK_FILE');
});

test('legacy linked channels reject positional clip pairs whose timeline offsets differ', async () => {
	const xml = `<project rate="44100">
		<wavetrack name="Stereo" channel="0" linked="1" rate="44100">
			<waveclip offset="0"><sequence/></waveclip>
			<waveclip offset="10"><sequence><waveblock><silentblockfile len="4"/></waveblock></sequence></waveclip>
		</wavetrack>
		<wavetrack name="Stereo" channel="1" rate="44100">
			<waveclip offset="0"><sequence><waveblock><silentblockfile len="4"/></waveblock></sequence></waveclip>
			<waveclip offset="10"><sequence><waveblock><silentblockfile len="4"/></waveblock></sequence></waveclip>
		</wavetrack>
	</project>`;
	await assert.rejects(
		decodeLegacyAupProject(legacyProjectFile('misaligned.aup', xml), []),
		(error) => error.code === 'CORRUPT_LINKED_TRACK' && /timeline offsets/u.test(error.message),
	);
});

test('legacy AUP XML exposes fixed production hard limits', () => {
	assert.deepEqual(legacyAup.LEGACY_AUP_XML_HARD_LIMITS, EXPECTED_XML_HARD_LIMITS);
	assert.equal(Object.isFrozen(legacyAup.LEGACY_AUP_XML_HARD_LIMITS), true);
});

test('legacy AUP XML accepts the generated Audacity public document type', async () => {
	const xml = `<?xml version="1.0" standalone="no" ?>
		<!DOCTYPE project PUBLIC "-//audacityproject-1.3.0//DTD//EN" "http://audacity.sourceforge.net/xml/audacityproject-1.3.0.dtd">
		<project rate="44100" projname="Compatible.aup"/>`;
	const decoded = await decodeLegacyAupProject(legacyProjectFile('Compatible.aup', xml), []);
	assert.equal(decoded.metadata.title, 'Compatible');
});

test('legacy AUP XML rejects active declarations before reading blocks', async (context) => {
	for (const [name, prefix] of [
		['internal entity subset', '<!DOCTYPE project [<!ENTITY value "active">]>'],
		['processing instruction', '<?audacity run="active"?>'],
	]) {
		await context.test(name, async () => {
			const fixture = trackedLegacyProject(`${prefix}${blockProject()}`);
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, {
					onProgress: (value) => fixture.progress.push(value),
				}),
				(error) => error?.code === 'INVALID_PROJECT_XML',
			);
			assert.deepEqual(fixture.calls, { text: 1, block: 0 });
			assert.deepEqual(fixture.progress, []);
		});
	}
});

test('legacy AUP XML rejects an oversized declaration before reading text or blocks', async () => {
	const fixture = trackedLegacyProject(blockProject(), {
		size: EXPECTED_XML_HARD_LIMITS.maximumBytes + 1,
	});
	await assert.rejects(
		decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, {
			onProgress: (value) => fixture.progress.push(value),
		}),
		(error) => error?.code === 'PROJECT_XML_TOO_LARGE',
	);
	assert.deepEqual(fixture.calls, { text: 0, block: 0 });
	assert.deepEqual(fixture.progress, []);
});

test('legacy AUP XML admits a declaration exactly at the production byte ceiling', async () => {
	const fixture = trackedLegacyProject(blockProject(), {
		size: EXPECTED_XML_HARD_LIMITS.maximumBytes,
	});
	await decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles);
	assert.deepEqual(fixture.calls, { text: 1, block: 1 });
});

test('legacy AUP XML charges actual UTF-8 bytes at exact two-, three-, and four-byte boundaries', async (context) => {
	for (const [name, character] of [
		['two-byte scalar', 'é'],
		['three-byte scalar', '€'],
		['four-byte surrogate pair', '😀'],
	]) {
		await context.test(name, async () => {
			const xml = blockProject('', `projname="${character}"`);
			const actualBytes = utf8Bytes(xml);
			assert.ok(xml.length < actualBytes, 'the fixture distinguishes UTF-16 code units from UTF-8 bytes');

			const admitted = trackedLegacyProject(xml, { size: actualBytes });
			await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
				parseLimits: { maximumBytes: actualBytes },
				onProgress: (value) => admitted.progress.push(value),
			});
			assert.deepEqual(admitted.calls, { text: 1, block: 1 });

			const rejected = trackedLegacyProject(xml, { size: xml.length });
			await assert.rejects(
				decodeLegacyAupProject(rejected.projectFile, rejected.dataFiles, {
					parseLimits: { maximumBytes: actualBytes - 1 },
					onProgress: (value) => rejected.progress.push(value),
				}),
				(error) => error?.code === 'PROJECT_XML_TOO_LARGE',
			);
			assert.deepEqual(rejected.calls, { text: 1, block: 0 });
			assert.deepEqual(rejected.progress, []);
		});
	}
});

test('legacy AUP XML counts an unpaired surrogate as a three-byte replacement', async () => {
	const xml = blockProject('', `projname="${'\ud800'}"`);
	const actualBytes = utf8Bytes(xml);
	const admittedBytes = trackedLegacyProject(xml, { size: xml.length });
	await assert.rejects(
		decodeLegacyAupProject(admittedBytes.projectFile, admittedBytes.dataFiles, {
			parseLimits: { maximumBytes: actualBytes },
		}),
		(error) => error?.code === 'INVALID_PROJECT_XML',
	);
	assert.deepEqual(admittedBytes.calls, { text: 1, block: 0 });

	const rejectedBytes = trackedLegacyProject(xml, { size: xml.length });
	await assert.rejects(
		decodeLegacyAupProject(rejectedBytes.projectFile, rejectedBytes.dataFiles, {
			parseLimits: { maximumBytes: actualBytes - 1 },
		}),
		(error) => error?.code === 'PROJECT_XML_TOO_LARGE',
	);
	assert.deepEqual(rejectedBytes.calls, { text: 1, block: 0 });
});

test('legacy AUP XML enforces the exact element boundary before block work', async () => {
	const maximumElements = 7;
	const admitted = trackedLegacyProject(blockProject('<label/>'));
	await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
		parseLimits: { maximumElements },
		onProgress: (value) => admitted.progress.push(value),
	});
	assert.deepEqual(admitted.calls, { text: 1, block: 1 });

	const rejected = trackedLegacyProject(blockProject('<label/><label/>'));
	await assert.rejects(
		decodeLegacyAupProject(rejected.projectFile, rejected.dataFiles, {
			parseLimits: { maximumElements },
			onProgress: (value) => rejected.progress.push(value),
		}),
		(error) => error?.code === 'PROJECT_XML_NODE_LIMIT',
	);
	assert.deepEqual(rejected.calls, { text: 1, block: 0 });
	assert.deepEqual(rejected.progress, []);
});

test('legacy AUP XML enforces the exact attribute boundary before block work', async () => {
	const maximumAttributes = 4;
	const admitted = trackedLegacyProject(blockProject('', 'one=""'));
	await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
		parseLimits: { maximumAttributes },
		onProgress: (value) => admitted.progress.push(value),
	});
	assert.deepEqual(admitted.calls, { text: 1, block: 1 });

	const rejected = trackedLegacyProject(blockProject('', 'one="" two=""'));
	await assert.rejects(
		decodeLegacyAupProject(rejected.projectFile, rejected.dataFiles, {
			parseLimits: { maximumAttributes },
			onProgress: (value) => rejected.progress.push(value),
		}),
		(error) => error?.code === 'PROJECT_XML_ATTRIBUTE_LIMIT',
	);
	assert.deepEqual(rejected.calls, { text: 1, block: 0 });
	assert.deepEqual(rejected.progress, []);
});

test('legacy AUP XML enforces the exact nesting boundary before block work', async () => {
	const maximumDepth = 6;
	const admitted = trackedLegacyProject(blockProject(nestedElements(5)));
	await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
		parseLimits: { maximumDepth },
		onProgress: (value) => admitted.progress.push(value),
	});
	assert.deepEqual(admitted.calls, { text: 1, block: 1 });

	const rejected = trackedLegacyProject(blockProject(nestedElements(6)));
	await assert.rejects(
		decodeLegacyAupProject(rejected.projectFile, rejected.dataFiles, {
			parseLimits: { maximumDepth },
			onProgress: (value) => rejected.progress.push(value),
		}),
		(error) => error?.code === 'PROJECT_XML_DEPTH_LIMIT',
	);
	assert.deepEqual(rejected.calls, { text: 1, block: 0 });
	assert.deepEqual(rejected.progress, []);
});

test('legacy AUP XML traverses a wide admitted subtree without argument-list expansion', async () => {
	const childCount = 70_000;
	const xml = `<project rate="44100"><container>${'<node/>'.repeat(childCount)}</container></project>`;
	const decoded = await decodeLegacyAupProject(legacyProjectFile('wide.aup', xml), [], {
		parseLimits: { maximumElements: childCount + 2 },
	});
	assert.equal(decoded.sampleRate, 44_100);
	assert.deepEqual(decoded.tracks, []);
});

test('legacy AUP XML parse-limit overrides cannot raise hard limits', async (context) => {
	for (const [name, maximum] of Object.entries(EXPECTED_XML_HARD_LIMITS)) {
		await context.test(name, async () => {
			const fixture = trackedLegacyProject(blockProject());
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, {
					parseLimits: { [name]: maximum + 1 },
					onProgress: (value) => fixture.progress.push(value),
				}),
				(error) => error instanceof RangeError && /hard limit|cannot exceed/iu.test(error.message),
			);
			assert.deepEqual(fixture.calls, { text: 0, block: 0 });
			assert.deepEqual(fixture.progress, []);
		});
	}
});

test('legacy AUP XML rejects malformed test limits before reading text', async (context) => {
	for (const [name, parseLimits] of [
		['zero', { maximumElements: 0 }],
		['fractional', { maximumDepth: 1.5 }],
		['unknown', { maximumTextNodes: 1 }],
		['null', null],
	]) {
		await context.test(name, async () => {
			const fixture = trackedLegacyProject(blockProject());
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, { parseLimits }),
				(error) => error instanceof TypeError || error instanceof RangeError,
			);
			assert.deepEqual(fixture.calls, { text: 0, block: 0 });
		});
	}
});

test('legacy AUP XML rejects invalid declared sizes before reading text', async (context) => {
	for (const size of [-1, 1.5, Number.NaN, undefined]) {
		await context.test(String(size), async () => {
			const fixture = trackedLegacyProject(blockProject());
			fixture.projectFile.size = size;
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles),
				(error) => error instanceof RangeError && /declared size/iu.test(error.message),
			);
			assert.deepEqual(fixture.calls, { text: 0, block: 0 });
		});
	}
});

function blockProject(extraElements = '', extraAttributes = '') {
	return `<project rate="44100" ${extraAttributes}>
		<wavetrack><waveclip><sequence><waveblock><simpleblockfile filename="e0000.au" len="1"/></waveblock></sequence></waveclip></wavetrack>
		${extraElements}
	</project>`;
}

function nestedElements(count) {
	return `${'<node>'.repeat(count)}${'</node>'.repeat(count)}`;
}

function trackedLegacyProject(xml, { size = utf8Bytes(xml) } = {}) {
	const calls = { text: 0, block: 0 };
	const progress = [];
	const block = auFloatBlock([0], 44_100);
	return {
		calls,
		progress,
		projectFile: {
			name: 'bounded.aup',
			size,
			async text() {
				calls.text += 1;
				return xml;
			},
		},
		dataFiles: [{
			name: 'e0000.au',
			size: block.byteLength,
			async arrayBuffer() {
				calls.block += 1;
				return block.buffer.slice(0);
			},
		}],
	};
}

function legacyProjectFile(name, xml) {
	return { name, size: utf8Bytes(xml), text: async () => xml };
}

function utf8Bytes(value) {
	return new TextEncoder().encode(value).byteLength;
}

function auFloatBlock(samples, sampleRate) {
	const bytes = new Uint8Array(24 + samples.length * 4);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x2e736e64, false);
	view.setUint32(4, 24, false);
	view.setUint32(8, samples.length * 4, false);
	view.setUint32(12, 6, false);
	view.setUint32(16, sampleRate, false);
	view.setUint32(20, 1, false);
	for (let index = 0; index < samples.length; index += 1) view.setFloat32(24 + index * 4, samples[index], false);
	return bytes;
}
