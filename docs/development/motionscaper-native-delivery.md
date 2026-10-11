# Motionscaper native delivery

Motionscaper packages its own authenticated native helper and grants only its
closed ProRes delivery operation. The renderer receives an opaque job token;
native paths, temporary custody, child processes and destination replacement
stay in the Motionscaper main process. Framescaper and Soundscaper native service
authority is not admitted.

The independently versioned `motion-native-frame-carrier-v1.ts` transports
premultiplied linear Rec.709 float32 frames. At the native delivery boundary,
samples are unassociated, encoded with the Rec.709 transfer curve and converted
to the encoder's `yuva444p10` input. The ProRes 4444 codec stores 16-bit alpha;
effective color input precision is **10 bits**, not float or 16-bit color. HDR
delivery and arbitrary working color spaces are outside this profile.

The separate `motion-native-pcm-carrier-v1.ts` transports interleaved float32
audio with headroom. The native host rounds and clamps once to signed 24-bit
little-endian PCM. Mono and stereo at 8–192 kHz are admitted. The exported range
starts at zero; the pinned composition's fractional starting sample remains exact
in the mix request. The final sample count is the ceiling of the complete frame
range duration, avoiding accumulated per-frame rounding. A successful receipt
includes actual audio format/sample count, or `null` for explicit video-only
delivery.

Each upload is backpressured and separately authenticated. Main verifies the
closed headers and whole-file hashes; the helper checks them again. Only a
completed and rehashed MOV can replace the chosen destination, after detecting
any concurrent destination edit. Cancellation removes temporary custody. Primary
and cleanup failures remain separately inspectable in aggregate errors, and a
failed cancellation can be retried.

Flat MOV delivery admits at most 32,768 video frames and 134,217,728 audio samples.
Audio is packetized in fixed 4,096-sample blocks, yielding at most 32,768 audio
index entries. The pinned MOV muxer stores one cluster entry per packet. Direct
timestamp-ordered packet writes avoid a growing interleave queue. Carrier file
custody is separately bounded to 256 GiB, with frames limited to 16,777,216 pixels
and each dimension at most 16,384. Limits are validated before choosing output.

Qualification includes float-carrier corruption/refusal tests, an actual ProRes
color/alpha round trip, and PCM24 channel order, clipping, sample count and timing
checks at 96 kHz stereo. The packaged smoke writes a two-frame 48 kHz stereo MOV
through the installed helper and main capability. These small fixtures establish
the stated contract; they do not establish performance at the maximum bounds,
HDR behavior, multichannel delivery, or Adobe application interchange. Linux x64
has local packaged evidence. Other native targets require their target-native
CI build and packaged smoke before release qualification.

Changes to this helper's source or build closure require refreshing
`native/motionscaper-media-host/source-manifest.json` and rebuilding native media
artifacts. They do not require **Update AI assets** unless the separate assistance
runtime closure also changes.
