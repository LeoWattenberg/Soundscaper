/* SPDX-License-Identifier: AGPL-3.0-only */
type Awaitable<Value> = PromiseLike<Value> | Value;
interface OwnedOutput { readonly cleanup?: (() => Awaitable<void>) | null }
interface Cell<Output> { readonly output?: Output; readonly error?: unknown; readonly ok: boolean; cleaned: boolean }

/** One render at a time, one following owned result at most, and archive writes in immutable plan order. */
export async function runOneNextStemPipeline<Entry, Output extends OwnedOutput>(ports: Readonly<{
	entries: readonly Entry[]; signal: AbortSignal; assertCurrent: () => void;
	render(entry: Entry, index: number, signal: AbortSignal): Awaitable<Output>;
	validate(output: Output, entry: Entry, index: number): void;
	consume(output: Output, entry: Entry, index: number, signal: AbortSignal): Promise<void>;
	onComplete?(progress: number, index: number): Awaitable<void>;
}>): Promise<void> {
	const owner = new AbortController(); let failed = false; let primary: unknown;
	const cleanupErrors: unknown[] = [];
	const fail = (error: unknown): void => { if (!failed) { failed = true; primary = error; owner.abort(error); } };
	const retain = (error: unknown): void => { if (!failed) fail(error); else if (error !== primary && !cleanupErrors.includes(error)) cleanupErrors.push(error); };
	const abort = (): void => fail(ports.signal.reason);
	ports.signal.addEventListener('abort', abort, { once: true }); if (ports.signal.aborted) abort();
	const assertCurrent = (): void => { owner.signal.throwIfAborted(); ports.assertCurrent(); };
	async function start(index: number): Promise<Cell<Output>> {
		try { assertCurrent(); return { output: await ports.render(ports.entries[index]!, index, owner.signal), ok: true, cleaned: false }; }
		catch (error) { retain(error); return { error, ok: false, cleaned: false }; }
	}
	async function cleanup(cell: Cell<Output> | null): Promise<void> {
		if (!cell?.ok || cell.cleaned) return; cell.cleaned = true;
		try { await cell.output!.cleanup?.(); } catch (error) { retain(error); }
	}
	let following: Promise<Cell<Output>> | null = null; let current: Cell<Output> | null = null;
	try {
		if (ports.entries.length) following = start(0);
		for (let index = 0; index < ports.entries.length; index++) {
			current = await following!; following = null;
			if (!current.ok) throw current.error;
			assertCurrent(); ports.validate(current.output!, ports.entries[index]!, index);
			// Rendering is complete before its successor starts; only archive I/O overlaps the following render.
			if (index + 1 < ports.entries.length) following = start(index + 1);
			await ports.consume(current.output!, ports.entries[index]!, index, owner.signal);
			await cleanup(current); current = null; assertCurrent();
			await ports.onComplete?.((index + 1) / ports.entries.length, index);
		}
		assertCurrent();
	} catch (error) { retain(error); }
	finally {
		await cleanup(current);
		if (following) await cleanup(await following);
		ports.signal.removeEventListener('abort', abort);
	}
	if (cleanupErrors.length) throw new AggregateError([primary, ...cleanupErrors], 'Stem pipeline and staging cleanup failed.');
	if (failed) throw primary;
}
