/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';
import { createFramescaperCaptureSessionService } from
	'../src/common/editor/controller/framescaper-capture-session-service.ts';
import type { CaptureSourceRole } from '../src/common/editor/framescaper-capture-domain.ts';

const SHA = 'ab'.repeat(32);

test('permission inventory, device changes, source settings and preview resources stay lease-owned', async () => {
	const events: string[] = [];
	let cameraSettings: Readonly<Record<string, unknown>> = {
		deviceId: 'camera-a', width: 1_280, height: 720, frameRate: 30,
	};
	const sourcePort = {
		async probe() {
			return { status: 'available' as const, sourceRoles: ['camera', 'microphone'] as const };
		},
		async enumerate({ permissionGranted }: Readonly<{ permissionGranted: boolean }>) {
			events.push(`enumerate:${String(permissionGranted)}`);
			return { devices: [
				{ id: 'camera-a', kind: 'camera' as const, label: 'Front camera' },
				{ id: 'camera-b', kind: 'camera' as const, label: 'Document camera' },
				{ id: 'microphone-a', kind: 'microphone' as const, label: 'Desk microphone' },
			] };
		},
		async openPreview(request: Readonly<{
			roles: readonly CaptureSourceRole[];
			cameraDeviceId?: string;
			microphoneDeviceId?: string;
		}>) {
			events.push(`open:${request.cameraDeviceId ?? 'default'}:${request.microphoneDeviceId ?? 'default'}`);
			cameraSettings = { ...cameraSettings, deviceId: request.cameraDeviceId ?? 'camera-a' };
			return {
				sources: request.roles.map((role) => role === 'camera' ? {
					sourceId: 'camera-track', role,
					stream: { id: `camera-stream-${request.cameraDeviceId ?? 'default'}` },
					track: {
						label: 'Front camera',
						getSettings: () => cameraSettings,
						getCapabilities: () => ({
							width: { min: 640, max: 1_920 }, height: { min: 480, max: 1_080 },
							frameRate: { min: 24, max: 60 },
						}),
						async applyConstraints(constraints: Readonly<Record<string, unknown>>) {
							events.push(`constraints:${JSON.stringify(constraints)}`);
							cameraSettings = {
								...cameraSettings,
								...Object.fromEntries(Object.entries(constraints).map(([key, value]) => [
									key, typeof value === 'object' && value
										? (value as { exact?: unknown }).exact : value,
								])),
							};
						},
					},
					settings: cameraSettings,
					capabilities: {},
				} : {
					sourceId: 'microphone-track', role,
					stream: { id: 'microphone-stream' },
					track: {
						label: 'Desk microphone',
						getSettings: () => ({ deviceId: 'microphone-a', sampleRate: 48_000, channelCount: 1 }),
						getCapabilities: () => ({
							sampleRate: { min: 44_100, max: 96_000 }, channelCount: { min: 1, max: 2 },
						}),
						async applyConstraints() {},
					},
					settings: { deviceId: 'microphone-a', sampleRate: 48_000, channelCount: 1 },
					capabilities: {},
				}),
				async dispose() { events.push('lease:dispose'); },
			};
		},
	};
	const origin = createFramescaperCaptureOriginGuard();
	const service = createFramescaperCaptureSessionService<{ id: string }, unknown>({
		enabled: true,
		embedded: false,
		sourcePort,
		originGuard: origin,
		durable: {
			async prepare(request) { return request; },
			async append(session) { return session; },
			async recordPauseSpan(session) { return session; },
			async seal(session) { return session; },
			async discard() {},
			async findRecovery() { return null; },
		},
		captureOrigin: () => ({
			projectFence: {
				schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
				projectId: 'project-a', baseRevision: 0, baseSha256: SHA,
			},
			origin: { sequenceId: 'sequence-a', playheadMicroseconds: 0, destination: 'both' },
		}),
		createRecorder: () => { throw new Error('not reached'); },
		finalize: () => undefined,
		createPreviewSurface(source) {
			events.push(`surface:create:${source.sourceId}`);
			return {
				url: `blob:preview-${String((source.stream as { id: string }).id)}`,
				stream: source.stream,
				async dispose() { events.push(`surface:dispose:${source.sourceId}`); },
			};
		},
		createLevelMonitor(source) {
			events.push(`meter:create:${source.sourceId}`);
			return {
				get level() { return 0.375; },
				async dispose() { events.push(`meter:dispose:${source.sourceId}`); },
			};
		},
	});

	await service.initialize();
	assert.equal(events.some((event) => event.startsWith('enumerate:')), false);
	await service.actions.requestPreview(['camera', 'microphone']);
	assert.ok(events.indexOf('open:default:default') < events.indexOf('enumerate:true'));
	assert.deepEqual(service.snapshot.devices, [
		{ id: 'camera-a', kind: 'camera', label: 'Front camera' },
		{ id: 'camera-b', kind: 'camera', label: 'Document camera' },
		{ id: 'microphone-a', kind: 'microphone', label: 'Desk microphone' },
	]);
	assert.deepEqual(service.snapshot.selectedDeviceIds, {
		camera: 'camera-a', microphone: 'microphone-a',
	});
	assert.equal(service.snapshot.sources[0]?.previewUrl, 'blob:preview-camera-stream-default');
	assert.deepEqual(service.snapshot.sources[0]?.previewStream, { id: 'camera-stream-default' });
	assert.equal(service.snapshot.sources[1]?.level, 0.375);

	await service.actions.configureSource('camera-track', { width: 1_920, height: 1_080, frameRate: 60 });
	assert.equal(service.snapshot.sources[0]?.settings?.width, 1_920);
	assert.ok(events.some((event) => event.includes('"width":{"exact":1920}')));
	await service.actions.selectDevice('camera', 'camera-b');
	assert.equal(service.snapshot.selectedDeviceIds.camera, 'camera-b');
	assert.ok(events.includes('open:camera-b:microphone-a'));
	assert.equal(events.filter((event) => event === 'surface:dispose:camera-track').length, 1);
	assert.equal(events.filter((event) => event === 'meter:dispose:microphone-track').length, 1);

	await service.actions.release();
	assert.equal(events.filter((event) => event === 'surface:dispose:camera-track').length, 2);
	assert.equal(events.filter((event) => event === 'meter:dispose:microphone-track').length, 2);
	assert.deepEqual(service.snapshot.devices, []);
	assert.deepEqual(service.snapshot.selectedDeviceIds, {});
});
