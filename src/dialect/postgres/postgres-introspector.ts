import {
  DatabaseIntrospector,
  DatabaseMetadata,
  DatabaseMetadataOptions,
  TableMetadata,
} from '../database-introspector.js'
import {
  MIGRATION_LOCK_TABLE,
  MIGRATION_TABLE,
} from '../../migration/migrator.js'
import { Kysely } from '../../kysely.js'
import { ColumnDataType } from '../../operation-node/data-type-node.js'
import { freeze } from '../../util/object-utils.js'

export class PostgresIntrospector implements DatabaseIntrospector {
  readonly #db: Kysely<any>

  constructor(db: Kysely<any>) {
    this.#db = db
  }

  async getMetadata(
    options: DatabaseMetadataOptions = { withInternalKyselyTables: false }
  ): Promise<DatabaseMetadata> {
    let query = this.#db
      .selectFrom('pg_catalog.pg_attribute as a')
      .innerJoin('pg_catalog.pg_class as c', 'a.attrelid', 'c.oid')
      .innerJoin('pg_catalog.pg_tables as t', 't.tablename', 'c.relname')
      .innerJoin('pg_catalog.pg_type as typ', 'a.atttypid', 'typ.oid')
      .select([
        'a.attname as column',
        'a.attnotnull as not_null',
        't.tablename as table',
        't.schemaname as schema',
        'typ.typname as type',
      ])
      .where('t.schemaname', '!~', '^pg_')
      .where('t.schemaname', '!=', 'information_schema')
      .where('a.attnum', '>=', 0) // No system columns
      .where('a.attisdropped', '!=', true)
      .castTo<RawColumnMetadata>()

    if (!options.withInternalKyselyTables) {
      query = query
        .where('t.tablename', '!=', MIGRATION_TABLE)
        .where('t.tablename', '!=', MIGRATION_LOCK_TABLE)
    }

    const rawColumns = await query.execute()

    return {
      tables: this.#parseTableMetadata(rawColumns),
    }
  }

  #parseTableMetadata(columns: RawColumnMetadata[]): TableMetadata[] {
    return columns.reduce<TableMetadata[]>((tables, it) => {
      let table = tables.find(
        (tbl) => tbl.name === it.table && tbl.schema === it.schema
      )

      if (!table) {
        table = freeze({
          name: it.table,
          schema: it.schema,
          columns: [],
        })

        tables.push(table)
      }

      table.columns.push(
        freeze({
          name: it.column,
          dataType: it.type,
          isNullable: !it.not_null,
        })
      )

      return tables
    }, [])
  }
}

interface RawColumnMetadata {
  column: string
  table: string
  schema: string
  not_null: boolean
  type: ColumnDataType
}
