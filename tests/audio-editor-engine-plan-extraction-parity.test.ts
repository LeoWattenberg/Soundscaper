import assert from 'node:assert/strict';
import test from 'node:test';

import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { scheduleProjectGains } from '../src/common/editor/engine/clip-gain.ts';
import {
	nonNegativeInteger,
	positiveInteger,
} from '../src/common/editor/engine/buffer-math.ts';
import { effectRackLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { activeRackEffects } from '../src/common/editor/engine/project-effects.ts';
import { projectGraphLatencyFrames } from '../src/common/editor/engine/project-graph.ts';
import type {
	ProjectGainParams,
	ScheduledGainParam,
} from '../src/common/editor/engine/project-graph.ts';
import type {
	EngineGainOwner,
	EngineProject,
} from '../src/common/editor/engine/types.ts';

type ParamEvent = readonly ['set' | 'ramp', number, number];

test('PDC plan extraction preserves the legacy project latency calculation byte-for-byte', () => {
	const project = representativeProject();
	const cases = [
		{},
		{ includeMaster: false },
		{ trackId: 'track-fast' },
		{ trackId: 'track-slow', includeMaster: false },
		{ trackId: 'undefined' },
		{ sampleRate: 96_000 },
	] as const;
	for (const options of cases) {
		const actual = projectGraphLatencyFrames(project, options);
		const legacy = legacyProjectGraphLatencyFrames(project, options);
		assert.deepEqual(Buffer.from(JSON.stringify(actual)), Buffer.from(JSON.stringify(legacy)));
	}
});

test('gain-event plan extraction preserves track, group, send, and master schedules exactly', () => {
	const project = representativeProject();
	const actual = gainRegistry();
	const legacy = gainRegistry();
	const options = {
		context: { sampleRate: 96_000 } as BaseAudioContext,
		project,
		fromFrame: 12_000,
		toFrame: 42_000,
		contextStartTime: 1.25,
		sampleRate: 48_000,
		transportRate: 1.5,
	};
	scheduleProjectGains({ ...options, gainParams: actual.registry });
	legacyScheduleProjectGains({ ...options, gainParams: legacy.registry });
	assert.deepEqual(
		Buffer.from(JSON.stringify(actual.events())),
		Buffer.from(JSON.stringify(legacy.events())),
	);
});

function representativeProject(): EngineProject {
	const limiter = (id: string, lookahead: number) => ({
		id,
		type: 'limiter',
		enabled: true,
		params: { lookahead },
	});
	return {
		sampleRate: 48_000,
		clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 48_000 }],
		tracks: [
			{
				id: 'track-fast', type: 'audio', gain: 0.8,
				effects: [limiter('track-fast-limiter', 0.001)],
				envelope: [{ frame: 0, value: 1 }, { frame: 24_000, value: 0.5 }, { frame: 48_000, value: 1 }],
			},
			{
				id: 'track-slow', type: 'audio', gain: 0.6,
				effects: [limiter('track-slow-limiter', 0.004)],
				envelope: [{ frame: 8_000, value: 0.25 }, { frame: 32_000, value: 0.75 }],
			},
			{ id: 'label', type: 'label', gain: 1, effects: [limiter('ignored-label', 1)] },
			{ type: 'audio', gain: 1, effects: [limiter('legacy-undefined-id', 0.0025)] },
		],
		mixer: {
			groups: [{
				id: 'group-main', gain: 0.7,
				effects: [limiter('group-limiter', 0.002)],
				envelope: [{ frame: 0, value: 0.9 }, { frame: 36_000, value: 0.4 }],
			}],
			sends: [{
				id: 'send-reverb', gain: 0.5,
				effects: [limiter('send-limiter', 0.003)],
				envelope: [{ frame: 4_000, value: 0.2 }, { frame: 40_000, value: 0.8 }],
			}],
			routes: {},
		},
		master: {
			gain: 0.9,
			effects: [limiter('master-limiter', 0.005)],
			envelope: [{ frame: 0, value: 1 }, { frame: 30_000, value: 0.6 }, { frame: 48_000, value: 0.9 }],
		},
	};
}

