/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundPanelSession } from '../src/common/editor/ui/workspace/freesound-panel-session.ts';

for (const origin of ['initial', 'connect'] as const) {
for (const changeAccount of [false, true]) {
for (const expired of changeAccount ? [false, true] : [false]) test(`${origin} pending upload ${expired ? 'expiry' : 'restoration'} ${changeAccount ? 'cannot cross an ordinary sign-out and reconnection' : 'completes for its original account'}`, async () => {
	let releaseFirst!: (response: Response) => void;
	let firstRequested!: () => void;
	const pendingRequest = new Promise<void>(resolve => { firstRequested = resolve; });
	let requests = 0;
	let attempts = 0;
	const client = createFreesoundApiClient({
		openAuthorization: () => undefined,
		request: async (path, init) => {
			if (path.endsWith('/oauth/session')) return init?.method === 'DELETE'
				? new Response(null, { status: 204 }) : Response.json({ data: { connected: origin === 'initial', user: { username: 'original-account' } } });
			if (path.endsWith('/oauth/start')) { attempts += 1; return Response.json({ data: {
				attemptId: 'new-account', handoffToken: 'new-account-handoff',
				authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary-client&response_type=code&state=new-account&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			} }); }
			if (path.endsWith('/oauth/poll')) return Response.json({ data: { connected: true, user: {
				username: origin === 'connect' && attempts === 1 ? 'original-account' : 'new-account',
			} } });
			if (path.endsWith('/uploads/pending') && ++requests === 1) {
				firstRequested();
				return new Promise<Response>(resolve => { releaseFirst = resolve; });
			}
			return pendingResponse('new-account-take.wav');
		},
	});
	const session = createFreesoundPanelSession(client);
	let initialization = session.initialize();
	if (origin === 'connect') { await initialization; initialization = session.connect(); }
	await pendingRequest;
	assert.equal(session.getSnapshot().auth.user?.username, 'original-account');
	const delayed = expired ? Response.json({ error: { code: 'not_authenticated', message: 'Old account expired.' } }, { status: 401 })
		: pendingResponse('original-account-take.wav');
	if (changeAccount) {
		await session.disconnect();
		const reconnection = session.connect();
		// A cancelled OAuth continuation must not hold the replacement account
		// behind its old slow list request or clear the replacement's owner.
		if (origin === 'connect') releaseFirst(delayed);
		await reconnection;
		assert.equal(session.getSnapshot().auth.user?.username, 'new-account');
		assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.fileName), ['new-account-take.wav']);
	}
	releaseFirst(delayed);
	await initialization;
	assert.equal(session.getSnapshot().auth.user?.username, changeAccount ? 'new-account' : 'original-account');
	assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.fileName), [
		changeAccount ? 'new-account-take.wav' : 'original-account-take.wav',
	]);
});
}
}

function pendingResponse(fileName: string): Response {
	return Response.json({ data: { pendingDescription: [fileName], pendingProcessing: [], pendingModeration: [] } });
}
