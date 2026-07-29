/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeAuBlockFile,
	decodeLegacyAupProject,
	LEGACY_AUP_BLOCK_HARD_LIMITS,
} from '../src/common/editor/aup-legacy.js';

const MIB = 1024 * 1024;
const EXPECTED_HARD_LIMITS = Object.freeze({
	maximumSelectedFiles: 65_536,
	maximumBlockReferences: 65_536,
	maximumBlockFileBytes: 2 * MIB,
	maximumBlockPayloadBytes: MIB,
	maximumBlockFrames: 524_288,
	maximumSelectedBlockBytes: 512 * MIB,
	maximumRetainedPcmBytes: 512 * MIB,
});

test('legacy AUP block admission exposes frozen production ceilings', () => {
	assert.deepEqual(LEGACY_AUP_BLOCK_HARD_LIMITS, EXPECTED_HARD_LIMITS);
	assert.equal(Object.isFrozen(LEGACY_AUP_BLOCK_HARD_LIMITS), true);
});

test('legacy AUP block-limit seams are lower-only and resolve before project text', async (context) => {
	for (const [name, maximum] of Object.entries(EXPECTED_HARD_LIMITS)) {
		await context.test(name, async () => {
			const fixture = trackedProject(simpleProject());
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, {
					blockLimits: { [name]: maximum + 1 },
				}),
				(error: unknown) => error instanceof RangeError && /hard limit|cannot exceed/iu.test(error.message),
			);
			assert.deepEqual(fixture.calls, { text: 0, block: 0 });
		});
	}
	for (const blockLimits of [null, { maximumBlockFrames: 0 }, { maximumBlockFrames: 1.5 }, { unknown: 1 }]) {
		const fixture = trackedProject(simpleProject());
		await assert.rejects(
			decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, { blockLimits }),
			(error: unknown) => error instanceof TypeError || error instanceof RangeError,
		);
		assert.deepEqual(fixture.calls, { text: 0, block: 0 });
	}
});

test('legacy AUP block admission enforces selected-file count before reads', async () => {
	const admitted = trackedProject(simpleProject());
	await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
		blockLimits: { maximumSelectedFiles: 1 },
	});
	assert.deepEqual(admitted.calls, { text: 1, block: 1 });

	const rejected = trackedProject(simpleProject());
	rejected.dataFiles.push(trackedFile('unrelated.wav', auBlock([0])));
	await assert.rejects(
		decodeLegacyAupProject(rejected.projectFile, rejected.dataFiles, {
			blockLimits: { maximumSelectedFiles: 1 },
		}),
		(error: unknown) => limitError(error, 'PROJECT_BLOCK_FILE_COUNT_LIMIT', 'maximumSelectedFiles', 1, 2),
	);
	assert.deepEqual(rejected.calls, { text: 1, block: 0 });
});

test('legacy AUP block files enforce declared and actual byte boundaries', async (context) => {
	const bytes = auBlock([0]);
	const exact = trackedProject(simpleProject(), { bytes });
	await decodeLegacyAupProject(exact.projectFile, exact.dataFiles, {
		blockLimits: { maximumBlockFileBytes: bytes.byteLength },
	});
	assert.equal(exact.calls.block, 1);

	const declaredOver = trackedProject(simpleProject(), { bytes, declaredSize: bytes.byteLength + 1 });
	await assert.rejects(
		decodeLegacyAupProject(declaredOver.projectFile, declaredOver.dataFiles, {
			blockLimits: { maximumBlockFileBytes: bytes.byteLength },
		}),
		(error: unknown) => limitError(
			error, 'PROJECT_BLOCK_FILE_TOO_LARGE', 'maximumBlockFileBytes', bytes.byteLength, bytes.byteLength + 1,
		),
	);
	assert.equal(declaredOver.calls.block, 0);

	for (const actualDelta of [-1, 1]) {
		await context.test(`actual ${actualDelta < 0 ? 'shorter' : 'longer'}`, async () => {
			const actual = new Uint8Array(bytes.byteLength + actualDelta);
			actual.set(bytes.subarray(0, actual.length));
			const mismatch = trackedProject(simpleProject(), { bytes, actualBytes: actual });
			await assert.rejects(
				decodeLegacyAupProject(mismatch.projectFile, mismatch.dataFiles),
				(error: unknown) => errorCode(error, 'PROJECT_BLOCK_SIZE_MISMATCH'),
			);
			assert.equal(mismatch.calls.block, 1);
		});
	}

	let sizeReads = 0;
	const changing = trackedProject(simpleProject(), { bytes });
	Object.defineProperty(changing.dataFiles[0], 'size', {
		get() {
			sizeReads += 1;
			return bytes.byteLength + sizeReads - 1;
		},
	});
	const padded = new Uint8Array(bytes.byteLength + 1);
	padded.set(bytes);
	changing.dataFiles[0].arrayBuffer = async () => padded.buffer;
	await assert.rejects(
		decodeLegacyAupProject(changing.projectFile, changing.dataFiles),
		(error: unknown) => errorCode(error, 'PROJECT_BLOCK_SIZE_MISMATCH'),
	);
	assert.equal(sizeReads, 1, 'authoritative size is snapshotted during admission');
});

