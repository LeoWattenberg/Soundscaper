/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectPathPdcPlanV21 } from './project-path-pdc-plan-v21.ts'
import type { EngineRuntimeMethodMap, EngineRuntimeHost } from './runtime-types.ts'

export interface EngineNativeEffectPdcRevision {
	readonly atFrame: number
	readonly blockFrames: number
	readonly pdcErrorSamples: number
	readonly plan: ProjectPathPdcPlanV21
}

export interface EngineNativeEffectPdcCommit {
	readonly status: 'scheduled' | 'not-playing'
	readonly atFrame: number
	readonly contextTime: number | null
	readonly publicationDelayMs: number
	readonly updatedPaths: number
}

/** Schedule every mutable V21 compensation delay in one Web Audio quantum. */
export const engineNativeEffectPdcControlMethods = {
	commitNativeEffectPdcRevision(
		this: EngineRuntimeHost,
		request: EngineNativeEffectPdcRevision,
	): EngineNativeEffectPdcCommit {
		const atFrame = integer(request?.atFrame, 0, Number.MAX_SAFE_INTEGER, 'PDC frame')
		const blockFrames = integer(request?.blockFrames, 1, 65_536, 'PDC block size')
		if (atFrame % blockFrames !== 0) throw new RangeError('A PDC revision must target a block boundary.')
		if (request?.pdcErrorSamples !== 0) throw new Error('A non-exact PDC revision cannot reach the audio graph.')
		const delays = this.graph?.pathPdcDelayParamsV21
		const context = this.context
		if (this.state !== 'playing' || !delays || !context) {
			return Object.freeze({
				status: 'not-playing', atFrame, contextTime: null, publicationDelayMs: 0, updatedPaths: 0,
			})
		}
		const currentFrame = this.getPositionFrames()
		if (atFrame <= currentFrame) throw new RangeError('A live PDC revision must be scheduled ahead of playback.')
		const contextTime = context.currentTime
			+ (atFrame - currentFrame) / (this.sampleRate * this.playbackRate)
		// Resolve the whole revision before any of it is scheduled: a delay that
		// cannot carry its share must fault the swap outright rather than leave
		// the graph half on the old plan and half on the new one.
		const revisions: { readonly param: AudioParam; readonly seconds: number }[] = []
		for (const [key, param] of delays) {
			const frames = compensationFrames(request.plan, key)
			if (!Number.isSafeInteger(frames) || frames < 0) {
				throw new Error(`PDC plan omitted runtime path ${key}.`)
			}
			if (typeof param.setValueAtTime !== 'function') {
				throw new Error('A live PDC delay does not expose sample-timed automation.')
			}
			const seconds = frames / this.sampleRate
			// Web Audio clamps delayTime to the delay's construction-time maximum
			// without erroring, so scheduling past it would land silently short
			// while this commit still reported an exact swap.
			if (typeof param.maxValue === 'number' && seconds > param.maxValue) {
				throw new RangeError(`A live PDC revision exceeds the compensation delay built for path ${key}.`)
			}
			revisions.push({ param, seconds })
		}
		for (const { param, seconds } of revisions) {
			param.cancelScheduledValues?.(contextTime)
			param.setValueAtTime(seconds, contextTime)
		}
		const updatedPaths = revisions.length
		return Object.freeze({
			status: 'scheduled', atFrame, contextTime,
			publicationDelayMs: Math.max(0, (contextTime - context.currentTime) * 1_000),
			updatedPaths,
		})
	},
} satisfies EngineRuntimeMethodMap<'commitNativeEffectPdcRevision'>

function compensationFrames(plan: ProjectPathPdcPlanV21, key: string): number {
	if (key.startsWith('input:')) return plan.nodeInputLatencyFrames.get(key.slice(6)) ?? -1
	if (key.startsWith('edge:')) return plan.edgeCompensationFrames.get(key.slice(5)) ?? -1
	if (key.startsWith('output:')) {
		const output = plan.outputLatencyFrames.get(key.slice(7))
		return output === undefined ? -1 : plan.latencyFrames - output
	}
	return -1
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${label} is outside its admitted bounds.`)
	}
	return Number(value)
}
