/* SPDX-License-Identifier: AGPL-3.0-only */

import { streamAup4SourceAudio, type ReadAup4ImportSamples } from './aup4-import-audio.ts';
import type { Aup4ImportSourcePlan } from './aup4-import-plan.ts';

/** One reader per import, advanced only by a matching renderer pull. */
export class Aup4WorkerImportSession {
	private readonly sources: Map<string, Aup4ImportSourcePlan>;
	private active: { sourceId: string; index: number; iterator: AsyncGenerator<Float32Array[]> } | null = null;
	private busy = false;
	private closed = false;

	constructor(sources: readonly Aup4ImportSourcePlan[], private readonly read: ReadAup4ImportSamples) {
		this.sources = new Map(sources.map((source) => [source.sourceId, source]));
	}

	async next(sourceId: string, index: number, check: () => void) {
		if (this.closed || this.busy) throw new Error('The Audacity import reader is unavailable.');
		const source = this.sources.get(sourceId);
		if (!source || (this.active && this.active.sourceId !== sourceId)
			|| index !== (this.active?.index ?? 0)) throw new Error('Out-of-order Audacity audio chunk request.');
		check();
		this.busy = true;
		try {
			// Check each individual request, rather than capturing a completed
			// request's cancellation token in an iterator retained across pulls.
			const active = this.active ??= { sourceId, index: 0, iterator: streamAup4SourceAudio(source, this.read) };
			const next = await active.iterator.next();
			check();
			if (this.closed) throw new Error('The Audacity import reader was closed.');
			active.index += 1;
			if (next.done) { this.sources.delete(sourceId); this.active = null; }
			return { done: Boolean(next.done), channels: next.done ? [] : next.value };
		} finally { this.busy = false; }
	}

	async close(): Promise<void> {
		this.closed = true;
		const active = this.active;
		this.active = null;
		this.sources.clear();
		await active?.iterator.return(undefined);
	}
}
