/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The pieces of the addon that no host can reach through its JavaScript
 * surface: the realtime ring, which only a running graph drives, the bounds a
 * mapped graph buffer is read through, and what a scan answers on a target this
 * machine is not.
 *
 * Each is exercised by compiling the pinned sources themselves with the host
 * compiler and running a harness against them, so the code under test is the
 * code that ships rather than a transcription of it. Where no compiler exists
 * the suite skips, exactly as the payload-dependent suites do.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	compileHarness,
	compilerIsAvailable,
	runHarness,
	temporaryDirectory,
} from './helpers/native-helper-c-harness.js';

const RING_HARNESS_SOURCE = `
#include "audio_ring.h"

#include <stdio.h>

#define CHANNELS 3u
#define DRAIN_CAPACITY 4096u

int main(void)
{
	soundscaper_sample_ring ring;
	if (!soundscaper_ring_init(&ring, 1u, CHANNELS)) return 1;
	float frame[CHANNELS];
	uint32_t pushed_frames = 0u;
	while (soundscaper_ring_space(&ring) >= CHANNELS) {
		for (uint32_t channel = 0u; channel < CHANNELS; channel += 1u) {
			frame[channel] = (float)(pushed_frames * 10u + channel);
		}
		if (soundscaper_ring_push(&ring, frame, CHANNELS) != CHANNELS) return 2;
		pushed_frames += 1u;
	}
	const uint32_t remaining_space = soundscaper_ring_space(&ring);
	for (uint32_t channel = 0u; channel < CHANNELS; channel += 1u) frame[channel] = -1.0f;
	const uint32_t partial_push = soundscaper_ring_push(&ring, frame, CHANNELS);

	float drained[DRAIN_CAPACITY];
	uint32_t drained_count = 0u;
	while (soundscaper_ring_available(&ring) > 0u && drained_count + CHANNELS <= DRAIN_CAPACITY) {
		const uint32_t moved = soundscaper_ring_pop(&ring, drained + drained_count, CHANNELS);
		if (moved == 0u) break;
		drained_count += moved;
	}
	int aligned = 1;
	for (uint32_t index = 0u; index + CHANNELS <= drained_count; index += CHANNELS) {
		for (uint32_t channel = 0u; channel < CHANNELS; channel += 1u) {
			if (((int)drained[index + channel]) % 10 != (int)channel) aligned = 0;
		}
	}
	soundscaper_ring_release(&ring);

	soundscaper_sample_ring second;
	if (!soundscaper_ring_init(&second, 1u, CHANNELS)) return 3;
	for (uint32_t index = 0u; index < 2u; index += 1u) {
		for (uint32_t channel = 0u; channel < CHANNELS; channel += 1u) frame[channel] = (float)channel;
		soundscaper_ring_push(&second, frame, CHANNELS);
	}
	float taken[4];
	const uint32_t partial_pop = soundscaper_ring_pop(&second, taken, 4u);
	const uint32_t left = soundscaper_ring_available(&second);
	soundscaper_ring_release(&second);

	printf("OBSERVED {\\"remainingSpace\\":%u,\\"partialPush\\":%u,\\"drained\\":%u,\\"aligned\\":%d,\\"partialPop\\":%u,\\"left\\":%u}\\n",
		remaining_space, partial_push, drained_count, aligned, partial_pop, left);
	return 0;
}
`;

const GRAPH_BUFFER_HARNESS_SOURCE = `
#include "audio_ring.h"

#include <stdio.h>

static void report(const char *label, uint32_t maxsize, uint32_t offset, uint32_t size, uint32_t stride)
{
	uint32_t byte_offset = 0xffffffffu;
	const uint32_t frames = soundscaper_graph_buffer_frames(maxsize, offset, size, stride, &byte_offset);
	printf("OBSERVED {\\"case\\":\\"%s\\",\\"frames\\":%u,\\"byteOffset\\":%u}\\n", label, frames, byte_offset);
}

int main(void)
{
	report("whole", 4096u, 0u, 4096u, 8u);
	report("oversize", 4096u, 0u, 1073741824u, 8u);
	report("offset", 4096u, 1024u, 1024u, 8u);
	report("offset-oversize", 4096u, 1024u, 4096u, 8u);
	report("offset-at-end", 4096u, 4096u, 64u, 8u);
	report("offset-past-end", 4096u, 8192u, 64u, 8u);
	report("no-stride", 4096u, 0u, 4096u, 0u);
	return 0;
}
`;

