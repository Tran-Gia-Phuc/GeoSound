# Activity diagrams of the use cases, English version (draw.io)

English copy of [../activity/](../activity/README.md): same 25 diagrams (`UC01-activity.xml` to
`UC25-activity.xml`), same layout rules, with every box translated to English. Open a file in
<https://app.diagrams.net> (File → Import from → Device) and export as PNG / PDF.

The XML is generated from the English specs in `specs/` by the same script:

```
node scripts/diagrams/activity-xml.mjs docs/02-design/drawio/activity-en/specs docs/02-design/drawio/activity-en
```

The Vietnamese specs in `../activity/specs/` stay the source of truth: when one changes, update the
matching English spec here and regenerate.
