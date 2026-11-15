# Dumps the structure (schemas, tables, columns, PK, unique, FK) of the GeoSound database as JSON.
# Structure only: no rows, no connection string. Run inside the AI container, which already has the URL:
#   docker compose exec -T ai python - < scripts/diagrams/db-snapshot.py > docs/02-design/drawio/erd/supabase-schema.json
# Then rebuild the ERD: node scripts/diagrams/erd-xml.mjs docs/02-design/drawio/erd-geosound.xml
import asyncio, os, re, json, asyncpg
async def main():
    url = os.environ.get("DATABASE_URL_DIRECT_AI") or os.environ["DATABASE_URL_AI"]
    url = re.sub(r"[?&]schema=[^&]*", "", url).replace("?&", "?").rstrip("?")
    c = await asyncpg.connect(url, statement_cache_size=0)
    cols = await c.fetch("""
      select n.nspname s, t.relname tb, a.attname col, format_type(a.atttypid, a.atttypmod) typ, not a.attnotnull nullable, a.attnum pos
      from pg_class t join pg_namespace n on n.oid=t.relnamespace
      join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
      where t.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
      order by 1,2,a.attnum""")
    cons = await c.fetch("""
      select n.nspname s, t.relname tb, con.contype::text ty, con.conname nm,
             array(select a.attname from unnest(con.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.n order by k.o) cols,
             rn.nspname rs, rt.relname rtb,
             array(select a.attname from unnest(con.confkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.n order by k.o) rcols
      from pg_constraint con join pg_class t on t.oid=con.conrelid join pg_namespace n on n.oid=t.relnamespace
      left join pg_class rt on rt.oid=con.confrelid left join pg_namespace rn on rn.oid=rt.relnamespace
      where con.contype in ('p','u','f') and n.nspname not in ('pg_catalog','information_schema','pg_toast')""")
    uidx = await c.fetch("""
      select n.nspname s, t.relname tb, array(select a.attname from unnest(i.indkey) k join pg_attribute a on a.attrelid=t.oid and a.attnum=k) cols
      from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
      where i.indisunique and not i.indisprimary and n.nspname not in ('pg_catalog','information_schema','pg_toast')""")
    out = {}
    for r in cols:
        t = out.setdefault(r['s'], {}).setdefault(r['tb'], {"columns": [], "pk": [], "unique": [], "fks": []})
        t["columns"].append({"name": r['col'], "type": r['typ'], "nullable": r['nullable']})
    for r in cons:
        t = out.get(r['s'], {}).get(r['tb'])
        if not t: continue
        if r['ty'] == 'p': t["pk"] = list(r['cols'])
        elif r['ty'] == 'u': t["unique"].append(list(r['cols']))
        else: t["fks"].append({"columns": list(r['cols']), "refSchema": r['rs'], "refTable": r['rtb'], "refColumns": list(r['rcols'])})
    for r in uidx:
        t = out.get(r['s'], {}).get(r['tb'])
        if t and list(r['cols']) not in t["unique"]: t["unique"].append(list(r['cols']))
    print(json.dumps(out, indent=1, sort_keys=True, ensure_ascii=False))
    await c.close()
asyncio.run(main())
