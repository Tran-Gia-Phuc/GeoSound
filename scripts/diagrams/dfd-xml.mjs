#!/usr/bin/env node
// =========================================================
// Builds draw.io data flow diagrams (DFD, Yourdon/DeMarco notation) from JSON specs.
//   - entity  : external entity, rectangle (a "*" in the label marks a duplicate drawn twice)
//   - process : circle "n.m / name"; "ghost" = a process of another level shown for context (dashed)
//   - store   : data store, open rectangle "Dn | name"; "tables": ["schema.table", ...] lists the real
//               database tables it stands for (second line, small font)
//   - flow    : labelled straight arrow; two flows between the same pair are bowed apart
// Spec: { "pages": [{ "name", "title", "nodes": [{ "id", "kind", "label", "x", "y", "w"?, "h"? }],
//          "flows": [{ "from", "to", "label", "via"?: [[x, y], ...], "bow"?: px, "labelAt"?: -1..1 }] }] }
//   "via" = waypoints for a flow that must go around other nodes (drawn as a polyline).
// Optional top-level "tableCheck": { "snapshot": "<path from repo root>", "schemas": [...] }: on every page with
// "checkTables": true, the stores must cover each table of those schemas exactly once.
// The script refuses overlapping nodes and lists flows whose straight line crosses another node.
// Usage: node scripts/diagrams/dfd-xml.mjs <spec.json> <out.xml>
// =========================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = { entity: [190, 80], process: [160, 160], ghost: [140, 140], store: [240, 50] };
const STYLE = {
  entity: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;',
  process: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#d5e8d4;strokeColor=#82b366;',
  ghost: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#f5f5f5;strokeColor=#666666;dashed=1;fontColor=#333333;',
  store: 'shape=partialRectangle;whiteSpace=wrap;html=1;left=0;right=0;fillColor=#fff2cc;strokeColor=#d6b656;align=left;spacingLeft=8;',
};
const FLOW = 'html=1;endArrow=block;endFill=1;fontSize=11;labelBackgroundColor=#ffffff;';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function nodeValue(n) {
  if (n.kind === 'store') {
    const [code, ...rest] = n.label.split('|');
    const head = `<b>${code.trim()}</b>&nbsp;&nbsp;│&nbsp;&nbsp;${rest.join('|').trim()}`;
    return n.tables?.length
      ? `${head}<br><font style="font-size: 10px; color: #555555;">${n.tables.map((t) => (n.unused?.includes(t) ? `${t} (không dùng)` : t)).join(', ')}</font>`
      : head;
  }
  if (n.kind === 'process' || n.kind === 'ghost') {
    const [num, ...rest] = n.label.split('|');
    return `<b>${num.trim()}</b><br>${rest.join('|').trim()}`;
  }
  return n.label;
}

/** Does segment p-q cross rectangle r (shrunk a little so touching edges do not count)? */
function segmentHitsRect(p, q, r) {
  const pad = 4;
  const x1 = r.x + pad, y1 = r.y + pad, x2 = r.x + r.w - pad, y2 = r.y + r.h - pad;
  const steps = 60;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = p.x + (q.x - p.x) * t;
    const y = p.y + (q.y - p.y) * t;
    if (x > x1 && x < x2 && y > y1 && y < y2) return true;
  }
  return false;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Stores of a page must cover every table of the checked schemas exactly once. */
function checkTables(spec, page) {
  const { snapshot, schemas } = spec.tableCheck;
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, snapshot), 'utf8'));
  const expected = new Set(schemas.flatMap((s) => Object.keys(db[s] ?? {}).map((t) => `${s}.${t}`)));
  const seen = new Map();
  for (const n of page.nodes.filter((x) => x.kind === 'store')) {
    for (const t of n.tables ?? []) {
      if (seen.has(t)) throw new Error(`${page.name}: table ${t} is in ${seen.get(t)} and ${n.id}`);
      seen.set(t, n.id);
    }
  }
  const missing = [...expected].filter((t) => !seen.has(t));
  const unknown = [...seen.keys()].filter((t) => !expected.has(t));
  if (missing.length || unknown.length) {
    throw new Error(`${page.name}: stores do not match the database. Missing: ${missing.join(', ') || '-'}; unknown: ${unknown.join(', ') || '-'}`);
  }
  return expected.size;
}

