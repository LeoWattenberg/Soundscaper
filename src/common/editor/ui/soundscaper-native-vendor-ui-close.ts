/* SPDX-License-Identifier: AGPL-3.0-only */

interface NativePluginVendorUiCloseRequest {
	readonly instanceId: string;
	readonly windowHandleId: string;
}

/** Close both renderer and main ownership without allowing either failure to hide the other. */
export async function closeSoundscaperNativePluginVendorUi(
	request: Readonly<NativePluginVendorUiCloseRequest>,
	closeRuntime: (instanceId: string, windowHandleId: string) => Promise<unknown>,
	closeMain: (request: Readonly<NativePluginVendorUiCloseRequest>) => Promise<boolean>,
): Promise<boolean> {
	let runtimeFailed = false;
	let runtimeFailure: unknown;
	try { await closeRuntime(request.instanceId, request.windowHandleId); }
	catch (error) { runtimeFailed = true; runtimeFailure = error; }
	let closed: boolean;
	try { closed = await closeMain(request); }
	catch (error) {
		if (runtimeFailed) {
			throw new AggregateError(
				[runtimeFailure, error], 'Native plug-in vendor window cleanup failed.', { cause: error },
			);
		}
		throw error;
	}
	if (runtimeFailed) throw runtimeFailure;
	return closed;
}
