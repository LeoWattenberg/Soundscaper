# Desktop Blender integration

Soundscaper desktop exports each audio track as a WAV stem alongside a track list
that the bundled Blender add-on imports into the Video Sequencer. Live sync sends
new track snapshots to the add-on while the same Soundscaper project stays open.
The connection updates audio and track metadata from Soundscaper to Blender;
Blender edits do not modify the Soundscaper project.

## Export and import

1. In Soundscaper desktop, choose **File > Export other > Export track list for Blender** and
   choose a parent directory. Soundscaper creates a separate bundle folder there.
2. In Blender 4.2 or later, open **Edit > Preferences > Add-ons**, choose **Install
   from Disk** from its menu, select the bundle's `soundscaper_blender.py`, and
   enable **Soundscaper track list and live sync**. Blender documents this
   [single-file add-on installation](https://docs.blender.org/manual/en/latest/editors/preferences/addons.html#installing-legacy-add-ons).
3. Choose **File > Import > Soundscaper track list (.json)** and select the
   bundle's `soundscaper.json`.

The import works without Soundscaper running. Copy the entire bundle to another
machine to keep its WAV references intact. Reimporting a project updates its
existing Soundscaper strips rather than duplicating them. Unrelated strips are
preserved. Keep the bundle beside a saved Blender project, or pack its sounds in
Blender before moving the project independently.

## Live edits

1. In Soundscaper desktop, choose **Tools > Start live Blender sync** and choose
   a parent directory for a new bundle.
2. Enable the bundled add-on in Blender as described above.
3. In Blender's Sequencer, choose **Add > Start Soundscaper live sync** and select
   the new bundle's `soundscaper.json`.
4. Edit audio in Soundscaper. Blender reloads the corresponding WAV stems after
   Soundscaper finishes rendering the latest revision.

Stop with **Tools > Stop live Blender sync** in Soundscaper or **Add > Stop
Soundscaper live sync** in Blender. Loading another `.blend` file or disabling
the add-on stops Blender's receiver. Closing or switching the Soundscaper project
ends its connection; start a new connection and select its new bundle to resume.
The last imported audio stays available after live sync stops.

Updates preserve a strip's identity, channel, volume, and pan. Soundscaper controls
track names, mute state, start, duration, added tracks, and removed tracks. Timeline
positions use Blender's effective frame rate (`fps / fps_base`), with Soundscaper
time zero mapped to Blender frame 1. Track audio includes Soundscaper's timeline
placement; exported stems generally start at zero. New tracks need free channels;
Blender supports at most 128 channels. The add-on checks capacity before changing
existing strips. It expands the scene's end frame when necessary and leaves the
scene's frame rate unchanged.

Live updates include a 250 ms edit debounce, track rendering time, a 250 ms polling
interval, and a 100 ms Blender timer interval. This is edit synchronization, rather than streaming
the playback transport or a guaranteed audio callback latency.

## Bundle and IPC contract

`soundscaper.json` uses schema version 1:

```json
{
  "schemaVersion": 1,
  "projectId": "project-id",
  "projectName": "Session",
  "revision": 1,
  "tracks": [
    {
      "id": "track-id",
      "name": "Voice",
      "fileName": "audio/1/track.wav",
      "startSeconds": 0,
      "durationSeconds": 12.5,
      "mute": false
    }
  ]
}
```

Each revision references immutable WAV files contained in its bundle. The exporter
publishes the manifest after the complete revision is ready. The receiver rejects
absolute paths, parent traversal, symlink escapes, non-WAV files, invalid timing,
duplicate track IDs, more than 128 tracks, and JSON larger than 4 MiB. It reads
audio data and metadata; manifests cannot request script execution.

Earlier revisions stay in the bundle so saved `.blend` files can still reference
them. Long editing sessions can therefore create large bundle folders. Remove an
unused bundle manually after its audio is no longer needed, or after packing the
sounds into every Blender project that uses it.

A live bundle also contains `live.json` with `schemaVersion: 1`,
`host: "127.0.0.1"`, an ephemeral `port`, and a random bearer `token`. The receiver
requests `GET /snapshot?after=<revision>` with `Authorization: Bearer <token>`.
HTTP 204 means unchanged; HTTP 200 supplies a newer manifest. The desktop server
accepts authenticated loopback requests and rejects browser Origin headers. It
exposes metadata only; WAV files are shared through the selected local bundle.
The receiver disables proxies and redirects and bounds each network request to
two seconds. Treat `live.json` as local connection credentials.

Networking runs in a worker thread. A bounded queue carries snapshots to a Blender
application timer; only that timer changes Blender data. This follows Blender's
[timer guidance for cross-thread events](https://docs.blender.org/api/4.2/bpy.app.timers.html#use-a-timer-to-react-to-events-in-another-thread).
The add-on handles the sequencer collection names used by Blender 4.2 and the
[renamed strip API](https://developer.blender.org/docs/release_notes/4.4/python_api/).

## Verification

The Node test `tests/desktop-blender-addon.test.ts` invokes Python functional tests
with a Blender API fixture and a real loopback HTTP server. Set `BLENDER_EXECUTABLE`
to add a headless smoke test against an installed Blender:

```sh
BLENDER_EXECUTABLE=/path/to/blender node --import tsx --test tests/desktop-blender-addon.test.ts
```

The smoke test imports actual WAVs, changes their source duration, checks that
track identity and Blender mix settings survive, removes tracks, and receives an
HTTP live update. This feature keeps the assistance engine runtime closure unchanged and does
not require a manual **Update AI assets** run.
