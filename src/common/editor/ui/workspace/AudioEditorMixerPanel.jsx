import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Knob } from '@soundscaper/design-system/Knob';
import { MixerPanel } from '@soundscaper/design-system/MixerPanel';

import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import RecordingInputSelectors from '../RecordingInputSelectors.jsx';
import { rackEffectLabel } from '../dialogs/editor-dialog-model.js';
import {
	isMixerGraphV21Surface,
	mixerTrackSurfaceRouteV21,
} from '../../mixer-graph-surface-v21.ts';
import { resolveTerminalChannelWidths } from '../../terminal-channel-widths.ts';
import {
	folderOwnedMixerBusIds,
	mixerAudibilityAuthority,
	removableMixerBuses,
} from './mixer-panel-model.ts';
import { MixerTelemetryMeters } from './MixerTelemetryMeters.tsx';
import {
	createParameterAutomationControlRouterV21,
	resolveSoundscaperRoutingGraphCopy,
	useTrackAutomationRuntime,
} from '../soundscaper-workflow-product-runtime.tsx';

const SOUNDSCAPER_BUILD = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'soundscaper';
const SoundscaperRoutingGraphView = SOUNDSCAPER_BUILD
	? lazyEditorModule(() => import('./SoundscaperRoutingGraphView.tsx')) : null;