test('legacy AUP rejects invalid authoritative block sizes before reads', async (context) => {
	for (const size of [-1, 1.5, Number.NaN, undefined]) {
		await context.test(String(size), async () => {
			const fixture = trackedProject(simpleProject());
			(fixture.dataFiles[0] as { size: unknown }).size = size;
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles),
				(error: unknown) => errorCode(error, 'INVALID_BLOCK_FILE_SIZE'),
			);
			assert.equal(fixture.calls.block, 0);
		});
	}
});

test('legacy AUP rejects a declared block shorter than the AU header before reading it', async () => {
	const truncated = trackedProject(simpleProject(), { bytes: new Uint8Array(23) });
	await assert.rejects(
		decodeLegacyAupProject(truncated.projectFile, truncated.dataFiles),
		(error: unknown) => errorCode(error, 'CORRUPT_BLOCK_FILE'),
	);
	assert.equal(truncated.calls.block, 0);

	const headerOnly = trackedProject(simpleProject(), { bytes: auBlock([]) });
	await assert.rejects(
		decodeLegacyAupProject(headerOnly.projectFile, headerOnly.dataFiles),
		(error: unknown) => errorCode(error, 'CORRUPT_BLOCK_FILES'),
	);
	assert.equal(headerOnly.calls.block, 1);
});

test('legacy AUP charges unique referenced declared bytes once before reads', async () => {
	const first = auBlock([0.25]);
	const second = auBlock([-0.25]);
	const xml = projectWithBlocks([
		'<simpleblockfile filename="first.au" len="1"/>',
		'<simpleblockfile filename="second.au" len="1"/>',
	]);
	const calls = { text: 0, block: 0 };
	const files = [
		trackedFile('first.au', first, calls),
		trackedFile('second.au', second, calls),
	];
	const declaredBytes = first.byteLength + second.byteLength;
	await decodeLegacyAupProject(projectFile(xml, calls), files, {
		blockLimits: { maximumSelectedBlockBytes: declaredBytes },
	});
	assert.equal(calls.block, 2);

	calls.block = 0;
	await assert.rejects(
		decodeLegacyAupProject(projectFile(xml, calls), files, {
			blockLimits: { maximumSelectedBlockBytes: declaredBytes - 1 },
		}),
		(error: unknown) => limitError(
			error, 'PROJECT_BLOCK_BYTES_LIMIT', 'maximumSelectedBlockBytes', declaredBytes - 1, declaredBytes,
		),
	);
	assert.equal(calls.block, 0);

	const repeated = trackedProject(projectWithBlocks([
		'<simpleblockfile filename="e0000.au" len="1"/>',
		'<simpleblockfile filename="e0000.au" len="1"/>',
	]));
	await decodeLegacyAupProject(repeated.projectFile, repeated.dataFiles, {
		blockLimits: { maximumSelectedBlockBytes: repeated.dataFiles[0].size },
	});
	assert.equal(repeated.calls.block, 1);
});

