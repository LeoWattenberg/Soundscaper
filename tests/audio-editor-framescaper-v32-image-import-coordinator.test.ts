/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	importFramescaperTimelineImagesV32,
	type FramescaperTimelineImagePublicationPortV32,
} from '../src/framescaper/editor-image-import-coordinator-v32.ts';
import { applyFramescaperProjectCommandV32 } from '../src/framescaper/editor-project-v32-commands.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('V32 image import publishes successful files independently and sequentially', async () => {
	const project = createFramescaperProjectV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	const commands: unknown[] = [];
	const bodies: Blob[] = [];
	const publisher: FramescaperTimelineImagePublicationPortV32 = {
		async publish(request) {
			commands.push(request.command); bodies.push(request.body);
			return applyFramescaperProjectCommandV32(
				FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, request.project, request.command,
				{ now: '2026-08-25T13:00:00.000Z' },
			);
		},
	};
	let id = 0;
	const result = await importFramescaperTimelineImagesV32({
		project,
		files: [file('one.png'), file('two.png')],
		sequenceStartFrame: 10,
		createId: (prefix) => `${prefix}-${String(++id)}`,
		decode: async ({ bytes }) => decoded(bytes, 5_000_000),
		publisher,
	});
	assert.deepEqual(result.files.map(({ status }) => status), ['imported', 'imported']);
	assert.equal(commands.length, 2);
	assert.equal(bodies.every((body) => body.type === 'application/vnd.framescaper.image-asset'), true);
	const imageClips = result.project.clips.filter(({ kind }) => kind === 'image');
	assert.deepEqual(imageClips.map(({ sequenceStartFrame, sequenceFrameCount }) => (
		[sequenceStartFrame, sequenceFrameCount]
	)), [[10, 50], [60, 50]]);
	assert.equal(Number(result.project.revision), Number(project.revision) + 2);
});

test('decode and publication failures leave no timeline gap and later files continue', async () => {
	const project = createFramescaperProjectV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	let publishAttempt = 0;
	const result = await importFramescaperTimelineImagesV32({
		project,
		files: [file('decode-fail.png'), file('publish-fail.png'), file('good.png')],
		sequenceStartFrame: 10,
		createId: sequenceIds(),
		decode: async ({ bytes, fileName }) => {
			if (fileName === 'decode-fail.png') throw new Error('malformed');
			return decoded(bytes, 1_000_000);
		},
		publisher: {
			async publish(request) {
				publishAttempt += 1;
				if (publishAttempt === 1) throw new Error('quota changed');
				return applyFramescaperProjectCommandV32(
					FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, request.project, request.command,
				);
			},
		},
	});
	assert.deepEqual(result.files.map(({ status }) => status), ['failed', 'failed', 'imported']);
	const imageClip = result.project.clips.find(({ kind }) => kind === 'image');
	assert.equal(imageClip?.sequenceStartFrame, 10);
	assert.equal(imageClip?.sequenceFrameCount, 10);
	assert.equal(result.project.sources.filter(({ kind }) => kind === 'image').length, 1);
});

test('cancellation stops future files without reverting earlier imports', async () => {
	const controller = new AbortController();
	const project = createFramescaperProjectV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	const result = await importFramescaperTimelineImagesV32({
		project,
		files: [file('one.png'), file('two.png')],
		sequenceStartFrame: 10,
		createId: sequenceIds(),
		signal: controller.signal,
		decode: async ({ bytes }) => decoded(bytes, 1_000_000),
		publisher: {
			async publish(request) {
				const updated = applyFramescaperProjectCommandV32(
					FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, request.project, request.command,
				);
				controller.abort(new DOMException('cancelled', 'AbortError'));
				return updated;
			},
		},
	});
	assert.deepEqual(result.files.map(({ status }) => status), ['imported', 'cancelled']);
	assert.equal(result.project.sources.filter(({ kind }) => kind === 'image').length, 1);
});

function file(name: string) {
	const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, name.length);
	return {
		name, type: 'image/png', size: bytes.byteLength,
		async arrayBuffer() { return bytes.slice().buffer; },
	};
}

function decoded(original: Uint8Array, durationTicks: number) {
	return {
		recognizedFormat: 'png' as const,
		canonicalMimeType: 'image/png',
		publication: createFramescaperImageFramePackV1({
			original,
			receipt: { schemaVersion: 1, decoder: 'test' },
			width: 1, height: 1, timingMode: 'fallback',
			frames: [{
				presentationTicks: 0n, durationTicks: BigInt(durationTicks),
				rgba: Uint8Array.of(1, 2, 3, 255),
			}],
		}),
		notices: [] as const,
	};
}

function sequenceIds(): (prefix: string) => string {
	let id = 0;
	return (prefix) => `${prefix}-${String(++id)}`;
}
