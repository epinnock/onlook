# Spectra inline-simulator handoff

Onlook's "In browser" preview tab renders a live iOS simulator on the canvas
via the Spectra testing platform. The build pipeline is the same as the
existing QR handoff — it's just consumed by a pre-installed copy of this
Mobile Client running inside a Spectra-managed simulator instead of a
physical phone scanning the QR.

For setup steps — building the `.app`, uploading to Spectra, configuring
Onlook — see [`plans/spectra-inline-simulator-runbook.md`](../../../plans/spectra-inline-simulator-runbook.md).

See also the ADR:
[`plans/adr/spectra-inline-simulator.md`](../../../plans/adr/spectra-inline-simulator.md).
