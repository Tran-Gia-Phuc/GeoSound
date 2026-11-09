#!/usr/bin/env node
// =========================================================
// Builds the GeoSound ERD (draw.io) from a structure snapshot of the real database
// (docs/02-design/drawio/erd/supabase-schema.json, made by scripts/diagrams/db-snapshot.py),
// so the diagram has exactly the tables that exist on Supabase.
//   Page 1 "ERD GeoSound": the schemas of the services (app_auth, tour, notification, moderation,
//          media, ai, ai_chat), one dashed frame per schema.
//   Page 2 "Supabase (nền tảng)": the schemas Supabase creates and manages itself (auth, storage,
//          realtime, vault); GeoSound does not use them.
//   - table = draw.io "Entity Relation" swimlane; rows "PK / FK / UK  column : type" ("?" = nullable)
//   - solid edge  = real foreign key (crow's foot)
//   - dashed edge = soft reference (an id of another service / no FK), list SOFT_REFS below
// Usage: node scripts/diagrams/erd-xml.mjs <out.xml> [snapshot.json]
// =========================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SNAPSHOT = path.join(ROOT, 'docs/02-design/drawio/erd/supabase-schema.json');

// Frame layout. x / y: a number, or "below:<schema>" / "right:<schema>" (80 px gap).
const GEOSOUND = [
  { name: 'tour', label: 'schema tour (Tour service)', x: 0, y: 0, cols: 5, fill: '#dae8fc', stroke: '#6c8ebf' },
  { name: 'app_auth', label: 'schema app_auth (Auth service)', x: -1150, y: 0, cols: 3, fill: '#d5e8d4', stroke: '#82b366' },
  { name: 'notification', label: 'schema notification (Notification)', x: -1150, y: 'below:app_auth', cols: 2, fill: '#fff2cc', stroke: '#d6b656' },
  { name: 'moderation', label: 'schema moderation (Moderation)', x: -1150, y: 'below:notification', cols: 1, fill: '#f8cecc', stroke: '#b85450' },
  { name: 'media', label: 'schema media (Media)', x: 'right:moderation', y: 'below:notification', cols: 1, fill: '#f5f5f5', stroke: '#666666' },
  { name: 'ai', label: 'schema ai (AI service, chỉ mục chatbot)', x: 0, y: 'below:tour', cols: 5, fill: '#e1d5e7', stroke: '#9673a6' },
  { name: 'ai_chat', label: 'schema ai_chat (AI service, bộ nhớ hội thoại)', x: 0, y: 'below:ai', cols: 6, fill: '#e1d5e7', stroke: '#9673a6' },
];
const SUPABASE = [
  { name: 'auth', label: 'schema auth (Supabase Auth – GeoSound không dùng, tài khoản ở app_auth)', x: 0, y: 0, cols: 6, fill: '#eeeeee', stroke: '#666666' },
  { name: 'storage', label: 'schema storage (Supabase Storage – không dùng)', x: 0, y: 'below:auth', cols: 5, fill: '#eeeeee', stroke: '#666666' },
  { name: 'realtime', label: 'schema realtime (Supabase Realtime – không dùng)', x: 'right:storage', y: 'below:auth', cols: 1, fill: '#eeeeee', stroke: '#666666' },
  { name: 'vault', label: 'schema vault (Supabase Vault – không dùng)', x: 'right:realtime', y: 'below:auth', cols: 1, fill: '#eeeeee', stroke: '#666666' },
];

const UNUSED = new Set(['notification.notifications', 'media.audio_assets']);
const LIBRARY = new Set(['ai_chat.checkpoints', 'ai_chat.checkpoint_blobs', 'ai_chat.checkpoint_writes', 'ai_chat.checkpoint_migrations']);