export default function AudioEditorMixerPanel({ controller, snapshot, copy, run, showArmControls, displayAudioSupported, onOpenEffects, productId = snapshot.productId, capabilities = snapshot.capabilities, onRoutingGraphGesture = /** @type {import('./soundscaper-routing-graph-gesture.ts').SoundscaperRoutingGraphGestureHandler | undefined} */ (undefined), onRoutingParameterGesture = /** @type {import('./soundscaper-routing-graph-gesture.ts').SoundscaperRoutingParameterGestureHandler | undefined} */ (undefined), automationRuntime: automationRuntimeProp }) {
	const project = snapshot.project;
	const inheritedAutomationRuntime = useTrackAutomationRuntime();
	const automationRuntime = automationRuntimeProp ?? inheritedAutomationRuntime;
	const automationRouterRef = useRef(null);
	if (!automationRouterRef.current) automationRouterRef.current = createParameterAutomationControlRouterV21();
	const automationRouter = automationRouterRef.current;
	automationRouter.setContext({
		runtime: automationRuntime,
		project,
		onError: (error) => run(() => { throw error; }),
	});
	useEffect(() => () => { automationRouter.cancel(); }, [automationRouter, project?.id]);
	const routeRoutingParameterGesture = useCallback((gesture) => {
		if (typeof onRoutingParameterGesture === 'function') {
			return onRoutingParameterGesture(gesture);
		}
		if (gesture.phase === 'begin') return automationRouter.begin(gesture.address, gesture.value);
		if (gesture.phase === 'preview') return automationRouter.preview(gesture.address, gesture.value);
		if (gesture.phase === 'release') return automationRouter.release(gesture.address, gesture.value);
		return automationRouter.cancel(gesture.address);
	}, [automationRouter, onRoutingParameterGesture]);
	const [routingGraphOpen, setRoutingGraphOpen] = useState(false);
	const [requestedRoutingSelection, setRequestedRoutingSelection] = useState(null);
	const consumeRequestedRoutingSelection = useCallback(() => setRequestedRoutingSelection(null), []);
	const routingCopy = resolveSoundscaperRoutingGraphCopy(copy);
	const tracks = (project?.tracks || []).filter((track) => track.type === 'audio');
	const groups = project?.mixer?.groups || [];
	const sends = project?.mixer?.sends || [];
	const terminalWidths = isMixerGraphV21Surface(project?.mixer)
		? resolveTerminalChannelWidths(project, project.masterChannels)
		: null;
	const routes = isMixerGraphV21Surface(project?.mixer)
		? Object.fromEntries(tracks.map((track) => [track.id, mixerTrackSurfaceRouteV21(
			project.mixer,
			track.id,
			{
				sourceChannels: terminalWidths?.tracks.get(track.id) || project.masterChannels,
				masterChannels: project.masterChannels,
			},
		)]))
		: project?.mixer?.routes || {};
	// A folder that contains audio owns its group: the folder holds that bus's
	// name, mute, solo, and existence, and the graph refuses to edit them on the
	// bus itself. The strip is still shown — it is where the folder's audio is
	// mixed — but its mute and solo speak to the folder, and it is not offered for
	// removal, because removing it means removing the folder.
	const folderBusIds = folderOwnedMixerBusIds(project);
	const mixerBuses = [
		...groups.map((bus) => ({ type: 'group', bus })),
		...sends.map((bus) => ({ type: 'send', bus })),
	];
	const removableBuses = removableMixerBuses(mixerBuses, folderBusIds);
	const routingGraphAvailable = SOUNDSCAPER_BUILD
		&& productId === 'soundscaper'
		&& capabilities?.audioMixerGraph !== false
		&& isMixerGraphV21Surface(project?.mixer);
	useEffect(() => {
		if (!routingGraphAvailable && routingGraphOpen) setRoutingGraphOpen(false);
	}, [routingGraphAvailable, routingGraphOpen]);
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
		const folderOwned = mixerAudibilityAuthority(type, targetId, folderBusIds) === 'folder';
		const update = (changes) => {
			if (isTrack) return controller.actions.track.update(targetId, changes);
			if (isMaster) return controller.actions.mixer.updateMaster(changes);
			// The folder is the authority for its own group's audibility, so the
			// strip's toggles speak to it rather than to a bus that refuses them.
			if (folderOwned) return controller.actions.trackFolders.update(targetId, changes);
			return controller.actions.mixer.updateBus(type, targetId, changes);
		};
		const busUpdate = (changes) => {
			if (isTrack) return controller.actions.track.update(targetId, changes);
			if (isMaster) return controller.actions.mixer.updateMaster(changes);
			return controller.actions.mixer.updateBus(type, targetId, changes);
		};
		const stripAddress = (parameterId) => isTrack ? {
			kind: 'strip', strip: { kind: 'track', id: targetId }, parameterId,
		} : null;
		const updateContinuous = (address, value, changes) => {
			if (address && (automationRouter.preview(address, value)
				|| automationRouter.captureAvailable(address))) return;
			run(() => busUpdate(changes));
		};
		const updateAtomic = (address, value, changes) => {
			if (address && automationRouter.performAtomic(address, value)) return;
			run(() => update(changes));
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
			meterContent: <MixerTelemetryMeters controller={controller} scope={type} targetId={targetId} />,
			effects: effectProps(channel.effects, scope, targetId),
			onVolumeChange: (value) => {
				const gain = mixerDbToLinearGain(value);
				updateContinuous(stripAddress('gain'), gain, { gain });
			},
			onPanChange: (value) => {
				const pan = Math.max(-1, Math.min(1, Number(value) / 100));
				updateContinuous(stripAddress('pan'), pan, { pan });
			},
			onMuteToggle: () => updateAtomic(
				stripAddress('mute'), channel.mute ? 0 : 1, { mute: !channel.mute },
			),
			onSoloToggle: () => run(() => update({ solo: !channel.solo })),
			...(isTrack ? {
				onVolumeGestureStart: (value) => automationRouter.begin(
					stripAddress('gain'), mixerDbToLinearGain(value),
				),
				onVolumeGestureEnd: (value) => automationRouter.release(
					stripAddress('gain'), mixerDbToLinearGain(value),
				),
				onVolumeGestureCancel: () => automationRouter.cancel(stripAddress('gain')),
				onPanGestureStart: (value) => automationRouter.begin(
					stripAddress('pan'), Math.max(-1, Math.min(1, Number(value) / 100)),
				),
				onPanGestureEnd: (value) => automationRouter.release(
					stripAddress('pan'), Math.max(-1, Math.min(1, Number(value) / 100)),
				),
				onPanGestureCancel: () => automationRouter.cancel(stripAddress('pan')),
				onAddEffect: () => onOpenEffects(targetId, null, scope),
				...(sends.length ? {
					effectFooter: <MixerSendControls
						track={channel}
						route={routes[targetId] || { sends: {} }}
						sends={sends}
							copy={copy}
							disabled={snapshot.readOnly}
							automationRouter={automationRouter}
							project={project}
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
	const addBus = (type) => run(() => {
		const id = controller.actions.mixer.addBus(type, {
			name: `${type === 'group' ? copy.groupBus : copy.sendBus} ${(type === 'group' ? groups : sends).length + 1}`,
		});
		if (routingGraphOpen && typeof id === 'string') {
			setRequestedRoutingSelection({
				kind: 'node', collection: type === 'group' ? 'groups' : 'sends', id,
			});
		}
		return id;
	});
	const commitRoutingGraph = (gesture) => {
		const command = {
			type: 'mixer-graph/set',
			expected: project.mixer,
			mixer: gesture.graph,
		};
		return run(() => {
			const commit = () => controller.actions.edit.commit(command);
			return typeof onRoutingGraphGesture === 'function'
				? onRoutingGraphGesture({ ...gesture, command, commit })
				: commit();
		});
	};
	return (
		<div className="kw-audio-editor__mixer" data-mixer-panel>
			<div className="kw-audio-editor__mixer-toolbar">
				<strong>{copy.mixerRouting}</strong>
				<Button variant="secondary" disabled={snapshot.readOnly} onClick={() => addBus('group')}>{copy.addGroupBus}</Button>
				<Button variant="secondary" disabled={snapshot.readOnly} onClick={() => addBus('send')}>{copy.addSendBus}</Button>
				{routingGraphAvailable && <button
					type="button"
					className="kw-audio-editor__mixer-routing-toggle"
					aria-pressed={routingGraphOpen}
					aria-controls="soundscaper-mixer-routing-graph"
					onClick={() => setRoutingGraphOpen((open) => !open)}
				>{routingGraphOpen ? routingCopy.channelStrips : routingCopy.routing}</button>}
				{!routingGraphOpen && removableBuses.length > 0 && <select aria-label={copy.removeBus} disabled={snapshot.readOnly} value="" onChange={(event) => {
					const selected = removableBuses.find(({ type, bus }) => `${type}:${bus.id}` === event.currentTarget.value);
					if (selected) run(() => controller.actions.mixer.removeBus(selected.type, selected.bus.id));
				}}>
					<option value="">{copy.removeBus}</option>
					{removableBuses.map(({ type, bus }) => <option key={bus.id} value={`${type}:${bus.id}`}>{type === 'group' ? copy.groupBus : copy.sendBus}: {bus.name}</option>)}
				</select>}
			</div>
			{routingGraphOpen && routingGraphAvailable && SoundscaperRoutingGraphView ? <div id="soundscaper-mixer-routing-graph" className="kw-audio-editor__mixer-routing-graph-host">
				<Suspense fallback={<p className="kw-audio-editor__panel-empty" role="status">{copy.loading || 'Loading routing graph…'}</p>}>
					<SoundscaperRoutingGraphView
						project={project}
						graph={project.mixer}
						disabled={snapshot.readOnly}
						copy={routingCopy}
						requestedSelection={requestedRoutingSelection}
						onRequestedSelectionConsumed={consumeRequestedRoutingSelection}
						onCommit={commitRoutingGraph}
						onParameterGesture={routeRoutingParameterGesture}
					/>
				</Suspense>
			</div> : <>
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
			</>}
		</div>
	);
}

function MixerSendControls({ track, route, sends, copy, disabled, automationRouter, project, onChange }) {
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
	const address = sendLevelAddress(project, track.id, selectedSend.id);
	const change = (value) => {
		const next = mixerDbToLinearGain(value);
		if (address && (automationRouter.preview(address, next)
			|| automationRouter.captureAvailable(address))) return;
		onChange(selectedSend.id, next);
	};
	return (
		<div className="kw-audio-editor__mixer-send-controls" data-mixer-sends={track.id}>
			<MixerSendKnob
				label={label}
				value={gain}
				disabled={sendDisabled}
				onChange={change}
				onGestureStart={(value) => address && automationRouter.begin(
					address, mixerDbToLinearGain(value),
				)}
				onGestureEnd={(value) => address && automationRouter.release(
					address, mixerDbToLinearGain(value),
				)}
				onGestureCancel={() => address && automationRouter.cancel(address)}
			/>
			<select aria-label={`${copy.sends}: ${track.name}`} disabled={disabled} value={selectedSend.id} onChange={(event) => setSendId(event.currentTarget.value)}>
				{sends.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
			</select>
		</div>
	);
}

function MixerSendKnob({ label, value, disabled, onChange, onGestureStart, onGestureEnd, onGestureCancel }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const knob = wrapperRef.current?.querySelector('.knob');
		if (!knob) return undefined;
		knob.type = 'button';
		knob.ariaLabel = label;
		// Arrow keys are the Knob's own business since design-system 0.10.1 — it
		// steps by the same 1 dB within the same bounds. Handling them here too
		// moved the send twice per press. Home and End remain ours.
		const handleKeyDown = (event) => {
			if (!['Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			const next = event.key === 'Home' ? -60 : 12;
			onGestureStart?.(value);
			onChange(next);
			onGestureEnd?.(next);
		};
		knob.addEventListener('keydown', handleKeyDown);
		return () => knob.removeEventListener('keydown', handleKeyDown);
	}, [label, onChange, onGestureEnd, onGestureStart, value]);
	return <div ref={wrapperRef} className="kw-audio-editor__mixer-send-knob"><Knob value={value} min={-60} max={12} step={1} label={label} mode="unipolar" disabled={disabled} onChange={onChange} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} onGestureCancel={onGestureCancel} /></div>;
}

function sendLevelAddress(project, trackId, sendId) {
	const edge = project?.mixer?.edges?.find((candidate) => (
		candidate.kind === 'send'
		&& candidate.source?.kind === 'track' && candidate.source.id === trackId
		&& candidate.destination?.kind === 'mixer-node' && candidate.destination.id === sendId
	));
	return edge ? { kind: 'edge', edgeId: edge.id, parameterId: 'level' } : null;
}

function linearMixerGainToDb(gain, floor = -60) {
	const value = Number(gain);
	return value > 0 ? Math.max(floor, Math.min(12, 20 * Math.log10(value))) : floor;
}

function mixerDbToLinearGain(db, offValue = Number.NEGATIVE_INFINITY) {
	const value = Number(db);
	return value <= offValue ? 0 : Math.min(4, 10 ** (value / 20));
}

function mixerChannelColor(color, type) {
	if (typeof color === 'string' && color.startsWith('#')) return color;
	if (type === 'group') return '#4f87c8';
	if (type === 'send') return '#8c6fd1';
	if (type === 'master') return '#56606f';
	return { red: '#c95d68', orange: '#ce7a43', yellow: '#b69a3f', green: '#4d9669', blue: '#4f87c8', purple: '#8c6fd1' }[color] || '#4f87c8';
}
