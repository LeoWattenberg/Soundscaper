/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import {
	FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL,
	registerFramescaperExternalDisplayFramePort,
} from '../desktop/external-display-frame-port.ts';
import {
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneSender,
	type HelperDataPlaneBinding,
} from '../desktop/helper-data-plane.ts';
import type { FramescaperNativeServicesController } from '../desktop/native-services-controller.ts';

test('the renderer transfers one digest-bound evaluated RGBA frame with backpressure', async () => {
	const handlers = new Map<string, (event: unknown, value?: unknown) => void>();
	const presented: unknown[] = [];
	const controller = {
		externalDisplays: () => ({ displays: [], activeDisplayId: 'display-2' }),
		presentExternalDisplay: (frame: unknown) => {
			presented.push(frame);
			return { displays: [], activeDisplayId: 'display-2' };
		},
	} as unknown as FramescaperNativeServicesController;
	const registration = registerFramescaperExternalDisplayFramePort({
		on: (channel, listener) => handlers.set(channel, listener),
		removeListener: (channel) => { handlers.delete(channel); },
		authorizeOwner: () => true,
		controller,
	});
	const bytes = Uint8Array.of(1, 2, 3, 255, 5, 6, 7, 255);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const binding = frameBinding(bytes.byteLength, sha256);
	const sender = new HelperDataPlaneSender(binding);
	const channel = new MessageChannel();
	const response = new Promise<unknown>((resolve, reject) => {
		channel.port2.on('message', (message: unknown) => {
			try {
				const value = message as Readonly<{ type?: unknown }>;
				if (value.type === 'ack') {
					sender.acceptAck(message);
					channel.port2.postMessage(sender.complete());
				} else resolve(message);
			} catch (error) { reject(error); }
		});
	});
	handlers.get(FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL)?.(
		{ ports: [channel.port1] },
		{
			frame: {
				sequence: 4, evaluationFingerprint: 'cd'.repeat(32), width: 2, height: 1,
				dynamicRange: 'sdr', rgbaSha256: sha256,
			},
			binding,
		},
	);
	channel.port2.postMessage(sender.createChunk(bytes));
	assert.deepEqual(await response, {
		dataPlaneVersion: 1, type: 'result', streamId: binding.streamId,
		projection: { displays: [], activeDisplayId: 'display-2' },
	});
	assert.equal(presented.length, 1);
	assert.deepEqual(presented[0], {
		sequence: 4, evaluationFingerprint: 'cd'.repeat(32), width: 2, height: 1,
		dynamicRange: 'sdr', rgbaSha256: sha256, rgba: bytes,
	});
	channel.port2.close();
	registration.dispose();
	assert.equal(handlers.size, 0);
});

test('foreign owners and malformed bindings are refused before frame bytes are consumed', async () => {
	let listener: (event: unknown, value?: unknown) => void = () => {
		throw new Error('frame-port listener was not registered');
	};
	let ownerEvent: unknown = null;
	const controller = {
		externalDisplays: () => ({ displays: [], activeDisplayId: 'display-2' }),
		presentExternalDisplay: () => { throw new Error('must not present'); },
	} as unknown as FramescaperNativeServicesController;
	const registration = registerFramescaperExternalDisplayFramePort({
		on: (_channel, value) => { listener = value; },
		removeListener: () => undefined,
		authorizeOwner: (event) => event === ownerEvent,
		controller,
	});
	const channel = new MessageChannel();
	listener({ ports: [channel.port1] }, {});
	await new Promise((resolve) => channel.port2.once('close', resolve));

	const bytes = Uint8Array.of(0, 0, 0, 255);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const malformed = new MessageChannel();
	const failure = new Promise<unknown>((resolve) => malformed.port2.once('message', resolve));
	ownerEvent = { ports: [malformed.port1] };
	listener(ownerEvent, {
		frame: {
			sequence: 0, evaluationFingerprint: 'ef'.repeat(32), width: 1, height: 1,
			dynamicRange: 'sdr', rgbaSha256: sha256,
		},
		binding: { ...frameBinding(bytes.byteLength, sha256), maximumInFlightChunks: 2 },
	});
	assert.match(String((await failure as { message?: unknown }).message), /binding|backpressure/iu);
	malformed.port2.close();
	registration.dispose();
});

test('a second frame port is rejected until the single 64 MiB transfer slot settles', async () => {
	let listener: (event: unknown, value?: unknown) => void = () => {
		throw new Error('frame-port listener was not registered');
	};
	let presentations = 0;
	const controller = {
		externalDisplays: () => ({ displays: [], activeDisplayId: 'display-2' }),
		presentExternalDisplay: () => { presentations += 1; return { displays: [], activeDisplayId: 'display-2' }; },
	} as unknown as FramescaperNativeServicesController;
	const registration = registerFramescaperExternalDisplayFramePort({
		on: (_channel, value) => { listener = value; },
		removeListener: () => undefined,
		authorizeOwner: () => true,
		controller,
	});
	const byteLength = 64 * 1024 * 1024;
	const sha256 = 'ab'.repeat(32);
	const request = {
		frame: {
			sequence: 1, evaluationFingerprint: 'cd'.repeat(32), width: 4_096, height: 4_096,
			dynamicRange: 'sdr', rgbaSha256: sha256,
		},
		binding: frameBinding(byteLength, sha256),
	};
	const first = new MessageChannel();
	const firstFailure = new Promise<unknown>((resolve) => first.port2.once('message', resolve));
	listener({ ports: [first.port1] }, request);

	const second = new MessageChannel();
	const secondFailure = new Promise<unknown>((resolve) => second.port2.once('message', resolve));
	listener({ ports: [second.port1] }, request);
	const refused = await secondFailure as { type?: unknown; message?: unknown };
	assert.equal(refused.type, 'failure');
	assert.match(String(refused.message), /in-flight|backpressure/iu);
	assert.equal(presentations, 0);

	registration.dispose();
	await firstFailure;
	first.port2.close();
	second.port2.close();
});

function frameBinding(byteLength: number, sha256: string): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		transport: 'message-port',
		streamId: sha256.slice(0, 40),
		direction: 'host-to-helper',
		byteLength,
		sha256,
		maximumChunkBytes: 16 * 1024 * 1024,
		maximumInFlightChunks: 1,
	});
}
