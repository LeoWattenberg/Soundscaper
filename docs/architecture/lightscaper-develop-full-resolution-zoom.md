# Full-resolution Develop inspection

File > Photo > Develop starts with a fit-screen proxy. The existing
Settings menu offers Full resolution (100%) and Fit-screen proxy. Full
resolution displays the developed output at one CSS pixel per image pixel;
its focusable viewport supports keyboard scrolling. Before/after and split
retain their existing controls. A split viewport uses the developed natural
extent and contains the source in that extent, including its existing
letterboxing when geometry changes the aspect ratio.

The selected Session's optional `develop.original` capability lends an
authenticated, oriented original frame only during its consumer. A request
binds the expected photo revision. The owner checks the complete immutable
original binding and revision after body loading, before delivery and after
the consumer settles and after decoder retirement. A stale read refuses before
native decoding. The existing original-frame owner verifies compressed bytes, digest and EXIF
orientation and clears every temporary backing after settlement.

Full-resolution processing uses the same ordered shared-effect and natural
geometry owner as the proxy. Its separate fixed profile admits UNORM8 sRGB
source frames up to 8192 pixels per side, 16,777,216 pixels and 64 MiB.
Natural outputs may reach 16,384 pixels per side, 67,108,864 pixels and
256 MiB. Admission precedes allocation. These per-frame limits are separate
from measured latency and total working-set budgets; derivative limits stay
at 2048-source/4096-output sides and 16/32 MiB.

The Current editor's [native proxy owner](lightscaper-native-proxy.md) retains
word/float sample precision while reducing the Original before adjustments.
Its native proxy profile permits 64 MiB of source and 128 MiB of natural render
storage at the same pixel/side limits. Proxy spatial and repair operations use
the proxy grid with the unchanged saved recipe; Full inspection uses the
natural-resolution grid.
Current native Full processing admits 8192 pixels per side, 16,777,216 pixels
and 256 MiB per source or rendered plane, subject to its separate 768-MiB
aggregate processing budget.

Presentation retains scalar histograms and extents. Source, stage and native
canvas backings have separate lifetimes. Changing resolution, photo,
settings or revision joins the preceding consumer before starting another
read; cancellation and cleanup failures keep that ownership fence. Closing
the Session joins held original reads. Ready presentation follows the
original reader's final revision check and backing retirement; a refused
check clears both painted canvases. Resolution is presentation state:
it creates no settings, history, snapshot, version, metadata or original
write, and reopening starts with the fit-screen proxy.

Current Settings → Preview rendering can temporarily prefer GPU for admitted
native white balance, tone, chroma, black-and-white mix, HSL, point/parametric
curves and wheels in either resolution. Their recorded local software-GPU
corpus passed. Authenticated cube LUTs are qualified in both resolutions by the
recorded local software-GPU and Firefox corpus. Their bodies authenticate before
GL; private Double sampling remains independent of the rounded upload, and the stable
Original is never reopened during CPU fallback. Native geometry passes the
recorded local software-GPU and Firefox corpus for proxy and Full. Legacy geometry stays
first and authored geometry stays in order; each viewport and the final readback
follow the admitted natural descriptor. Integer inverse sampling and generic
four-tap premultiplied filtering retain the CPU alpha/hidden-RGB rules.
Native pointwise readback must pass its streamed CPU conformance check;
geometry readback instead uses the existing CPU writers in up to two
maximum-extent reference planes, with exact output alpha and unchanged precision
guards. Both paths finish validation before delivery. An unchanged identity-curve channel can
legitimately select the complete CPU route on a small rounding difference.
The CPU mapper's own coordinate drift can likewise require CPU for an integer
geometry request. Reference planes, changing texture extents, LUT resources and
presentation all enter the existing 768-MiB phase plan; no bound is widened.
CPU remains the default, unsupported complete stacks use CPU, and the renderer
preference resets on reopening. The choice does not change saved settings,
history, exports or Original custody. Complete GPU stack coverage and native
conformance remain unfinished.
