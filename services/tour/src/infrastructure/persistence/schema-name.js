// =========================================================
// Postgres schema of the Prisma datasource, for the few raw SQL statements that must name a table
// (UC05 rating aggregate). Pure: no Prisma import, so tests can load it.
// =========================================================

export const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `?schema=` of a Postgres URL, default "public"; anything that is not a plain identifier -> "public". */
export function schemaFromUrl(url) {
  try {
    const schema = new URL(String(url)).searchParams.get('schema') || 'public';
    return SQL_IDENTIFIER.test(schema) ? schema : 'public';
  } catch {
    return 'public';
  }
}