function legacyProjectGraphLatencyFrames(
	project: EngineProject,
	{
		trackId = null,
		includeMaster = true,
		sampleRate = project.sampleRate || 48_000,
	}: Readonly<{ trackId?: unknown; includeMaster?: boolean; sampleRate?: number }> = {},
): number {
	const tracks = (project.tracks || []).filter((track) => (
		track.type !== 'label' && track.type !== 'video'
			&& (trackId == null || String(track.id) === String(trackId))
	));
	const trackLatency = tracks.reduce((maximum, track) => Math.max(
		maximum,
		effectRackLatencyFrames(activeRackEffects(track), sampleRate),
	), 0);
	const masterLatency = includeMaster
		? effectRackLatencyFrames(activeRackEffects(project.master), sampleRate)
		: 0;
	const busLatency = Math.max(0, ...[
		...(project.mixer?.groups || []),
		...(project.mixer?.sends || []),
	].map((bus) => effectRackLatencyFrames(activeRackEffects(bus), sampleRate)));
	return trackLatency + busLatency + masterLatency;
}

function gainRegistry(): {
	readonly registry: ProjectGainParams;
	readonly events: () => Readonly<Record<string, readonly ParamEvent[]>>;
} {
	const params = {
		'track-fast': scheduledParam(48),
		'track-slow': scheduledParam(192),
		'group-main': scheduledParam(336),
		'send-reverb': scheduledParam(384),
		master: scheduledParam(624),
	};
	return {
		registry: {
			tracks: new Map([
				['track-fast', params['track-fast'].scheduled],
				['track-slow', params['track-slow'].scheduled],
			]),
			groups: new Map([['group-main', params['group-main'].scheduled]]),
			sends: new Map([['send-reverb', params['send-reverb'].scheduled]]),
			master: params.master.scheduled,
		},
		events: () => Object.fromEntries(Object.entries(params).map(([id, value]) => [
			id,
			value.param.events,
		])),
	};
}

function scheduledParam(latencyFrames: number): {
	readonly param: EventAudioParam;
	readonly scheduled: ScheduledGainParam;
} {
	const param = new EventAudioParam();
	return { param, scheduled: { param: param as unknown as AudioParam, latencyFrames } };
}

class EventAudioParam {
	value = 0;
	readonly events: ParamEvent[] = [];
	setValueAtTime(value: number, time: number): this {
		this.value = value;
		this.events.push(['set', value, time]);
		return this;
	}
	linearRampToValueAtTime(value: number, time: number): this {
		this.value = value;
		this.events.push(['ramp', value, time]);
		return this;
	}
}

function legacyScheduleProjectGains({
	context,
	project,
	gainParams,
	fromFrame,
	toFrame,
	contextStartTime,
	sampleRate,
	transportRate,
}: Readonly<{
	context: BaseAudioContext;
	project: EngineProject;
	gainParams: Partial<ProjectGainParams>;
	fromFrame: number;
	toFrame: number;
	contextStartTime: number;
	sampleRate: number;
	transportRate: number;
}>): void {
	const timelineRate = sampleRate * transportRate;
	const durationFrames = Math.max(1, 48_000, toFrame);
	const schedule = (owner: EngineGainOwner | undefined, scheduled?: ScheduledGainParam): void => {
		if (!scheduled?.param || !Array.isArray(owner?.envelope) || !owner.envelope.length) return;
		const baseGain = Math.max(0, finite(owner.gain, 1));
		const startTime = contextStartTime + nonNegativeInteger(scheduled.latencyFrames, 0)
			/ positiveInteger(context.sampleRate, sampleRate);
		scheduled.param.setValueAtTime(
			baseGain * envelopeValueAtFrame(owner.envelope, fromFrame, durationFrames),
			startTime,
		);
		for (const point of owner.envelope) {
			if (point.frame <= fromFrame || point.frame >= toFrame) continue;
			scheduled.param.linearRampToValueAtTime(
				baseGain * Math.max(0, finite(point.value, 1)),
				startTime + (point.frame - fromFrame) / timelineRate,
			);
		}
		if (toFrame > fromFrame) {
			scheduled.param.linearRampToValueAtTime(
				baseGain * envelopeValueAtFrame(owner.envelope, toFrame, durationFrames),
				startTime + (toFrame - fromFrame) / timelineRate,
			);
		}
	};
	for (const [index, track] of (project.tracks || []).entries()) {
		if (track.type === 'label' || track.type === 'video') continue;
		schedule(track, gainParams.tracks?.get(String(track.id ?? index)));
	}
	for (const [index, bus] of (project.mixer?.groups || []).entries()) {
		schedule(bus, gainParams.groups?.get(String(bus.id ?? index)));
	}
	for (const [index, bus] of (project.mixer?.sends || []).entries()) {
		schedule(bus, gainParams.sends?.get(String(bus.id ?? index)));
	}
	schedule(project.master, gainParams.master || undefined);
}

function finite(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
