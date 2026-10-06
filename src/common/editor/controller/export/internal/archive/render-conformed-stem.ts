/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;
interface OwnedStemOutput { readonly cleanup?: (() => Awaitable<void>) | null; }

/** Until conformance succeeds, the producer owns every completed encoded spool. */
export async function renderConformedStem<Output extends OwnedStemOutput, Finding>(ports: Readonly<{
	render(): Awaitable<Output>;
	conform(output: Output): Awaitable<readonly Finding[]>;
}>): Promise<{ readonly encoded: Output; readonly conformance: readonly Finding[] }> {
	const encoded = await ports.render();
	try { return { encoded, conformance: await ports.conform(encoded) }; }
	catch (error) {
		try { await encoded.cleanup?.(); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Stem conformance and staging cleanup failed.', { cause: cleanup }); }
		throw error;
	}
}
