import { useEffect, useRef, useState } from 'react';
import { Button, Knob, MixerPanel } from '@dilsonspickles/components';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import RecordingInputSelectors from '../RecordingInputSelectors.jsx';
import { rackEffectLabel } from '../dialogs/editor-dialog-model.js';
import {
	isMixerGraphV21Surface,
	mixerTrackSurfaceRouteV21,
} from '../../mixer-graph-surface-v21.ts';

export default function AudioEditorMixerPanel({ controller, snapshot, copy, run, showArmControls, displayAudioSupported, onOpenEffects }) {
	const meters = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters);
	const project = snapshot.project;
	const tracks = (project?.tracks || []).filter((track) => track.type === 'audio');
	const groups = project?.mixer?.groups || [];
	const sends = project?.mixer?.sends || [];
	const routes = isMixerGraphV21Surface(project?.mixer)
		? Object.fromEntries(tracks.map((track) => [track.id, mixerTrackSurfaceRouteV21(project.mixer, track.id)]))
		: project?.mixer?.routes || {};
	const mixerBuses = [
		...groups.map((bus) => ({ type: 'group', bus })),
		...sends.map((bus) => ({ type: 'send', bus })),
	];
	const effectLabels = new Map((snapshot.effects?.rackTypes || []).map(({ type, label }) => [type, label]));
	const effectProps = (effects, scope, targetId) => (effects || []).map((effect) => ({
		name: rackEffectLabel(effect, effectLabels, copy),
		enabled: effect.type === 'missing'
			? effect.enabled !== false
			: effect.enabled !== false && effect.bypassed !== true,
		onToggle: () => run(() => controller.actions.effects.update(scope, targetId, effect.id, { enabled: effect.enabled === false })),
		onRemoveEffect: () => run(() => controller.actions.effects.remove(scope, targetId, effect.id)),
		...(scope !== 'master' ? { onClick: () => onOpenEffects(targetId, null, scope) } : {}),
	}));
	const channelProps = (channel, type) => {
		const isTrack = type === 'track';
		const isMaster = type === 'master';
		const targetId = channel.id || 'master';
		const scope = isTrack ? 'track' : type;
		const meter = isMaster ? meters?.master : meters?.[`${type}s`]?.[targetId];
		const update = (changes) => {
			if (isTrack) return controller.actions.track.update(targetId, changes);
			if (isMaster) return controller.actions.mixer.updateMaster(changes);
			return controller.actions.mixer.updateBus(type, targetId, changes);
		};
		return {
			className: `kw-audio-editor__mixer-channel kw-audio-editor__mixer-channel--${type}`,
			trackName: isMaster ? copy.master : channel.name,
			trackColor: mixerChannelColor(channel.color, type),
			variant: 'stereo',
			volume: linearMixerGainToDb(channel.gain),
			pan: Math.round((channel.pan || 0) * 100),
			muted: Boolean(channel.mute),
			soloed: Boolean(channel.solo),
			meterLeft: mixerMeterPercent(meter),
			meterRight: mixerMeterPercent(meter),
			effects: effectProps(channel.effects, scope, targetId),
			onVolumeChange: (value) => run(() => update({ gain: mixerDbToLinearGain(value) })),
			onPanChange: (value) => run(() => update({ pan: Math.max(-1, Math.min(1, Number(value) / 100)) })),
			onMuteToggle: () => run(() => update({ mute: !channel.mute })),
			onSoloToggle: () => run(() => update({ solo: !channel.solo })),
			...(isTrack ? {
				onAddEffect: () => onOpenEffects(targetId, null, scope),
				...(sends.length ? {
					effectFooter: <MixerSendControls
						track={channel}
						route={routes[targetId] || { sends: {} }}
						sends={sends}
						copy={copy}
						disabled={snapshot.readOnly}
						onChange={(sendId, gain) => run(() => controller.actions.mixer.setSend(targetId, sendId, gain))}
					/>,
				} : {}),
				...(showArmControls ? {
					inputControls: (
						<RecordingInputSelectors
							controller={controller}
							recordingInputs={snapshot.recordingInputs}
							track={channel}
							copy={copy}
							run={run}
							displayAudioSupported={displayAudioSupported}
							disabled={snapshot.readOnly || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
							surface="mixer"
						/>
					),
				} : {}),
			} : !isMaster ? {
				onAddEffect: () => onOpenEffects(targetId, null, scope),
			} : {}),
		};
	};
	const channels = [
		...tracks.map((track) => ({ id: track.id, channelProps: channelProps(track, 'track') })),
		...mixerBuses.map(({ type, bus }) => ({ id: bus.id, channelProps: channelProps(bus, type) })),
	];
	const addBus = (type) => run(() => controller.actions.mixer.addBus(type, {
		name: `${type === 'group' ? copy.groupBus : copy.sendBus} ${(type === 'group' ? groups : sends).length + 1}`,
	}));
	return (
		<div className="kw-audio-editor__mixer" data-mixer-panel>
			<div className="kw-audio-editor__mixer-toolbar">
				<strong>{copy.mixerRouting}</strong>
				<Button variant="secondary" disabled={snapshot.readOnly} onClick={() => addBus('group')}>{copy.addGroupBus}</Button>
				<Button variant="secondary" disabled={snapshot.readOnly} onClick={() => addBus('send')}>{copy.addSendBus}</Button>
				{mixerBuses.length > 0 && <select aria-label={copy.removeBus} disabled={snapshot.readOnly} value="" onChange={(event) => {
					const selected = mixerBuses.find(({ type, bus }) => `${type}:${bus.id}` === event.currentTarget.value);
					if (selected) run(() => controller.actions.mixer.removeBus(selected.type, selected.bus.id));
				}}>
					<option value="">{copy.removeBus}</option>
					{mixerBuses.map(({ type, bus }) => <option key={bus.id} value={`${type}:${bus.id}`}>{type === 'group' ? copy.groupBus : copy.sendBus}: {bus.name}</option>)}
				</select>}
			</div>
			{groups.length > 0 && <div className="kw-audio-editor__mixer-routing" role="region" aria-label={copy.mixerRouting}>
				<table>
					<thead><tr><th>{copy.track}</th><th>{copy.output}</th></tr></thead>
					<tbody>{tracks.map((track) => {
						const route = routes[track.id] || { groupId: null, sends: {} };
						return <tr key={track.id}>
							<th scope="row">{track.name}</th>
							<td><select aria-label={`${copy.output}: ${track.name}`} disabled={snapshot.readOnly || route.groupEditable === false} value={route.groupId || ''} onChange={(event) => run(() => controller.actions.mixer.setRoute(track.id, { groupId: event.currentTarget.value || null }))}>
								<option value="">{copy.master}</option>
								{groups.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
							</select></td>
						</tr>;
					})}</tbody>
				</table>
			</div>}
			{tracks.length || groups.length || sends.length ? <MixerPanel
				hideHeader
				className="kw-audio-editor__audacity-mixer"
				channels={channels}
				masterChannel={channelProps(project.master || {}, 'master')}
				effectFooterLabel={sends.length ? copy.sends : undefined}
			/> : <p className="kw-audio-editor__panel-empty">{copy.noAudioTrackSelected}</p>}
		</div>
	);
}

function MixerSendControls({ track, route, sends, copy, disabled, onChange }) {
	const [sendId, setSendId] = useState(() => sends[0]?.id || '');
	const selectedSend = sends.find((bus) => bus.id === sendId) || sends[0] || null;
	useEffect(() => {
		if (selectedSend?.id !== sendId) setSendId(selectedSend?.id || '');
	}, [selectedSend?.id, sendId]);
	if (!selectedSend) return null;
	const label = `${copy.sendLevel}: ${track.name} → ${selectedSend.name}`;
	const gain = linearMixerGainToDb(route.sends?.[selectedSend.id] || 0);
	const sendDisabled = disabled || (Array.isArray(route.editableSendIds)
		&& !route.editableSendIds.includes(selectedSend.id));
	return (
		<div className="kw-audio-editor__mixer-send-controls" data-mixer-sends={track.id}>
			<MixerSendKnob label={label} value={gain} disabled={sendDisabled} onChange={(value) => onChange(selectedSend.id, mixerDbToLinearGain(value))} />
			<select aria-label={`${copy.sends}: ${track.name}`} disabled={disabled} value={selectedSend.id} onChange={(event) => setSendId(event.currentTarget.value)}>
				{sends.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
			</select>
		</div>
	);
}

function MixerSendKnob({ label, value, disabled, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const knob = wrapperRef.current?.querySelector('.knob');
		if (!knob) return undefined;
		knob.setAttribute('type', 'button');
		knob.setAttribute('aria-label', label);
		const handleKeyDown = (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			if (event.key === 'Home') onChange(-60);
			else if (event.key === 'End') onChange(12);
			else onChange(Math.max(-60, Math.min(12, value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))));
		};
		knob.addEventListener('keydown', handleKeyDown);
		return () => knob.removeEventListener('keydown', handleKeyDown);
	}, [label, onChange, value]);
	return <div ref={wrapperRef} className="kw-audio-editor__mixer-send-knob"><Knob value={value} min={-60} max={12} step={1} label={label} mode="unipolar" disabled={disabled} onChange={onChange} /></div>;
}

function linearMixerGainToDb(gain, floor = -60) {
	const value = Number(gain);
	return value > 0 ? Math.max(floor, Math.min(12, 20 * Math.log10(value))) : floor;
}

function mixerDbToLinearGain(db, offValue = Number.NEGATIVE_INFINITY) {
	const value = Number(db);
	return value <= offValue ? 0 : Math.min(4, 10 ** (value / 20));
}

function mixerMeterPercent(meter) {
	const db = Number(meter?.dbfs);
	return Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0;
}

function mixerChannelColor(color, type) {
	if (typeof color === 'string' && color.startsWith('#')) return color;
	if (type === 'group') return '#4f87c8';
	if (type === 'send') return '#8c6fd1';
	if (type === 'master') return '#56606f';
	return { red: '#c95d68', orange: '#ce7a43', yellow: '#b69a3f', green: '#4d9669', blue: '#4f87c8', purple: '#8c6fd1' }[color] || '#4f87c8';
}
