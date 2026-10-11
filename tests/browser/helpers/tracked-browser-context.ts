/* SPDX-License-Identifier: AGPL-3.0-only */
interface OwnedContext<Page> {
	newPage(): Promise<Page>;
	close(): Promise<void>;
}
interface ContextCollector<Context> {
	attach(context: Context): void;
	settle(): Promise<void>;
	collect(): Promise<unknown>;
}

/** A separate context owns its recorder, including failure and teardown paths. */
export async function withTrackedBrowserContext<Page, Context extends OwnedContext<Page>, Result>(
	options: {
		createContext(): Promise<Context>;
		createCollector(context: Context): ContextCollector<Context> | null;
		release?(): Promise<void>;
	},
	work: (tracked: { readonly context: Context; newPage(): Promise<Awaited<ReturnType<Context['newPage']>>> }) => Promise<Result>,
): Promise<Result> {
	let owned: Context | undefined;
	let collector: ContextCollector<Context> | null = null;
	const failures: unknown[] = [];
	let result: Result | undefined;
	try {
		const context = await options.createContext(); owned = context;
		collector = options.createCollector(context);
		collector?.attach(context);
		await collector?.settle();
		result = await work({ context, async newPage(): Promise<Awaited<ReturnType<Context['newPage']>>> {
			const page = await context.newPage();
			await collector?.settle();
			return page as Awaited<ReturnType<Context['newPage']>>;
		} });
	} catch (error) { failures.push(error); }
	try { await collector?.collect(); } catch (error) { failures.push(error); }
	try { await owned?.close(); } catch (error) { failures.push(error); }
	try { await options.release?.(); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Browser workflow or coverage cleanup failed.');
	return result as Result;
}
