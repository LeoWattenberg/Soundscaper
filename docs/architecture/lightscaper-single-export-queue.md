# Single-photo background export

The File menu's PNG and JPEG entries create one single-photo export owner. Save
prepares its destination in the original user gesture and uses the existing
full-resolution renderer, encoder and delivery controller. Hiding the queue
keeps that owner mounted. File > Export queue reopens the same job, including
its captured settings, progress, completed image receipt and JSON sidecar
outcome. Reopening does not select another destination or render the image again.

Hide queue and dialog dismissal hide presentation. Explicit cancellation or
Close retires the job and joins destination preparation, active delivery and
controller cleanup. Catalog replacement, restore and unmount use the same
registered retirement before releasing original storage. Completion while
hidden can retain an acknowledged image receipt; it cannot reopen presentation.

An incomplete JSON sidecar retains the acknowledged image outcome. Reopening
offers JSON-only retry through the original controller. It does not repeat the
raster render, image save or original destination picker.

Menu admission checks the synchronous current entry, preventing two retained
events from creating competing jobs before React renders. Entry actions bind
to the captured job key and library generation. Visible controls also bind to
their current presentation; retained Save, retry, preset and Close handlers
cannot launch work while hidden or modify a replacement job. Asynchronous
delivery acknowledgments remain independent of presentation visibility.

This is a same-run queue. It does not claim single-photo recovery after reload
or process death. Batch export retains its separately journaled recovery path.
No assistance runtime source, recipe, dependency, target or archive closure
changes; a manual **Update AI assets** run is not required.
