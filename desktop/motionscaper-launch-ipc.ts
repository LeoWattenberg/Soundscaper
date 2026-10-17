/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionscaperDesktopDocumentUrl } from './motionscaper-desktop-contract.ts';
import type { MotionLaunchAuthority } from './motionscaper-launch-authority.ts';

export async function dispatchMotionscaperLaunchCall(launch: MotionLaunchAuthority,
	caller: { readonly ownWindow: boolean; readonly mainFrame: boolean; readonly url: string }, method: unknown, request: unknown): Promise<unknown> {
	if (!caller.ownWindow || !caller.mainFrame || !motionscaperDesktopDocumentUrl(caller.url)) throw new Error('Untrusted Motionscaper launch caller.');
	if (method !== 'take' && method !== 'acknowledge') throw new TypeError('Unknown Motionscaper launch method.');
	if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Motionscaper launch request requires closed fields.');
	const fields = Reflect.ownKeys(request);
	if (method === 'take') {
		if (fields.length) throw new TypeError('Motionscaper launch request has unsupported fields.');
		try { return await launch.take(); }
		catch { throw new Error('The selected Motionscaper launch archive could not be opened. Try File > Open.'); }
	}
	const token = Object.getOwnPropertyDescriptor(request, 'token');
	if (fields.length !== 1 || fields[0] !== 'token' || !token?.enumerable || !Object.hasOwn(token, 'value')
		|| typeof token.value !== 'string' || !/^[a-f\d-]{36}$/u.test(token.value)) throw new TypeError('Motionscaper launch request has invalid fields.');
	return launch.acknowledge({ token: token.value });
}
