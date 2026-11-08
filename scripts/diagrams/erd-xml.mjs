#!/usr/bin/env node
// =========================================================
// Builds the GeoSound ERD as a draw.io file straight from the Prisma schemas
// (services/<svc>/prisma/schema.prisma) plus the two ai_chat tables made by
// services/ai/app/chatbot/memory.py. One dashed frame per database schema.
//   - table = draw.io "Entity Relation" swimlane; rows "PK / FK / UK  column : type" ("?" = nullable)
//   - solid edge   = foreign key inside one schema (crow's foot)
//   - dashed edge  = soft reference (an id of another service / no FK), list SOFT_REFS below
// Usage: node scripts/diagrams/erd-xml.mjs <out.xml>
// =========================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// schema -> { prisma file, frame position, columns in the frame, colour }
const SCHEMAS = [
  { name: 'tour', label: 'schema tour (Tour service)', file: 'services/tour/prisma/schema.prisma', x: 0, y: 0, cols: 5, fill: '#dae8fc', stroke: '#6c8ebf' },
  { name: 'auth', label: 'schema auth (Auth service)', file: 'services/auth/prisma/schema.prisma', x: -1150, y: 0, cols: 3, fill: '#d5e8d4', stroke: '#82b366' },
  { name: 'notification', label: 'schema notification (Notification)', file: 'services/notification/prisma/schema.prisma', x: -1150, y: 'below:auth', cols: 2, fill: '#fff2cc', stroke: '#d6b656' },
  { name: 'moderation', label: 'schema moderation (Moderation)', file: 'services/moderation/prisma/schema.prisma', x: -1150, y: 'below:notification', cols: 1, fill: '#f8cecc', stroke: '#b85450' },
  { name: 'media', label: 'schema media (Media)', file: 'services/media/prisma/schema.prisma', x: 'right:moderation', y: 'below:notification', cols: 1, fill: '#f5f5f5', stroke: '#666666' },
  { name: 'ai', label: 'schema ai (AI service, chatbot index)', file: 'services/ai/prisma/schema.prisma', x: 0, y: 'below:tour', cols: 5, fill: '#e1d5e7', stroke: '#9673a6' },
  { name: 'ai_chat', label: 'schema ai_chat (AI service, chat memory)', file: null, x: 'right:ai', y: 'below:tour', cols: 2, fill: '#e1d5e7', stroke: '#9673a6' },
];

const UNUSED = new Set(['notification.notifications', 'media.audio_assets']);

// Soft references: [from table.column, to table.column]
const SOFT_REFS = [
  ['tour.tours.author_id', 'auth.users.id'],
  ['tour.itineraries.owner_id', 'auth.users.id'],
  ['tour.tour_ratings.user_id', 'auth.users.id'],
  ['tour.tour_reports.reporter_id', 'auth.users.id'],
  ['tour.tour_access_grants.user_id', 'auth.users.id'],
  ['tour.tour_unlock_attempts.user_id', 'auth.users.id'],
  ['tour.itinerary_items.place_id', 'tour.places.id'],
  ['tour.itinerary_items.tour_id', 'tour.tours.id'],
  ['tour.tour_review_actions.tour_id', 'tour.tours.id'],
  ['tour.tour_review_actions.admin_id', 'auth.users.id'],
  ['tour.admin_actions.admin_id', 'auth.users.id'],
  ['notification.in_app_notifications.user_id', 'auth.users.id'],
  ['notification.in_app_notifications.tour_id', 'tour.tours.id'],
  ['moderation.moderation_cases.tour_id', 'tour.tours.id'],
  ['ai.tour_index.tour_id', 'tour.tours.id'],
  ['ai.chunks.tour_id', 'tour.tours.id'],
];

const AI_CHAT = [
  {
    name: 'chat_sessions',
    columns: [
      { name: 'session_id', type: 'text', pk: true },
      { name: 'last_active_at', type: 'timestamptz' },
    ],
  },
  {
    name: 'chat_messages',
    columns: [
      { name: 'session_id', type: 'text', pk: true, fk: 'chat_sessions.session_id' },
      { name: 'message_id', type: 'text', pk: true },
      { name: 'role', type: 'text' },
      { name: 'at', type: 'timestamptz' },
      { name: 'citations', type: 'jsonb', optional: true },
    ],
  },
];

const SCALAR = { String: 'varchar', Int: 'int', Float: 'float', Boolean: 'bool', DateTime: 'timestamp', Json: 'json' };

