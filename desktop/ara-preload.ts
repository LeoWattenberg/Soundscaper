/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ARA_CHANNELS, ARA_CHUNK_FRAMES, admitAraSource, admitAraPcm, araRecord, araInteger, araId,
	type AraBridge,
} from '../src/common/editor/ara-contract.ts'

/** Both product preload bundles expose only opaque sessions and bounded PCM. */
export function createAraPreloadBridge(
	invoke: (channel: string, value: unknown) => Promise<unknown>,
): AraBridge {
	const idRequest = (value: unknown) => {
		const record = araRecord(value, ['sessionId'])
		return Object.freeze({ sessionId: araId(record.sessionId) })
	}
	const boolean = (value: unknown): boolean => {
		if (typeof value !== 'boolean') throw new TypeError('ARA acknowledgement must be boolean.')
		return value
	}
	return Object.freeze({
		start: async (value) => {
			const record = araRecord(value, ['installationId', 'source'])
			const result = araRecord(await invoke(ARA_CHANNELS.start, {
				installationId: araId(record.installationId), source: admitAraSource(record.source),
			}), ['sessionId'])
			return Object.freeze({ sessionId: araId(result.sessionId) })
		},
		write: async (value) => {
			const record = araRecord(value, ['sessionId', 'startFrame', 'channels'])
			const chunk = admitAraPcm({ startFrame: record.startFrame, channels: record.channels })
			return boolean(await invoke(ARA_CHANNELS.write, {
				sessionId: araId(record.sessionId), startFrame: chunk.startFrame,
				channels: chunk.channels.map((channel) => Float32Array.from(channel)),
			}))
		},
		bind: async (value) => boolean(await invoke(ARA_CHANNELS.bind, idRequest(value))),
		openEditor: async (value) => boolean(await invoke(ARA_CHANNELS.editor, idRequest(value))),
		render: async (value) => {
			const record = araRecord(value, ['sessionId', 'startFrame', 'frameCount'])
			const startFrame = araInteger(record.startFrame, 0, 0xffffffff)
			const frameCount = araInteger(record.frameCount, 1, ARA_CHUNK_FRAMES)
			const result = admitAraPcm(await invoke(ARA_CHANNELS.render, {
				sessionId: araId(record.sessionId), startFrame, frameCount,
			}))
			if (result.startFrame !== startFrame || result.channels[0]!.length !== frameCount) {
				throw new TypeError('ARA render geometry changed.')
			}
			return Object.freeze({ startFrame, channels: result.channels.map((channel) => Float32Array.from(channel)) })
		},
		close: async (value) => boolean(await invoke(ARA_CHANNELS.close, idRequest(value))),
	} satisfies AraBridge)
}
