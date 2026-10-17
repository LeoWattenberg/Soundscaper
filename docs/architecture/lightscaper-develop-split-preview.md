# Develop split preview

File > Photo > Develop keeps Before / after as its initial preview. The existing
Preview view selector also offers Split view. Only that selected view shows the
divider control; its native slider supports pointer input and keyboard Home,
End and arrow keys, over the full zero-to-one-hundred-percent range.

The two existing source and developed canvases occupy the same viewport.
The original shows to the left of the divider and the developed result to its
right. Each image fits inside that viewport without changing its aspect ratio.
The viewport uses the developed image's dimensions. A crop or perspective
operation may therefore leave letterboxing in the original half; this compares
the two complete frames rather than registering cropped source coordinates.
Both existing RGB histograms and low/high clipping counts remain available.

Selecting a view or moving the divider changes presentation only. It neither
reads another preview nor loads another runtime, alters Develop settings,
creates a history entry, stores a photo, nor allocates another canvas or pixel
backing. The divider position survives switching views of the same photo.
Opening another photo or replacing the presentation owner resets the view and
divider. Retired controls cannot change the replacement view.
Replacing the preview reader, renderer loader or retirement barrier joins the
predecessor's held work and canvas cleanup before the new owner starts. A failed
cleanup refuses that replacement and exposes only the stable preview failure.

The presentation owner publishes only immutable scalar source/output dimensions
alongside its existing histograms, after both canvas paintings complete. Pending,
failed, missing and retired views clear those dimensions. Existing cancellation,
body authentication, one-operation ownership, and backing cleanup still apply.

Focused Node tests cover explicit selection, default absence, endpoint values,
stable canvas identity, bounded admission, retired handlers, detached dimensions
and joined cancellation. The English/German browser workflow samples the actual
composited screen on both sides of the divider, exercises keyboard endpoints,
checks differing crop dimensions, and verifies source/settings persistence.
The browser workflow and combined build/full gates require a fresh committed
source qualification; focused tests do not establish those broader results.

This slice changes no assistance engine closure. A manual **Update AI assets**
run is not required.
