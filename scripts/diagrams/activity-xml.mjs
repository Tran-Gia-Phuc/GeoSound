#!/usr/bin/env node
// =========================================================
// Builds draw.io activity diagrams (mxfile XML) of the use cases from small JSON specs.
// Same look as the team template (docs/02-design/drawio/activity/README.md):
//   - title "UCnn" top left, start and end circles (shape=endState), main flow in the middle column;
//   - action = rounded box (220 wide), decision = rhombus (320 wide), "yes" goes down;
//   - exceptions (E*) in a column on the right: "no" edge from the decision to the exception,
//     then back to the step it returns to (or to the end);
//   - alternatives (A*) in columns on the left: edge from the step to the first box, chain down,
//     then into the step it continues at (or the end).
// Usage: node scripts/diagrams/activity-xml.mjs <specs-dir> <out-dir>
// Spec: { "uc": "UC10", "title"?: "…", "steps": [Step], "alts": [Alt] }
//   Step = { "id": "s1", "text": "1. …", "decision"?: bool, "exceptions"?: [{ "id": "E1", "text": "E1. …", "back": "s2" | "end" }],
//            "alts"?: ["A1"] }
//   Alt  = { "id": "A1", "steps": ["A1.1. …", "A1.2. …"], "to": "s4" | "end" }
// =========================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTION = 'whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;rounded=1;';
const DECISION = 'rhombus;whiteSpace=wrap;html=1;shapeInside=1;fillColor=#FFFFFF;strokeColor=#000000;rounded=1;';
const CIRCLE = 'ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#ff0000;';
const EDGE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;';
const TITLE = 'text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;rounded=0;';

const GAP = 60; // vertical gap in the main column
const MAIN_X = { action: -110, decision: -160 };
const EXC_X = 355;
const EXC_W = 250;
const ALT_W = 220;
const ALT_GAP = 50;
const altColumnX = (i) => -510 - 400 * i;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lines(text, perLine) {
  return String(text)
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0);
}
const actionHeight = (text, width = 220) => Math.max(60, lines(text, Math.floor(width / 7.2)) * 15 + 30);
const decisionHeight = (text) => Math.max(110, lines(text, 26) * 15 + 70);

const sides = {
  left: 'exitX=0;exitY=0.5;exitDx=0;exitDy=0;',
  right: 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;',
  bottom: 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;',
};
const entries = {
  top: 'entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
  left: 'entryX=0;entryY=0.5;entryDx=0;entryDy=0;',
  right: 'entryX=1;entryY=0.5;entryDx=0;entryDy=0;',
  bottom: 'entryX=0.5;entryY=1;entryDx=0;entryDy=0;',
};