// Soft references: [from schema.table.column, to schema.table.column]
const SOFT_REFS = [
  ['tour.tours.author_id', 'app_auth.users.id'],
  ['tour.itineraries.owner_id', 'app_auth.users.id'],
  ['tour.tour_ratings.user_id', 'app_auth.users.id'],
  ['tour.tour_reports.reporter_id', 'app_auth.users.id'],
  ['tour.tour_access_grants.user_id', 'app_auth.users.id'],
  ['tour.tour_unlock_attempts.user_id', 'app_auth.users.id'],
  ['tour.itinerary_items.place_id', 'tour.places.id'],
  ['tour.itinerary_items.tour_id', 'tour.tours.id'],
  ['tour.tour_review_actions.tour_id', 'tour.tours.id'],
  ['tour.tour_review_actions.admin_id', 'app_auth.users.id'],
  ['tour.admin_actions.admin_id', 'app_auth.users.id'],
  ['notification.in_app_notifications.user_id', 'app_auth.users.id'],
  ['notification.in_app_notifications.tour_id', 'tour.tours.id'],
  ['moderation.moderation_cases.tour_id', 'tour.tours.id'],
  ['ai.tour_index.tour_id', 'tour.tours.id'],
  ['ai.chunks.tour_id', 'tour.tours.id'],
  ['ai_chat.checkpoints.thread_id', 'ai_chat.chat_sessions.session_id'],
  ['ai_chat.checkpoint_blobs.thread_id', 'ai_chat.chat_sessions.session_id'],
  ['ai_chat.checkpoint_writes.thread_id', 'ai_chat.chat_sessions.session_id'],
];