const SCAN_HARNESS_SOURCE = `
#include "plugin_scan.h"

#include <stdio.h>
#include <stdlib.h>

int main(void)
{
	soundscaper_plugin_candidates *candidates = calloc(1u, sizeof(*candidates));
	if (candidates == NULL) return 1;
	const int listed = soundscaper_plugin_list_candidates("C:\\\\plugins", ".vst3", candidates);
	free(candidates);
	soundscaper_plugin_inspection inspection;
	soundscaper_plugin_inspect("C:\\\\plugins\\\\example.vst3", &inspection);
	printf("OBSERVED {\\"listed\\":%d,\\"unreadable\\":%d,\\"status\\":%d,\\"detail\\":\\"%s\\"}\\n",
		listed, (int)SOUNDSCAPER_PLUGIN_INSPECT_UNREADABLE, (int)inspection.status, inspection.detail);
	return 0;
}
`;

const skip = !compilerIsAvailable();

function observations(run) {
	assert.equal(run.status, 0, `the harness must run to completion:\n${run.stdout}\n${run.stderr}`);
	return run.stdout.split(/\r?\n/u)
		.filter((line) => line.startsWith('OBSERVED '))
		.map((line) => JSON.parse(line.slice('OBSERVED '.length)));
}

test('the realtime ring never commits or consumes part of a frame', { skip }, () => {
	const root = temporaryDirectory('native-ring-harness');
	const executable = compileHarness({
		source: RING_HARNESS_SOURCE,
		outputPath: join(root, 'ring'),
		sources: ['audio_ring.c'],
	});
	const [observed] = observations(runHarness(executable));
	assert.equal(observed.remainingSpace, 2,
		'the scenario needs a ring with less than one frame of space left');
	assert.equal(observed.partialPush, 0,
		'a frame that does not fit must not be half written: the rest of the session would be rotated by a channel');
	assert.equal(observed.partialPop, 3,
		'a consumer asking for part of a frame must be given whole frames only');
	assert.equal(observed.left, 3);
	assert.equal(observed.drained % 3, 0);
	assert.equal(observed.aligned, 1, 'every drained frame must still carry its channels in order');
});

test('a graph buffer is read inside its mapping and from where its chunk says', { skip }, () => {
	const root = temporaryDirectory('native-graph-buffer-harness');
	const executable = compileHarness({
		source: GRAPH_BUFFER_HARNESS_SOURCE,
		outputPath: join(root, 'graph-buffer'),
		sources: ['audio_ring.c'],
	});
	const observed = new Map(observations(runHarness(executable)).map((entry) => [entry.case, entry]));
	assert.deepEqual(observed.get('whole'), { case: 'whole', frames: 512, byteOffset: 0 });
	assert.deepEqual(observed.get('oversize'), { case: 'oversize', frames: 512, byteOffset: 0 },
		'a chunk claiming more than the mapping holds must be clamped, not believed');
	assert.deepEqual(observed.get('offset'), { case: 'offset', frames: 128, byteOffset: 1_024 },
		'a chunk with an offset must be read from the offset, not from the buffer origin');
	assert.deepEqual(observed.get('offset-oversize'), { case: 'offset-oversize', frames: 384, byteOffset: 1_024 });
	assert.equal(observed.get('offset-at-end').frames, 0);
	assert.equal(observed.get('offset-past-end').frames, 0);
	assert.equal(observed.get('no-stride').frames, 0);
});

test('a target with no scanning implementation says so rather than blaming the folder', { skip }, () => {
	const root = temporaryDirectory('native-scan-harness');
	const executable = compileHarness({
		source: SCAN_HARNESS_SOURCE,
		outputPath: join(root, 'scan'),
		sources: ['plugin_scan.c'],
		defines: ['SOUNDSCAPER_PLUGIN_HAS_POSIX=0'],
	});
	const [observed] = observations(runHarness(executable));
	assert.notEqual(observed.status, observed.unreadable,
		'"unimplemented on this target" and "this folder could not be read" send a user to different places');
	assert.match(observed.detail, /implement/u);
	assert.equal(observed.listed, -2,
		'listing must report the unimplemented target distinctly from an unreadable root');
});