export function buildActivityXml(spec) {
  const cells = [];
  let next = 2;
  const id = () => String(next++);
  const vertex = (style, value, x, y, w, h) => {
    const cid = id();
    cells.push(
      `        <mxCell id="${cid}" parent="1" style="${style}" value="${esc(value)}" vertex="1">\n` +
        `          <mxGeometry height="${Math.round(h)}" width="${w}" x="${Math.round(x)}" y="${Math.round(y)}" as="geometry" />\n` +
        `        </mxCell>`,
    );
    return { id: cid, x, y, w, h };
  };
  const edges = [];
  const edge = (source, target, { exit = '', entry = '', label = '' } = {}) => edges.push({ source, target, exit, entry, label });

  const stepCount = spec.steps.length;
  const altCount = (spec.alts ?? []).length;
  const titleX = altCount ? altColumnX(altCount - 1) : -510;
  vertex(TITLE, `<font style="font-size: 48px;">${spec.uc}</font>`, Math.min(titleX, -910), -110, 120, 60);

  // ---- main column ----
  const start = vertex(CIRCLE, '', -20, 0, 40, 40);
  let y = 90;
  const byId = new Map();
  let prev = start;
  let prevWasDecision = false;
  for (const step of spec.steps) {
    const h = step.decision ? decisionHeight(step.text) : actionHeight(step.text);
    const w = step.decision ? 320 : 220;
    const node = vertex(step.decision ? DECISION : ACTION, step.text, step.decision ? MAIN_X.decision : MAIN_X.action, y, w, h);
    byId.set(step.id, { ...node, step });
    edge(prev.id, node.id, { label: prevWasDecision ? 'yes' : '' });
    prev = node;
    prevWasDecision = !!step.decision;
    y += h + GAP;
  }
  const end = vertex(CIRCLE, '', -20, y + 30, 40, 40);
  edge(prev.id, end.id, { label: prevWasDecision ? 'yes' : '' });
  if (!stepCount) throw new Error(`${spec.uc}: no steps`);

  const target = (ref) => (ref === 'end' || !ref ? end : byId.get(ref));

  // ---- exceptions (right column) ----
  let excCursor = 90;
  for (const step of spec.steps) {
    const origin = byId.get(step.id);
    for (const exc of step.exceptions ?? []) {
      const h = actionHeight(exc.text, EXC_W);
      const ey = Math.max(excCursor, origin.y + origin.h / 2 - h - 10);
      const box = vertex(ACTION, exc.text, EXC_X, ey, EXC_W, h);
      excCursor = ey + h + 30;
      edge(origin.id, box.id, { exit: sides.right, entry: entries.bottom, label: step.decision ? 'no' : '' });
      const back = target(exc.back);
      if (!back) throw new Error(`${spec.uc} ${exc.id}: unknown back step ${exc.back}`);
      edge(box.id, back.id, { exit: sides.left, entry: entries.right });
    }
  }

  // ---- alternatives (left columns) ----
  (spec.alts ?? []).forEach((alt, i) => {
    const owner = spec.steps.find((s) => (s.alts ?? []).includes(alt.id));
    if (!owner) throw new Error(`${spec.uc} ${alt.id}: no step lists it`);
    const origin = byId.get(owner.id);
    const x = altColumnX(i);
    let ay = origin.y + origin.h + 30;
    let first = null;
    let last = null;
    for (const text of alt.steps) {
      const h = actionHeight(text, ALT_W);
      const box = vertex(ACTION, text, x, ay, ALT_W, h);
      if (!first) first = box;
      if (last) edge(last.id, box.id);
      last = box;
      ay += h + ALT_GAP;
    }
    edge(origin.id, first.id, { exit: sides.left, entry: entries.top, label: owner.decision ? 'no' : '' });
    const to = target(alt.to);
    if (!to) throw new Error(`${spec.uc} ${alt.id}: unknown target ${alt.to}`);
    edge(last.id, to.id, to === end ? { exit: sides.bottom, entry: entries.left } : { exit: sides.right, entry: entries.left });
  });

  // Layout check: no two boxes may overlap (reported, never silently drawn on top of each other).
  const boxes = cells.map((c) => {
    const g = c.match(/height="(\d+)" width="(\d+)" x="(-?\d+)" y="(-?\d+)"/);
    return { id: c.match(/id="(\d+)"/)[1], h: +g[1], w: +g[2], x: +g[3], y: +g[4] };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        throw new Error(`${spec.uc}: cells ${a.id} and ${b.id} overlap`);
      }
    }
  }

  const edgeXml = edges.map(
    (e) =>
      `        <mxCell id="${id()}" edge="1" parent="1" source="${e.source}" style="${EDGE}${e.exit}${e.entry}" target="${e.target}" value="${esc(e.label)}">\n` +
        `          <mxGeometry relative="1" as="geometry" />\n` +
        `        </mxCell>`,
  );

  const diagramId = `${spec.uc.toLowerCase()}-activity`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram name="Trang-1" id="${diagramId}">
    <mxGraphModel dx="5475" dy="2875" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${[...cells, ...edgeXml].join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specDir, outDir] = process.argv.slice(2);
  if (!specDir || !outDir) {
    console.error('usage: node scripts/diagrams/activity-xml.mjs <specs-dir> <out-dir>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs.readdirSync(specDir).filter((f) => f.endsWith('.json')).sort()) {
    const spec = JSON.parse(fs.readFileSync(path.join(specDir, file), 'utf8'));
    const out = path.join(outDir, `${spec.uc}-activity.xml`);
    fs.writeFileSync(out, buildActivityXml(spec));
    console.log(`${spec.uc}: ${out}`);
  }
}