test('legacy AU decoding enforces payload and decoded-frame limits before allocation', () => {
	const oneFloat = auBlock([0.5]);
	assert.deepEqual([...decodeAuBlockFile(oneFloat, {
		maximumBlockPayloadBytes: 4,
		maximumBlockFrames: 1,
	})], [0.5]);
	const twoFloats = auBlock([0.5, -0.5]);
	const twoInt16 = auBlock([0.25, -0.25], { encoding: 3 });
	const allocations = observeFloat32Allocations(() => {
		assert.throws(
			() => decodeAuBlockFile(twoFloats, { maximumBlockPayloadBytes: 4 }),
			(error: unknown) => limitError(error, 'PROJECT_BLOCK_DATA_TOO_LARGE', 'maximumBlockPayloadBytes', 4, 8),
		);
		assert.throws(
			() => decodeAuBlockFile(twoInt16, { maximumBlockFrames: 1 }),
			(error: unknown) => limitError(error, 'PROJECT_BLOCK_FRAME_LIMIT', 'maximumBlockFrames', 1, 2),
		);
	});
	assert.equal(allocations, 0, 'rejected AU payloads never allocate decoded Float32 PCM');
});

test('legacy AU decoding accepts Audacity native-endian sample encodings', async (context) => {
	for (const littleEndian of [false, true]) {
		for (const encoding of [3, 4, 6] as const) await context.test(
			`${littleEndian ? 'little' : 'big'}-endian encoding ${encoding}`,
			() => {
			const bytes = auBlock([0.5, -0.5], {
				dataOffset: 32,
				encoding,
				littleEndian,
				sentinelSize: true,
			});
			assert.deepEqual([...decodeAuBlockFile(bytes)], [0.5, -0.5]);
			},
		);
	}
});

test('legacy AUP counts simple and silent references before any block read', async () => {
	const xml = projectWithBlocks([
		'<simpleblockfile filename="e0000.au" len="1"/>',
		'<silentblockfile len="1"/>',
		'<simpleblockfile filename="e0000.au" len="1"/>',
	]);
	const admitted = trackedProject(xml);
	const result = await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
		blockLimits: { maximumBlockReferences: 3, maximumRetainedPcmBytes: 12 },
	});
	assert.deepEqual([...result.tracks[0].clips[0].channels[0]], [0.25, 0, 0.25]);
	assert.equal(admitted.calls.block, 1);

	const referencesOver = trackedProject(xml);
	await assert.rejects(
		decodeLegacyAupProject(referencesOver.projectFile, referencesOver.dataFiles, {
			blockLimits: { maximumBlockReferences: 2 },
		}),
		(error: unknown) => limitError(error, 'PROJECT_BLOCK_REFERENCE_LIMIT', 'maximumBlockReferences', 2, 3),
	);
	assert.equal(referencesOver.calls.block, 0);

	const pcmOver = trackedProject(xml);
	await assert.rejects(
		decodeLegacyAupProject(pcmOver.projectFile, pcmOver.dataFiles, {
			blockLimits: { maximumRetainedPcmBytes: 11 },
		}),
		(error: unknown) => limitError(error, 'PROJECT_PCM_LIMIT', 'maximumRetainedPcmBytes', 11, 12),
	);
	assert.equal(pcmOver.calls.block, 0);
});

test('legacy AUP enforces simple and silent frame geometry before reads', async (context) => {
	for (const [name, block] of [
		['simple', '<simpleblockfile filename="e0000.au" len="2"/>'],
		['silent', '<silentblockfile len="2"/>'],
	]) {
		await context.test(name, async () => {
			const fixture = trackedProject(projectWithBlocks([block]));
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles, {
					blockLimits: { maximumBlockFrames: 1 },
				}),
				(error: unknown) => limitError(error, 'PROJECT_BLOCK_FRAME_LIMIT', 'maximumBlockFrames', 1, 2),
			);
			assert.equal(fixture.calls.block, 0);
		});
	}
});

test('legacy AUP rejects missing and zero silent-block lengths before reads', async (context) => {
	for (const [name, xml] of [
		['missing', projectWithBlocks(['<silentblockfile/>'])],
		['zero', projectWithBlocks(['<silentblockfile len="0"/>'])],
		[
			'parent-only',
			projectWithBlocks(['<silentblockfile/>']).replace('<waveblock>', '<waveblock len="1">'),
		],
	]) {
		await context.test(name, async () => {
			const fixture = trackedProject(xml);
			await assert.rejects(
				decodeLegacyAupProject(fixture.projectFile, fixture.dataFiles),
				(error: unknown) => errorCode(error, 'CORRUPT_BLOCK_FILE'),
			);
			assert.equal(fixture.calls.block, 0);
		});
	}
});

