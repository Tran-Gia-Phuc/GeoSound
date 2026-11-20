# Activity diagrams of the use cases (draw.io)

One file per use case, `UCnn-activity.xml`, in the team's draw.io format: open it in
<https://app.diagrams.net> (File → Import from → Device, or drag the file in) and export as PNG / PDF.

Reading the diagrams:

- Start and end: black circles. Main flow (Basic Course of Events) in the middle column, top to bottom.
- Rounded box = action; rhombus = check. A check continues down on **yes**; on **no** it goes to an
  exception or an alternative.
- Exceptions (E*) on the right, with an arrow back to the step the user returns to (or to the end).
- Alternatives (A*) in columns on the left, with an arrow into the step where the main flow continues
  (or to the end).

The content follows the Focused use case specs of the PRD
([../../../01-requirements/GeoSound-PRD.docx](../../../01-requirements/GeoSound-PRD.docx), section 2.3, as of
2026-11-16): one main-flow box per Basic Course step, one box per alternative step, one box per exception. UC25 (tour payment, added 2026-11-18, not in that PRD) and the UC03 paid-tour exception E7
follow [`../../../use case/lam-sau/UC25-mua-tour-thanh-toan.md`](../../../use%20case/lam-sau/UC25-mua-tour-thanh-toan.md). The XML is
generated from small JSON specs in `specs/` by `scripts/diagrams/activity-xml.mjs`:

```
node scripts/diagrams/activity-xml.mjs docs/02-design/drawio/activity/specs docs/02-design/drawio/activity
```

Edit a spec and rerun the command to regenerate a diagram (the script refuses overlapping boxes and unknown
step ids). Edits made in draw.io are lost when the file is regenerated.
