/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioEditorShortcut } from '../audio-editor-shortcut-normalization.ts';

// Named KeyboardEvent.key values from https://www.w3.org/TR/uievents-key/.
// Direction, Space, keypad Enter, and extra mouse names are editor aliases.
const NAMED_KEYS = new Set(`
	Unidentified Alt AltGraph CapsLock Control Fn FnLock Meta NumLock ScrollLock Shift Symbol SymbolLock Hyper Super
	Enter Tab ArrowDown ArrowLeft ArrowRight ArrowUp End Home PageDown PageUp Backspace Clear Copy CrSel Cut Delete
	EraseEof ExSel Insert Paste Redo Undo Accept Again Attn Cancel ContextMenu Escape Execute Find Help Pause Play
	Props Select ZoomIn ZoomOut BrightnessDown BrightnessUp Eject LogOff Power PowerOff PrintScreen Hibernate Standby
	WakeUp AllCandidates Alphanumeric CodeInput Compose Convert Dead FinalMode GroupFirst GroupLast GroupNext
	GroupPrevious ModeChange NextCandidate NonConvert PreviousCandidate Process SingleCandidate HangulMode HanjaMode
	JunjaMode Eisu Hankaku Hiragana HiraganaKatakana KanaMode KanjiMode Katakana Romaji Zenkaku ZenkakuHankaku
	Soft1 Soft2 Soft3 Soft4 ChannelDown ChannelUp Close MailForward MailReply MailSend MediaClose MediaFastForward
	MediaPause MediaPlay MediaPlayPause MediaRecord MediaRewind MediaStop MediaTrackNext MediaTrackPrevious New Open
	Print Save SpellCheck Key11 Key12 AudioBalanceLeft AudioBalanceRight AudioBassBoostDown AudioBassBoostToggle
	AudioBassBoostUp AudioFaderFront AudioFaderRear AudioSurroundModeNext AudioTrebleDown AudioTrebleUp AudioVolumeDown
	AudioVolumeUp AudioVolumeMute MicrophoneToggle MicrophoneVolumeDown MicrophoneVolumeUp MicrophoneVolumeMute
	SpeechCorrectionList SpeechInputToggle LaunchApplication1 LaunchApplication2 LaunchCalendar LaunchContacts LaunchMail
	LaunchMediaPlayer LaunchMusicPlayer LaunchPhone LaunchScreenSaver LaunchSpreadsheet LaunchWebBrowser LaunchWebCam
	LaunchWordProcessor BrowserBack BrowserFavorites BrowserForward BrowserHome BrowserRefresh BrowserSearch BrowserStop
	AppSwitch Call Camera CameraFocus EndCall GoBack GoHome HeadsetHook LastNumberRedial Notification MannerMode VoiceDial
	TV TV3DMode TVAntennaCable TVAudioDescription TVAudioDescriptionMixDown TVAudioDescriptionMixUp TVContentsMenu
	TVDataService TVInput TVInputComponent1 TVInputComponent2 TVInputComposite1 TVInputComposite2 TVInputHDMI1 TVInputHDMI2
	TVInputHDMI3 TVInputHDMI4 TVInputVGA1 TVMediaContext TVNetwork TVNumberEntry TVPower TVRadioService TVSatellite
	TVSatelliteBS TVSatelliteCS TVSatelliteToggle TVTerrestrialAnalog TVTerrestrialDigital TVTimer AVRInput AVRPower
	ColorF0Red ColorF1Green ColorF2Yellow ColorF3Blue ColorF4Grey ColorF5Brown ClosedCaptionToggle Dimmer DisplaySwap DVR
	Exit FavoriteClear0 FavoriteClear1 FavoriteClear2 FavoriteClear3 FavoriteRecall0 FavoriteRecall1 FavoriteRecall2
	FavoriteRecall3 FavoriteStore0 FavoriteStore1 FavoriteStore2 FavoriteStore3 Guide GuideNextDay GuidePreviousDay Info
	InstantReplay Link ListProgram LiveContent Lock MediaApps MediaAudioTrack MediaLast MediaSkipBackward MediaSkipForward
	MediaStepBackward MediaStepForward MediaTopMenu NavigateIn NavigateNext NavigateOut NavigatePrevious NextFavoriteChannel
	NextUserProfile OnDemand Pairing PinPDown PinPMove PinPToggle PinPUp PlaySpeedDown PlaySpeedReset PlaySpeedUp RandomToggle
	RcLowBattery RecordSpeedNext RfBypass ScanChannelsToggle ScreenModeNext Settings SplitScreenToggle STBInput STBPower
	Subtitle Teletext VideoModeNext Wink ZoomToggle Down Up Left Right Space NumpadEnter Mouse4 Mouse5
`.trim().toLowerCase().split(/\s+/u));

/** Refuse typographical key names while retaining native and Unicode keys. */
export function recognizedShortcutKey(binding: string): boolean {
	const trimmed = binding.trim();
	const key = trimmed.endsWith('+') ? '+' : (trimmed.split('+').at(-1)?.trim() ?? '');
	if (/^\P{C}\p{M}*$/u.test(key.normalize('NFC'))) return true;
	const normalized = normalizeAudioEditorShortcut(key).toLowerCase();
	return NAMED_KEYS.has(normalized) || /^f(?:[1-9]|[1-9]\d)$/u.test(normalized);
}
