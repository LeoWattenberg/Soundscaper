/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';
import { MessageChannel } from 'node:worker_threads';
import { createFramescaperNativeExternalDisplayPort } from '../../desktop/native-services-external-display-port.ts';
import type { FramescaperExternalDisplayFrame } from '../../desktop/external-display-controller.ts';
import { initializeFramescaperNativeServicesDatabase, acquireFramescaperNativeServicesWriterLease } from '../../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../../desktop/native-services-database-v3.ts';
import { FramescaperNativeQueueRepository } from '../../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from '../../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository } from '../../desktop/native-services-watch-repository.ts';
import { FramescaperNativeScratchRepository } from '../../desktop/native-services-scratch-repository.ts';
import { FramescaperNativeServicesLifecycleV3 } from '../../desktop/native-services-lifecycle-v3.ts';
import { FramescaperNativeServicesControllerV3 } from '../../desktop/native-services-controller-v3.ts';
import { registerFramescaperNativeServicesMainIpc, type FramescaperNativeServicesMainIpcOptions } from '../../desktop/native-services-main-ipc.ts';
import { createFramescaperNativeServicesMainPreloadBridge } from '../../desktop/native-services-main-preload.ts';
import { FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL } from '../../desktop/external-display-frame-port.ts';
import { HelperDataPlaneSender, type HelperDataPlaneBinding } from '../../desktop/helper-data-plane.ts';
import { NATIVE_MEDIA_CAPABILITY_IDS, createNativeMediaCapabilitySnapshotV1 } from '../../src/common/editor/native-media-capability-snapshot.ts';

interface PresentedFrame {
	readonly windowId: number;
	readonly sequence: number;
	readonly rgbaSha256: string;
}

/** Actual native IPC/controller/receiver, with bounded in-memory display windows. */
export function createRound7ExternalDisplayNativeFixture() {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'r7-display', instanceId: 'r7-display', processId: 7, nowMs: 1_000,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	const watch = new FramescaperNativeWatchRepository(database);
	const scratch = new FramescaperNativeScratchRepository(database, queue);
	const frames: PresentedFrame[] = [];
	let windowCount = 0;
	const displays = ['Programme A', 'Programme B'].map((label, index) => ({
		displayId: `display-${String(index + 2)}`, label, primary: false,
		width: 640, height: 360, hdrCapable: false, colorManaged: false,
		bounds: { x: (index + 1) * 640, y: 0, width: 640, height: 360 },
	}));
	const externalDisplay = createFramescaperNativeExternalDisplayPort({
		platform: 'linux', linuxSessionType: 'x11', isEnabled: () => true,
		listDisplays: () => displays,
		createWindow: () => {
			const windowId = ++windowCount;
			let destroyed = false;
			return {
				load: async () => undefined, show: () => undefined,
				close: () => { destroyed = true; }, isDestroyed: () => destroyed,
				setBounds: () => undefined,
				send: (_channel, value) => {
					const frame = value as FramescaperExternalDisplayFrame;
					frames.push({ windowId, sequence: frame.sequence, rgbaSha256: frame.rgbaSha256 });
				},
			};
		},
	});
	const lifecycle = new FramescaperNativeServicesLifecycleV3({
		queue, roots, watch, scratch, lease: () => lease, now: () => 1_001,
		watchCoordinator: { refreshHints: () => undefined, reconcileNow: async () => undefined },
		externalDisplay,
	});
	const preferences = {
		nativeMediaEnabled: true, hardwareDecodeEnabled: false,
		hardwareEncodeEnabled: false, ofxConsentEnabled: false,
	};
	const controller = new FramescaperNativeServicesControllerV3({
		queue, roots, watch, lifecycle, lease: () => lease, now: () => 1_001,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true, preferences: () => preferences,
		capabilities: () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true, entries: [{ ...NATIVE_MEDIA_CAPABILITY_IDS.externalDisplay,
				buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true }],
		}),
	});
	const handlers = new Map<string, Parameters<FramescaperNativeServicesMainIpcOptions['handle']>[1]>();
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const registration = registerFramescaperNativeServicesMainIpc({
		handle: (channel: string, handler: Parameters<FramescaperNativeServicesMainIpcOptions['handle']>[1]) => { handlers.set(channel, handler); },
		removeHandler: (channel: string) => { handlers.delete(channel); },
		on: (channel: string, listener: (event: unknown, value?: unknown) => void) => { listeners.set(channel, listener); },
		removeListener: (channel: string) => { listeners.delete(channel); },
		authorizeOwner: () => true, controller,
	});
	let holdNext = false;
	let held: { readonly sequence: number; readonly finish: () => void } | null = null;
	const settlements: { sequence: number; outcome: 'result' | 'failure' }[] = [];
	const bridge = createFramescaperNativeServicesMainPreloadBridge({
		invoke: async (channel: string, request?: unknown): Promise<unknown> => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error(`Missing native IPC channel ${channel}.`);
			return await handler({}, request);
		},
		presentFrame: async (value: unknown): Promise<unknown> => {
			const frame = value as FramescaperExternalDisplayFrame;
			const binding: HelperDataPlaneBinding = {
				dataPlaneVersion: 1, transport: 'message-port', direction: 'host-to-helper',
				streamId: frame.rgbaSha256.slice(0, 40), byteLength: frame.rgba.byteLength,
				sha256: frame.rgbaSha256, maximumChunkBytes: 16 * 1024 * 1024, maximumInFlightChunks: 1,
			};
			const sender = new HelperDataPlaneSender(binding);
			const channel = new MessageChannel();
			const hold = holdNext;
			holdNext = false;
			return await new Promise<unknown>((resolve, reject) => {
				const timeout = setTimeout(() => { channel.port2.close(); reject(new Error('Fixture frame transfer timed out.')); }, 12_000);
				channel.port2.on('message', (message: unknown) => {
					const reply = message as { type: 'ack' | 'result' | 'failure'; projection?: unknown; message?: string };
					if (reply.type === 'ack') {
						sender.acceptAck(message);
						const finish = () => { channel.port2.postMessage(sender.complete()); };
						if (hold) held = { sequence: frame.sequence, finish };
						else finish();
						return;
					}
					clearTimeout(timeout);
					channel.port2.close();
					settlements.push({ sequence: frame.sequence, outcome: reply.type });
					if (reply.type === 'failure') reject(new Error(reply.message));
					else resolve(reply.projection);
				});
				const { rgba: _rgba, ...metadata } = frame;
				listeners.get(FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL)?.({ ports: [channel.port1] }, { frame: metadata, binding });
				channel.port2.postMessage(sender.createChunk(frame.rgba));
			});
		},
	});
	return {
		bridge, controller, frames, settlements,
		arm: () => { holdNext = true; },
		heldSequence: () => held?.sequence ?? null,
		release: () => { const transfer = held; held = null; transfer?.finish(); },
		windowCount: () => windowCount,
		dispose: async () => {
			if (held) { const transfer = held; held = null; transfer.finish(); }
			registration.dispose();
			externalDisplay.dispose();
			await controller.drain();
			database.close();
		},
	};
}