test('legacy AUP rejects ambiguous exact and basename block-file matches before reads', async (context) => {
	const bytes = auBlock([0.25]);
	for (const [name, filename, paths] of [
		['exact', 'e0000.au', ['e0000.au', 'e0000.au']],
		['basename', 'nested/e0000.au', ['left/e0000.au', 'right/e0000.au']],
	] as const) {
		await context.test(name, async () => {
			const calls = { text: 0, block: 0 };
			const files = paths.map((path, index) => ({
				...trackedFile(name === 'exact' ? path : `selected-${index}.au`, bytes, calls),
				webkitRelativePath: path,
			}));
			await assert.rejects(
				decodeLegacyAupProject(
					projectFile(projectWithBlocks([
						`<simpleblockfile filename="${filename}" len="1"/>`,
					]), calls),
					files,
				),
				(error: unknown) => errorCode(error, 'AMBIGUOUS_BLOCK_FILE'),
			);
			assert.equal(calls.block, 0);
		});
	}
});

test('legacy AUP block lookup work is indexed across repeated references', async () => {
	const selectedFileCount = 24;
	const referenceCount = 24;
	const calls = { text: 0, block: 0 };
	const bytes = auBlock([0.25]);
	const files = Array.from({ length: selectedFileCount }, (_, index) => ({
		...trackedFile(`selected-${index}.au`, bytes, calls),
		webkitRelativePath: `picked/selected-${index}.au`,
	}));
	const xml = projectWithBlocks(Array.from({ length: referenceCount }, () => (
		'<simpleblockfile filename="nested/selected-23.au" len="1"/>'
	)));
	const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'endsWith');
	const originalEndsWith = String.prototype.endsWith;
	let suffixChecks = 0;
	Object.defineProperty(String.prototype, 'endsWith', {
		configurable: true,
		writable: true,
		value(this: string, searchString: string, endPosition?: number) {
			suffixChecks += 1;
			return originalEndsWith.call(this, searchString, endPosition);
		},
	});
	try {
		const result = await decodeLegacyAupProject(projectFile(xml, calls), files);
		assert.equal(result.tracks[0].clips[0].channels[0].length, referenceCount);
	} finally {
		if (originalDescriptor) Object.defineProperty(String.prototype, 'endsWith', originalDescriptor);
	}
	assert.equal(calls.block, 1);
	assert.ok(
		suffixChecks <= selectedFileCount * 4,
		`expected indexed block lookup, observed ${suffixChecks} suffix checks`,
	);
});

test('legacy AUP charges linked-track zero-fill before block reads', async () => {
	const xml = `<project rate="44100">
		<wavetrack linked="1"><waveclip><sequence><waveblock><simpleblockfile filename="e0000.au" len="1"/></waveblock></sequence></waveclip></wavetrack>
		<wavetrack/>
	</project>`;
	const rejected = trackedProject(xml);
	await assert.rejects(
		decodeLegacyAupProject(rejected.projectFile, rejected.dataFiles, {
			blockLimits: { maximumRetainedPcmBytes: 7 },
		}),
		(error: unknown) => limitError(error, 'PROJECT_PCM_LIMIT', 'maximumRetainedPcmBytes', 7, 8),
	);
	assert.equal(rejected.calls.block, 0);

	const admitted = trackedProject(xml);
	const result = await decodeLegacyAupProject(admitted.projectFile, admitted.dataFiles, {
		blockLimits: { maximumRetainedPcmBytes: 8 },
	});
	assert.equal(result.tracks[0].channelCount, 2);
	assert.deepEqual([...result.tracks[0].clips[0].channels[1]], [0]);
});

function simpleProject(): string {
	return projectWithBlocks(['<simpleblockfile filename="e0000.au" len="1"/>']);
}

function projectWithBlocks(blocks: string[]): string {
	return `<project rate="44100"><wavetrack><waveclip><sequence>${blocks.map((block) => (
		`<waveblock>${block}</waveblock>`
	)).join('')}</sequence></waveclip></wavetrack></project>`;
}