const shortType = (t) =>
  t
    .replace(/^extensions\./, '')
    .replace(/timestamp(\(\d+\))? with time zone/, 'timestamptz$1')
    .replace(/timestamp(\(\d+\))? without time zone/, 'timestamp$1')
    .replace('character varying', 'varchar')
    .replace('double precision', 'float8')
    .replace(/^"?auth"?\./, '')
    .replace(/^"?storage"?\./, '')
    .replace(/^"?realtime"?\./, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TABLE_W = 280;
const HEADER = 26;
const ROW = 20;
const COL_GAP = 50;
const ROW_GAP = 40;
const FRAME_PAD = 30;
const FRAME_TOP = 50;

function buildPage(snapshot, frames, { title, legend, softRefs = [] }) {
  const cells = [];
  const edges = [];
  let next = 2;
  const nid = () => String(next++);
  const rowIds = new Map();
  const done = new Map();
  const resolve = (v) => {
    if (typeof v === 'number') return v;
    const [kind, ref] = v.split(':');
    const f = done.get(ref);
    return kind === 'below' ? f.y + f.h + 80 : f.x + f.w + 80;
  };
  let count = 0;
  for (const base of frames) {
    const schema = { ...base, x: resolve(base.x), y: resolve(base.y) };
    const tables = Object.entries(snapshot[schema.name] ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (!tables.length) throw new Error(`ERD: schema ${schema.name} not in the snapshot`);
    count += tables.length;
    const heights = new Array(schema.cols).fill(0);
    const placed = [];
    for (const [name, t] of tables) {
      const h = HEADER + t.columns.length * ROW + 6;
      const col = heights.indexOf(Math.min(...heights));
      placed.push({ name, t, x: schema.x + FRAME_PAD + col * (TABLE_W + COL_GAP), y: schema.y + FRAME_TOP + heights[col], h });
      heights[col] += h + ROW_GAP;
    }
    const frameW = FRAME_PAD * 2 + schema.cols * TABLE_W + (schema.cols - 1) * COL_GAP;
    const frameH = FRAME_TOP + Math.max(...heights) - ROW_GAP + FRAME_PAD;
    for (const [other, f] of done) {
      if (schema.x < f.x + f.w && f.x < schema.x + frameW && schema.y < f.y + f.h && f.y < schema.y + frameH) {
        throw new Error(`ERD: frame ${schema.name} overlaps ${other}`);
      }
    }
    done.set(schema.name, { x: schema.x, y: schema.y, w: frameW, h: frameH });
    cells.push(
      `        <mxCell id="${nid()}" parent="1" style="rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=${schema.stroke};verticalAlign=top;align=left;spacingLeft=10;spacingTop=6;fontSize=16;fontStyle=1;" value="${esc(`${schema.label} – ${tables.length} bảng`)}" vertex="1">\n` +
        `          <mxGeometry x="${schema.x}" y="${schema.y}" width="${frameW}" height="${frameH}" as="geometry" />\n        </mxCell>`,
    );
    for (const { name, t, x, y, h } of placed) {
      const key = `${schema.name}.${name}`;
      const grey = UNUSED.has(key) || LIBRARY.has(key);
      const tag = UNUSED.has(key) ? ' (không dùng)' : LIBRARY.has(key) ? ' (thư viện LangGraph)' : '';
      const tid = nid();
      cells.push(
        `        <mxCell id="${tid}" parent="1" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${HEADER};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;html=1;fillColor=${grey ? '#f5f5f5' : schema.fill};strokeColor=${schema.stroke};${grey ? 'dashed=1;fontColor=#555555;' : ''}" value="${esc(name + tag)}" vertex="1">\n` +
          `          <mxGeometry x="${x}" y="${y}" width="${TABLE_W}" height="${h}" as="geometry" />\n        </mxCell>`,
      );
      const fkCols = new Set(t.fks.flatMap((f) => f.columns));
      const ukCols = new Set(t.unique.filter((u) => u.length === 1).flat());
      t.columns.forEach((c, i) => {
        const rid = nid();
        rowIds.set(`${key}.${c.name}`, rid);
        const pk = t.pk.includes(c.name);
        const keys = [pk ? 'PK' : '', fkCols.has(c.name) ? 'FK' : '', ukCols.has(c.name) && !pk ? 'UK' : ''].filter(Boolean).join(',');
        const label = `${keys ? keys + '  ' : ''}${c.name} : ${shortType(c.type)}${c.nullable ? '?' : ''}`;
        const style = pk ? 'fontStyle=1;' : fkCols.has(c.name) ? 'fontStyle=2;' : '';
        cells.push(
          `        <mxCell id="${rid}" parent="${tid}" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;${style}" value="${esc(label)}" vertex="1">\n` +
            `          <mxGeometry y="${HEADER + i * ROW}" width="${TABLE_W}" height="${ROW}" as="geometry" />\n        </mxCell>`,
        );
      });
      for (const fk of t.fks) {
        edges.push({ from: `${key}.${fk.columns[0]}`, to: `${fk.refSchema}.${fk.refTable}.${fk.refColumns[0]}`, soft: false });
      }
    }
  }
  for (const [from, to] of softRefs) edges.push({ from, to, soft: true });

  const edgeXml = [];
  for (const e of edges) {
    const s = rowIds.get(e.to); // parent side (one)
    const t = rowIds.get(e.from); // child side (many)
    if (!s || !t) {
      if (e.soft) throw new Error(`ERD soft ref ${e.from} -> ${e.to}: column not found`);
      continue; // FK into a schema drawn on the other page
    }
    const style = e.soft
      ? 'edgeStyle=entityRelationEdgeStyle;html=1;endArrow=ERmany;startArrow=ERone;endFill=0;startFill=0;dashed=1;strokeColor=#999999;'
      : 'edgeStyle=entityRelationEdgeStyle;html=1;endArrow=ERmany;startArrow=ERmandOne;endFill=0;startFill=0;';
    edgeXml.push(`        <mxCell id="${nid()}" edge="1" parent="1" source="${s}" target="${t}" style="${style}" value="">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>`);
  }

  const minX = Math.min(...[...done.values()].map((f) => f.x));
  const maxY = Math.max(...[...done.values()].map((f) => f.y + f.h));
  const titleCell = `        <mxCell id="${nid()}" parent="1" style="text;html=1;align=left;verticalAlign=middle;fontSize=36;fontStyle=1;" value="${esc(`${title} – ${count} bảng`)}" vertex="1">\n          <mxGeometry x="${minX}" y="-90" width="1400" height="60" as="geometry" />\n        </mxCell>`;
  const legendCell = `        <mxCell id="${nid()}" parent="1" style="rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fillColor=#ffffff;" value="${esc(legend)}" vertex="1">\n          <mxGeometry x="${minX}" y="${maxY + 60}" width="1000" height="130" as="geometry" />\n        </mxCell>`;
  return { xml: [titleCell, ...cells, ...edgeXml, legendCell].join('\n'), count };
}

const LEGEND_MAIN =
  '<b>Chú giải</b><br>PK = khóa chính (in đậm), FK = khóa ngoại (in nghiêng), UK = unique, "?" = cho phép null<br>' +
  'Nét liền (chân gà) = khóa ngoại thật trong database<br>' +
  'Nét đứt xám = tham chiếu mềm: id của service khác / không có FK (các service trao đổi qua RabbitMQ và HTTP, không join)<br>' +
  'Bảng xám "(không dùng)" = có trong database nhưng code chưa dùng; "(thư viện LangGraph)" = do thư viện chatbot tự tạo và quản lý<br>' +
  'Nguồn: cấu trúc thật trên Supabase (docs/02-design/drawio/erd/supabase-schema.json) – xem docs/02-design/database-tables.md';
const LEGEND_SUPABASE =
  '<b>Chú giải</b><br>Các schema này do Supabase tự tạo và quản lý (đăng nhập Supabase, lưu file, realtime, vault).<br>' +
  'GeoSound không đọc / ghi các bảng này: tài khoản nằm ở app_auth.users, file media nằm ở Media service.<br>' +
  'Nét liền = khóa ngoại thật. Nguồn: docs/02-design/drawio/erd/supabase-schema.json';

export function buildErdXml(snapshot) {
  const known = new Set([...GEOSOUND, ...SUPABASE].map((s) => s.name));
  const missing = Object.keys(snapshot).filter((s) => !known.has(s));
  if (missing.length) throw new Error(`ERD: schemas in the database but not drawn: ${missing.join(', ')}`);
  const main = buildPage(snapshot, GEOSOUND, { title: 'ERD GeoSound', legend: LEGEND_MAIN, softRefs: SOFT_REFS });
  const supa = buildPage(snapshot, SUPABASE, { title: 'Schema của nền tảng Supabase', legend: LEGEND_SUPABASE });
  const total = Object.values(snapshot).reduce((n, s) => n + Object.keys(s).length, 0);
  if (main.count + supa.count !== total) throw new Error(`ERD: drew ${main.count + supa.count} of ${total} tables`);
  const page = (name, id, body) => `  <diagram name="${esc(name)}" id="${id}">
    <mxGraphModel dx="2400" dy="1600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${body}
      </root>
    </mxGraphModel>
  </diagram>`;
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net">\n${page(`ERD GeoSound (${main.count} bảng)`, 'geosound-erd', main.xml)}\n${page(`Supabase (${supa.count} bảng)`, 'supabase-erd', supa.xml)}\n</mxfile>\n`,
    counts: { geosound: main.count, supabase: supa.count, total },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, snap = DEFAULT_SNAPSHOT] = process.argv.slice(2);
  if (!out) {
    console.error('usage: node scripts/diagrams/erd-xml.mjs <out.xml> [snapshot.json]');
    process.exit(2);
  }
  const { xml, counts } = buildErdXml(JSON.parse(fs.readFileSync(snap, 'utf8')));
  fs.writeFileSync(out, xml);
  console.log(`ERD: ${out} – GeoSound ${counts.geosound} + Supabase ${counts.supabase} = ${counts.total} tables`);
}
