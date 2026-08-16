/* SPDX-License-Identifier: AGPL-3.0-only */

import { PLATFORM_TRANSFER_HARD_LIMITS } from './bounded-transfer.ts';

const activeFamilies = Object.freeze([
	'audio-device',
	'audio-effect-host',
	'external-display',
	'media-decode',
	'media-encode',
	'media-probe',
	'media-stream-read',
	'media-stream-write',
	'persistent-render-queue',
	'render-job',
] as const);

const ownerModules = Object.freeze({
	'audio-device': 'src/common/editor/platform/audio-device-port.ts',
	'audio-effect-host': 'src/common/editor/platform/audio-effect-host-port.ts',
	'bounded-transfer': 'src/common/editor/platform/bounded-transfer.ts',
	'external-display': 'src/common/editor/platform/external-display-port.ts',
	'media-codec': 'src/common/editor/platform/media-codec-port.ts',
	'media-stream': 'src/common/editor/platform/media-stream-port.ts',
	'persistent-render-queue': 'src/common/editor/platform/persistent-render-queue-port.ts',
	'render-job': 'src/common/editor/platform/render-job-port.ts',
} as const);

export const DEFERRED_PLATFORM_CONTRACTS = Object.freeze([
	Object.freeze({
		id: 'framescaper-capture',
		milestone: '8A',
		status: 'blocked',
		reason: 'Capture permissions, source combinations, sync, and recovery require the milestone 8A model.',
	}),
	Object.freeze({
		id: 'midi-device',
		milestone: '8B',
		status: 'blocked',
		reason: 'Device ports wait for the pinned Audacity MIDI design.',
	}),
	Object.freeze({
		id: 'midi-event',
		milestone: '8B',
		status: 'blocked',
		reason: 'Event schemas wait for the pinned Audacity MIDI design.',
	}),
] as const);

export const PLATFORM_PORT_CONTRACT = Object.freeze({
	version: 1,
	scope: 'interfaces-and-transfer-validation-only',
	requiresAbortSignal: true,
	activeFamilies,
	ownerModules,
	transferHardLimits: PLATFORM_TRANSFER_HARD_LIMITS,
	implementationBoundary: Object.freeze({
		projectDomainImplementations: 'forbidden',
		reactUiImplementations: 'forbidden',
	}),
});