export function buildDfdXml(spec, { warn = console.warn } = {}) {
  const diagrams = spec.pages.map((page, pi) => {
    if (page.checkTables) checkTables(spec, page);
    const cells = [];
    let next = 2;
    const nid = () => String(next++);
    const nodes = new Map();
    for (const n of page.nodes) {
      const [w, h] = [n.w ?? SIZE[n.kind][0], n.h ?? SIZE[n.kind][1]];
      const id = nid();
      nodes.set(n.id, { ...n, cid: id, w, h, cx: n.x + w / 2, cy: n.y + h / 2 });
      cells.push(
        `        <mxCell id="${id}" parent="1" style="${STYLE[n.kind]}" value="${esc(nodeValue(n))}" vertex="1">\n` +
          `          <mxGeometry x="${n.x}" y="${n.y}" width="${w}" height="${h}" as="geometry" />\n        </mxCell>`,
      );
    }
    const list = [...nodes.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          throw new Error(`${page.name}: nodes ${a.id} and ${b.id} overlap`);
        }
      }
    }
    if (page.title) {
      const minX = Math.min(...list.map((n) => n.x));
      const minY = Math.min(...list.map((n) => n.y));
      cells.unshift(
        `        <mxCell id="${nid()}" parent="1" style="text;html=1;align=left;verticalAlign=middle;fontSize=28;fontStyle=1;" value="${esc(page.title)}" vertex="1">\n` +
          `          <mxGeometry x="${minX}" y="${minY - 90}" width="900" height="50" as="geometry" />\n        </mxCell>`,
      );
    }
    const pairs = new Set(page.flows.map((f) => `${f.from}>${f.to}`));
    for (const f of page.flows) {
      const a = nodes.get(f.from), b = nodes.get(f.to);
      if (!a || !b) throw new Error(`${page.name}: flow ${f.from} -> ${f.to}: unknown node`);
      const path = [{ x: a.cx, y: a.cy }, ...(f.via ?? []).map(([x, y]) => ({ x, y })), { x: b.cx, y: b.cy }];
      const crossed = list.filter((n) => n !== a && n !== b && path.slice(1).some((q, i) => segmentHitsRect(path[i], q, n)));
      if (crossed.length) warn(`${page.name}: flow ${f.from} -> ${f.to} crosses ${crossed.map((n) => n.id).join(', ')}`);
      let points = '';
      // Two opposite flows: each label sits nearer its own source so the labels do not overlap.
      const labelAt = f.labelAt ?? (pairs.has(`${f.to}>${f.from}`) && !f.via ? -0.35 : 0);
      if (f.via?.length) {
        points = `
            <Array as="points">${f.via.map(([x, y]) => `<mxPoint x="${x}" y="${y}" />`).join('')}</Array>`;
      } else if (pairs.has(`${f.to}>${f.from}`)) {
        // bow the two opposite flows apart
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const len = Math.hypot(dx, dy) || 1;
        const off = f.bow ?? 45;
        const mx = (a.cx + b.cx) / 2 + (-dy / len) * off;
        const my = (a.cy + b.cy) / 2 + (dx / len) * off;
        points = `\n            <Array as="points"><mxPoint x="${Math.round(mx)}" y="${Math.round(my)}" /></Array>`;
      }
      cells.push(
        `        <mxCell id="${nid()}" edge="1" parent="1" source="${a.cid}" target="${b.cid}" style="${FLOW}${points && !f.via ? 'curved=1;' : ''}" value="${esc(f.label)}">\n` +
          `          <mxGeometry ${labelAt ? `x="${labelAt}" ` : ''}relative="1" as="geometry">${points}\n          </mxGeometry>\n        </mxCell>`,
      );
    }
    return `  <diagram name="${esc(page.name)}" id="dfd-${pi}">
    <mxGraphModel dx="2400" dy="1600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net">\n${diagrams.join('\n')}\n</mxfile>\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specFile, out] = process.argv.slice(2);
  if (!specFile || !out) {
    console.error('usage: node scripts/diagrams/dfd-xml.mjs <spec.json> <out.xml>');
    process.exit(2);
  }
  fs.writeFileSync(out, buildDfdXml(JSON.parse(fs.readFileSync(specFile, 'utf8'))));
  console.log(`DFD: ${out}`);
}