function trackedProject(xml: string, options: {
	bytes?: Uint8Array;
	actualBytes?: Uint8Array;
	declaredSize?: number;
} = {}) {
	const calls = { text: 0, block: 0 };
	const bytes = options.bytes || auBlock([0.25]);
	return {
		calls,
		projectFile: projectFile(xml, calls),
		dataFiles: [trackedFile('e0000.au', bytes, calls, options)],
	};
}

function projectFile(xml: string, calls: { text: number }): {
	name: string;
	size: number;
	text(): Promise<string>;
} {
	return {
		name: 'bounded.aup',
		size: new TextEncoder().encode(xml).byteLength,
		async text() {
			calls.text += 1;
			return xml;
		},
	};
}

function trackedFile(
	name: string,
	bytes: Uint8Array,
	calls: { block: number } = { block: 0 },
	options: { actualBytes?: Uint8Array; declaredSize?: number } = {},
) {
	return {
		name,
		size: options.declaredSize ?? bytes.byteLength,
		async arrayBuffer() {
			calls.block += 1;
			const actual = options.actualBytes || bytes;
			return actual.buffer.slice(actual.byteOffset, actual.byteOffset + actual.byteLength) as ArrayBuffer;
		},
	};
}

function auBlock(
	samples: number[],
	options: { dataOffset?: number; encoding?: 3 | 4 | 6; littleEndian?: boolean; sentinelSize?: boolean } = {},
): Uint8Array {
	const encoding = options.encoding || 6;
	const bytesPerSample = encoding === 3 ? 2 : encoding === 4 ? 3 : 4;
	const dataOffset = options.dataOffset || 24;
	const bytes = new Uint8Array(dataOffset + samples.length * bytesPerSample);
	const view = new DataView(bytes.buffer);
	const littleEndian = Boolean(options.littleEndian);
	view.setUint32(0, 0x2e736e64, littleEndian);
	view.setUint32(4, dataOffset, littleEndian);
	view.setUint32(8, options.sentinelSize ? 0xffff_ffff : samples.length * bytesPerSample, littleEndian);
	view.setUint32(12, encoding, littleEndian);
	view.setUint32(16, 44_100, littleEndian);
	view.setUint32(20, 1, littleEndian);
	for (let index = 0; index < samples.length; index += 1) {
		const offset = dataOffset + index * bytesPerSample;
		if (encoding === 3) view.setInt16(offset, Math.round(samples[index] * 32_768), littleEndian);
		else if (encoding === 4) setInt24(view, offset, Math.round(samples[index] * 8_388_608), littleEndian);
		else view.setFloat32(offset, samples[index], littleEndian);
	}
	return bytes;
}

function setInt24(view: DataView, offset: number, signedValue: number, littleEndian: boolean): void {
	const value = signedValue < 0 ? signedValue + 0x1000000 : signedValue;
	const bytes = [value >>> 16 & 0xff, value >>> 8 & 0xff, value & 0xff];
	if (littleEndian) bytes.reverse();
	for (const [index, byte] of bytes.entries()) view.setUint8(offset + index, byte);
}

function observeFloat32Allocations(callback: () => void): number {
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Float32Array');
	const OriginalFloat32Array = globalThis.Float32Array;
	let allocations = 0;
	const ObservedFloat32Array = new Proxy(OriginalFloat32Array, {
		construct(target, argumentsList, newTarget) {
			allocations += 1;
			return Reflect.construct(target, argumentsList, newTarget);
		},
	});
	Object.defineProperty(globalThis, 'Float32Array', {
		configurable: true,
		writable: true,
		value: ObservedFloat32Array,
	});
	try {
		callback();
	} finally {
		if (originalDescriptor) Object.defineProperty(globalThis, 'Float32Array', originalDescriptor);
	}
	return allocations;
}

function errorCode(error: unknown, code: string): boolean {
	return (error as { code?: string })?.code === code;
}

function limitError(error: unknown, code: string, limit: string, maximum: number, observed: number): boolean {
	const value = error as { code?: string; details?: Record<string, unknown> };
	return value?.code === code
		&& value.details?.limit === limit
		&& value.details?.maximum === maximum
		&& value.details?.observed === observed;
}
