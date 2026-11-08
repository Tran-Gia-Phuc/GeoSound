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

The content follows the UC files under `docs/use case/` (updated 2026-11-08 to match the system). The XML is
generated from small JSON specs in `specs/` by `scripts/diagrams/activity-xml.mjs`:

```
node scripts/diagrams/activity-xml.mjs docs/02-design/drawio/activity/specs docs/02-design/drawio/activity
```

Edit a spec and rerun the command to regenerate a diagram (the script refuses overlapping boxes and unknown
step ids). Edits made in draw.io are lost when the file is regenerated.