/** Prisma schema text -> [{ name (table), model, columns: [{ name, type, pk, uk, optional, fk? }] }] */
export function parsePrisma(text) {
  const models = [...text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(models.map((m) => m[1]));
  const tables = new Map();
  for (const [, model, body] of models) {
    const lines = body.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
    const table = { model, name: (body.match(/@@map\("([^"]+)"\)/) || [])[1] ?? model, columns: [], relations: [] };
    const fieldToColumn = new Map();
    for (const line of lines) {
      if (line.startsWith('@@')) continue;
      const m = line.match(/^(\w+)\s+([\w.]+(?:\([^)]*\))?)(\[\])?(\?)?\s*(.*)$/);
      if (!m) continue;
      const [, field, rawType, isList, optional, attrs] = m;
      const baseType = rawType.replace(/\(.*$/, '');
      if (modelNames.has(baseType)) {
        const rel = attrs.match(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/);
        if (rel && !isList) table.relations.push({ fields: rel[1].split(',').map((s) => s.trim()), model: baseType, refs: rel[2].split(',').map((s) => s.trim()) });
        continue;
      }
      let type = SCALAR[baseType] ?? baseType.toLowerCase();
      if (baseType === 'Unsupported') type = (rawType.match(/vector\((\d+)\)/) ? `vector(${rawType.match(/vector\((\d+)\)/)[1]})` : 'unsupported');
      if (/@db\.Date\b/.test(attrs)) type = 'date';
      if (/@db\.Timestamptz/.test(attrs)) type = 'timestamptz';
      if (/@db\.SmallInt/.test(attrs)) type = 'smallint';
      if (baseType === 'String' && /@default\(uuid\(\)\)/.test(attrs)) type = 'uuid';
      const name = (attrs.match(/@map\("([^"]+)"\)/) || [])[1] ?? field;
      fieldToColumn.set(field, name);
      table.columns.push({ name, field, type, pk: /@id\b/.test(attrs), uk: /@unique\b/.test(attrs), optional: !!optional });
    }
    const compositeId = body.match(/@@id\(\[([^\]]+)\]/);
    if (compositeId) for (const f of compositeId[1].split(',').map((s) => s.trim())) {
      const col = table.columns.find((c) => c.field === f);
      if (col) col.pk = true;
    }
    table.fieldToColumn = fieldToColumn;
    tables.set(model, table);
  }
  // Resolve FK relations to column names.
  for (const table of tables.values()) {
    for (const rel of table.relations) {
      const target = tables.get(rel.model);
      rel.fields.forEach((f, i) => {
        const col = table.columns.find((c) => c.field === f);
        const refCol = target.fieldToColumn.get(rel.refs[i]) ?? rel.refs[i];
        if (col) col.fk = `${target.name}.${refCol}`;
      });
    }
  }
  return [...tables.values()].map(({ name, model, columns }) => ({ name, model, columns }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TABLE_W = 280;
const HEADER = 26;
const ROW = 20;
const COL_GAP = 50;
const ROW_GAP = 40;
const FRAME_PAD = 30;
const FRAME_TOP = 50;

export function buildErdXml() {
  const cells = [];
  const edges = [];
  let next = 2;
  const nid = () => String(next++);
  const rowIds = new Map(); // "schema.table.column" -> cell id
  const frames = [];

  const done = new Map(); // schema name -> frame {x, y, w, h}
  const resolve = (v) => {
    if (typeof v === 'number') return v;
    const [kind, ref] = v.split(':');
    const f = done.get(ref);
    return kind === 'below' ? f.y + f.h + 80 : f.x + f.w + 80;
  };
  for (const base of SCHEMAS) {
    const schema = { ...base, x: resolve(base.x), y: resolve(base.y) };
    const tables = schema.file
      ? parsePrisma(fs.readFileSync(path.join(ROOT, schema.file), 'utf8'))
      : AI_CHAT;
    // masonry: next table into the shortest column
    const heights = new Array(schema.cols).fill(0);
    const placed = [];
    for (const t of tables) {
      const h = HEADER + t.columns.length * ROW + 6;
      const col = heights.indexOf(Math.min(...heights));
      placed.push({ t, x: schema.x + FRAME_PAD + col * (TABLE_W + COL_GAP), y: schema.y + FRAME_TOP + heights[col], h });
      heights[col] += h + ROW_GAP;
    }
    const frameW = FRAME_PAD * 2 + schema.cols * TABLE_W + (schema.cols - 1) * COL_GAP;
    const frameH = FRAME_TOP + Math.max(...heights) - ROW_GAP + FRAME_PAD;
    frames.push({ schema, w: frameW, h: frameH });
    for (const [other, f] of done) {
      if (schema.x < f.x + f.w && f.x < schema.x + frameW && schema.y < f.y + f.h && f.y < schema.y + frameH) {
        throw new Error(`ERD: frame ${schema.name} overlaps ${other}`);
      }
    }
    done.set(schema.name, { x: schema.x, y: schema.y, w: frameW, h: frameH });
    cells.push(
      `        <mxCell id="${nid()}" parent="1" style="rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=${schema.stroke};verticalAlign=top;align=left;spacingLeft=10;spacingTop=6;fontSize=16;fontStyle=1;" value="${esc(schema.label)}" vertex="1">\n` +
        `          <mxGeometry x="${schema.x}" y="${schema.y}" width="${frameW}" height="${frameH}" as="geometry" />\n        </mxCell>`,
    );
    for (const { t, x, y, h } of placed) {
      const tid = nid();
      const unused = UNUSED.has(`${schema.name}.${t.name}`);
      const title = unused ? `${t.name} (không dùng)` : t.name;
      cells.push(
        `        <mxCell id="${tid}" parent="1" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${HEADER};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;html=1;fillColor=${unused ? '#f5f5f5' : schema.fill};strokeColor=${schema.stroke};${unused ? 'dashed=1;fontColor=#666666;' : ''}" value="${esc(title)}" vertex="1">\n` +
          `          <mxGeometry x="${x}" y="${y}" width="${TABLE_W}" height="${h}" as="geometry" />\n        </mxCell>`,
      );
      t.columns.forEach((c, i) => {
        const rid = nid();
        rowIds.set(`${schema.name}.${t.name}.${c.name}`, rid);
        const keys = [c.pk ? 'PK' : '', c.fk ? 'FK' : '', c.uk && !c.pk ? 'UK' : ''].filter(Boolean).join(',');
        const label = `${keys ? keys + '  ' : ''}${c.name} : ${c.type}${c.optional ? '?' : ''}`;
        const bold = c.pk ? 'fontStyle=1;' : c.fk ? 'fontStyle=2;' : '';
        cells.push(
          `        <mxCell id="${rid}" parent="${tid}" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;${bold}" value="${esc(label)}" vertex="1">\n` +
            `          <mxGeometry y="${HEADER + i * ROW}" width="${TABLE_W}" height="${ROW}" as="geometry" />\n        </mxCell>`,
        );
        if (c.fk) edges.push({ from: `${schema.name}.${t.name}.${c.name}`, to: `${schema.name}.${c.fk}`, soft: false });
      });
    }
  }
  for (const [from, to] of SOFT_REFS) edges.push({ from, to, soft: true });

  const edgeXml = edges.map((e) => {
    const s = rowIds.get(e.to); // parent side (one)
    const t = rowIds.get(e.from); // child side (many)
    if (!s || !t) throw new Error(`ERD edge ${e.from} -> ${e.to}: column not found`);
    const style = e.soft
      ? 'edgeStyle=entityRelationEdgeStyle;html=1;endArrow=ERmany;startArrow=ERone;endFill=0;startFill=0;dashed=1;strokeColor=#999999;'
      : 'edgeStyle=entityRelationEdgeStyle;html=1;endArrow=ERmany;startArrow=ERmandOne;endFill=0;startFill=0;';
    return `        <mxCell id="${nid()}" edge="1" parent="1" source="${s}" target="${t}" style="${style}" value="">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>`;
  });

  // Legend
  const lx = -1150;
  const ly = Math.max(...frames.map((f) => f.schema.y + f.h)) + 60;
  const legend = `        <mxCell id="${nid()}" parent="1" style="rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fillColor=#ffffff;" value="${esc(
    '<b>Chú giải</b><br>PK = khóa chính (in đậm), FK = khóa ngoại (in nghiêng), UK = unique, "?" = cho phép null<br>' +
      'Nét liền (chân gà) = khóa ngoại thật trong cùng schema<br>' +
      'Nét đứt xám = tham chiếu mềm: id của service khác / không có FK (dịch vụ trao đổi qua RabbitMQ và HTTP, không join)<br>' +
      'Bảng xám "(không dùng)" = có khai báo nhưng code chưa dùng<br>' +
      'Nguồn: services/*/prisma/schema.prisma và services/ai/app/chatbot/memory.py — docs/02-design/database-tables.md',
  )}" vertex="1">\n          <mxGeometry x="${lx}" y="${ly}" width="900" height="120" as="geometry" />\n        </mxCell>`;
  const title = `        <mxCell id="${nid()}" parent="1" style="text;html=1;align=left;verticalAlign=middle;fontSize=36;fontStyle=1;" value="ERD GeoSound" vertex="1">\n          <mxGeometry x="-1150" y="-90" width="500" height="60" as="geometry" />\n        </mxCell>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram name="ERD" id="geosound-erd">
    <mxGraphModel dx="2400" dy="1600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${[title, ...cells, ...edgeXml, legend].join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node scripts/diagrams/erd-xml.mjs <out.xml>');
    process.exit(2);
  }
  fs.writeFileSync(out, buildErdXml());
  console.log(`ERD: ${out}`);
}
