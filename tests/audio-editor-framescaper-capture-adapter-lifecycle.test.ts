/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';
import { createFramescaperCaptureSessionService } from '../src/common/editor/controller/framescaper-capture-session-service.ts';

const SHA = 'ab'.repeat(32);

test('adapter identities remain durable and shutdown seals recovery without disposing actions', async () => {
	let preparedSourceId = '';
	let sealCount = 0;
	let grantCount = 0;
	const service = createFramescaperCaptureSessionService({
		enabled: true,
		embedded: false,
		sourcePort: {
			async probe() { return { status: 'available' as const, sourceRoles: ['display' as const] }; },
			async enumerate() { return { devices: [] }; },
			async openPreview() {
				return {
					sources: [{
						sourceId: 'guest-display', role: 'display' as const,
						stream: {}, track: {}, settings: {}, capabilities: {},
					}],
					async dispose() {},
				};
			},
		},
		originGuard: createFramescaperCaptureOriginGuard(),
		displaySelection: {
			mode: 'owned-source',
			authorize() { grantCount += 1; },
		},
		durable: {
			async prepare(request) { preparedSourceId = request.sources[0]?.sourceId ?? ''; return request; },
			async append(session) { return session; },
			async recordPauseSpan(session) { return session; },
			async seal(session) { sealCount += 1; return session; },
			async discard() {},
			async findRecovery() { return null; },
		},
		captureOrigin: () => ({
			projectFence: { projectId: 'project-a', baseRevision: 1, baseSha256: SHA },
			origin: { sequenceId: 'sequence-a', playheadMicroseconds: 0, destination: 'both' },
		}),
		createSourceIdentity: (source) => `web-vcr:${source.sourceId}`,
		createRecorder: () => ({
			format: { kind: 'encoded-media', mimeType: 'video/webm' },
			start() {}, pause: () => true, resume: () => true, stop() {}, dispose() {},
		}),
		finalize: () => undefined,
		createId: (prefix) => `${prefix}-id`,
	});

	await service.initialize();
	await service.actions.requestPreview(['display']);
	service.actions.arm({ destination: 'both', countdownMs: 0 });
	await service.actions.start();
	assert.equal(preparedSourceId, 'web-vcr:guest-display');
	assert.equal(grantCount, 1);

	await service.actions.sealForShutdown();
	assert.equal(service.snapshot.phase, 'recovery');
	assert.equal(sealCount, 1);
	await service.actions.discard();
	assert.equal(service.snapshot.phase, 'inactive');
});
