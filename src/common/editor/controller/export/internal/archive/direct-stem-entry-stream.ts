/* SPDX-License-Identifier: AGPL-3.0-only */
import { runOneNextStemPipeline } from './one-next-stem-pipeline.ts';
type Awaitable<Value> = PromiseLike<Value> | Value;
interface Output { readonly cleanup?: (() => Awaitable<void>) | null }

/** Preserve the sequential public path; a private admitted renderer may overlap only its following render. */
export async function streamDirectStemEntries<Entry, Encoded extends Output>(ports: Readonly<{
	entries: readonly Entry[]; signal: AbortSignal; assertCurrent: () => void;
	render(entry: Entry, index: number): Awaitable<Encoded>;
	renderOneAhead?: (entry: Entry, index: number, signal: AbortSignal) => Awaitable<Encoded>;
	validate(encoded: Encoded, entry: Entry, index: number): void;
	consume(encoded: Encoded, entry: Entry, index: number, signal: AbortSignal): Promise<void>;
	onComplete?(progress: number, index: number): Awaitable<void>;
}>): Promise<void> {
	if (ports.renderOneAhead) return runOneNextStemPipeline({ ...ports, render: ports.renderOneAhead });
	for (const [index, entry] of ports.entries.entries()) {
		ports.assertCurrent();
		const encoded = await ports.render(entry, index);
		await consumeOwnedStemOutput(encoded, async () => {
			ports.assertCurrent(); ports.validate(encoded, entry, index);
			await ports.consume(encoded, entry, index, ports.signal); ports.assertCurrent();
		});
		await ports.onComplete?.((index + 1) / ports.entries.length, index);
	}
}

async function consumeOwnedStemOutput(encoded: Output, consume: () => Promise<void>): Promise<void> {
	let primary: unknown; let failed = false;
	try { await consume(); } catch (error) { primary = error; failed = true; }
	try { await encoded.cleanup?.(); } catch (cleanup) {
		if (failed) throw new AggregateError([normalizeError(primary), normalizeError(cleanup)], `${normalizeError(primary).message} Direct stem input cleanup also failed.`, { cause: cleanup });
		throw cleanup;
	}
	if (failed) throw primary;
}
function normalizeError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
