import { DialogSideNavItem } from '../DialogSideNav/DialogSideNav';
import type { PreferencesPage } from './types';

export const menuItems: DialogSideNavItem<PreferencesPage>[] = [
  { id: 'general', label: 'General', icon: '\uEF55' }, // cog
  { id: 'accounts', label: 'Accounts', icon: '\uEF99' }, // user
  { id: 'appearance', label: 'Appearance', icon: '\uF444' }, // brush
  { id: 'audio-settings', label: 'Audio settings', icon: '\uEF4E' }, // volume
  { id: 'playback-recording', label: 'Playback/Recording', icon: '\uF41B' }, // microphone
  { id: 'editing', label: 'Audio editing', icon: '\uF43C' }, // waveform
  { id: 'spectral-display', label: 'Spectral display', icon: '\uF442' }, // spectrogram
  { id: 'plugins', label: 'Plugins', icon: '\uF440' }, // plug
  { id: 'music', label: 'Music', icon: '\uF441' }, // book
  { id: 'cloud', label: 'Cloud', icon: '\uF435' }, // cloud
  { id: 'shortcuts', label: 'Shortcuts', icon: '\uF441' }, // keyboard
  { id: 'advanced-options', label: 'Advanced options', icon: '\uEF55' }, // cog
];
