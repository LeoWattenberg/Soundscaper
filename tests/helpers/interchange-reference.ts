/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Read our interchange output with someone else's implementation.
 *
 * The point of these helpers is that nothing in the assertion path is ours. Our
 * exporters write the bytes; the OpenTimelineIO reference implementation and its
 * format adapters read them; this module only shuttles between the two and
 * normalizes what comes back into plain data.
 *
 * If the reference implementation is not provisioned, these helpers throw with
 * the command to run rather than skipping. A conformance suite that quietly
 * turns itself off is worse than no conformance suite, because it reports
 * success either way.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const REFERENCE_ROOT = resolve(REPO_ROOT, 'vendor/interchange-conformance');

export type ReferenceAdapter = 'cmx_3600' | 'fcpx_xml' | 'otio_json';

export interface ReferenceItem {
	readonly schema: string;
	readonly name: string;
	/** Whole frames (or samples) in the item's own timebase, as the reader resolved them. */
	readonly startValue: number;
	readonly startRate: number;
	readonly durationValue: number;
	readonly durationRate: number;
}

export interface ReferenceTrack {
	readonly name: string;
	readonly kind: string;
	readonly items: readonly ReferenceItem[];
}

export interface ReferenceTimeline {
	readonly name: string;
	readonly globalStartValue: number | null;
	readonly globalStartRate: number | null;
	readonly tracks: readonly ReferenceTrack[];
}

const READER = `
import json, sys
import opentimelineio as otio

path, adapter = sys.argv[1], sys.argv[2]
options = json.loads(sys.argv[3])
read = otio.adapters.read_from_file(path, adapter, **options)

def item(entry):
    source_range = entry.source_range
    return {
        "schema": type(entry).__name__,
        "name": getattr(entry, "name", "") or "",
        "startValue": source_range.start_time.value,
        "startRate": source_range.start_time.rate,
        "durationValue": source_range.duration.value,
        "durationRate": source_range.duration.rate,
    }

def timeline(entry):
    start = getattr(entry, "global_start_time", None)
    return {
        "name": entry.name or "",
        "globalStartValue": start.value if start is not None else None,
        "globalStartRate": start.rate if start is not None else None,
        "tracks": [
            {"name": track.name or "", "kind": str(track.kind), "items": [item(child) for child in track]}
            for track in entry.tracks
        ],
    }

# An adapter may hand back a single timeline or a collection of them; both are
# legitimate, so normalize rather than assuming one shape.
timelines = [timeline(read)] if isinstance(read, otio.schema.Timeline) else [
    timeline(entry) for entry in read if isinstance(entry, otio.schema.Timeline)
]
print(json.dumps(timelines))
`;

let provisionChecked = false;

function ensureProvisioned(): void {
	if (provisionChecked) return;
	try {
		execFileSync(pythonExecutable(), ['-c', 'import opentimelineio'], {
			stdio: 'ignore',
			env: { ...process.env, PYTHONPATH: REFERENCE_ROOT },
		});
	} catch {
		throw new Error(
			'The interchange reference implementation is not provisioned.\n'
			+ '  Run: node scripts/provision-interchange-conformance.mjs\n'
			+ 'This suite proves our exporters against a reader that is not ours, so it refuses '
			+ 'to pass without one rather than skipping.',
		);
	}
	provisionChecked = true;
}

function pythonExecutable(): string {
	return process.env.SOUNDSCAPER_PYTHON || 'python3';
}

/** Hand `text` to the reference reader and get back what it made of it. */
export function readWithReference(
	text: string,
	adapter: ReferenceAdapter,
	options: Readonly<Record<string, unknown>> = {},
	extension = '.tmp',
): readonly ReferenceTimeline[] {
	ensureProvisioned();
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-interchange-'));
	const file = join(directory, `subject${extension}`);
	try {
		writeFileSync(file, text);
		const stdout = execFileSync(
			pythonExecutable(),
			['-c', READER, file, adapter, JSON.stringify(options)],
			{ encoding: 'utf8', env: { ...process.env, PYTHONPATH: REFERENCE_ROOT }, stdio: ['ignore', 'pipe', 'pipe'] },
		);
		return Object.freeze(JSON.parse(stdout) as ReferenceTimeline[]);
	} catch (error) {
		const detail = (error as { stderr?: Buffer | string }).stderr;
		const message = typeof detail === 'string' ? detail : detail?.toString('utf8');
		throw new Error(`The ${adapter} reference reader rejected our output:\n${message || String(error)}`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/** Every item across every track, which is what most boundary assertions want. */
export function referenceItems(timelines: readonly ReferenceTimeline[]): readonly ReferenceItem[] {
	return timelines.flatMap((timeline) => timeline.tracks.flatMap((track) => track.items));
}
