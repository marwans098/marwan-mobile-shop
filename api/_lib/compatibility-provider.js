import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db.js";
import { CONFIDENCE_LEVELS, NO_RELIABLE_MATCH_MESSAGE, normalizeModel, normalizePartInput, normalizeSku, overallMatchStatus } from "./compatibility-domain.js";

export class CompatibilityProvider {
  async search() {
    throw new Error("Implement search() in a compatibility provider");
  }
}

// This provider uses manager-entered claims only. No external catalog is seeded or inferred.
export class CuratedCompatibilityProvider extends CompatibilityProvider {
  async initialize() {
    await initDb();
    await sql`CREATE TABLE IF NOT EXISTS compatibility_parts (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL DEFAULT '',
      sku_normalized TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      part_type TEXT NOT NULL CHECK (part_type IN ('cases','screens','charging_flex_ic','fingerprint','chargers_power')),
      notes TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS compatibility_parts_sku_unique
      ON compatibility_parts (sku_normalized) WHERE sku_normalized <> ''`;
    await sql`CREATE TABLE IF NOT EXISTS compatibility_devices (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      normalized_model TEXT NOT NULL UNIQUE,
      aliases TEXT[] NOT NULL DEFAULT '{}',
      normalized_aliases TEXT[] NOT NULL DEFAULT '{}',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE compatibility_devices ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`;
    await sql`CREATE TABLE IF NOT EXISTS compatibility_relations (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES compatibility_parts(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES compatibility_devices(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('confirmed','possible')),
      source_name TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (part_id, device_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS compatibility_relations_status_idx
      ON compatibility_relations (status, device_id)`;
    await sql`CREATE INDEX IF NOT EXISTS compatibility_parts_type_idx
      ON compatibility_parts (part_type, sku_normalized)`;
  }

  async search({ type = "", model = "", q = "" } = {}) {
    const normalizedType = String(type).trim();
    const normalized = normalizeModel(model);
    const querySku = normalizeSku(q);
    const queryName = String(q ?? "").trim().toLocaleLowerCase("en-US");
    const rows = await sql`
      SELECT p.id AS part_id, p.sku, p.name AS part_name, p.part_type,
             p.notes AS part_notes, p.image_url,
             d.id AS device_id, d.brand, d.model, d.aliases, d.image_url AS device_image_url,
             r.id AS relation_id, r.status, r.source_name, r.source_url,
             r.evidence, r.notes AS relation_notes, r.reviewed_by, r.reviewed_at, r.updated_at
      FROM compatibility_relations r
      JOIN compatibility_parts p ON p.id = r.part_id
      JOIN compatibility_devices d ON d.id = r.device_id
      WHERE (${normalizedType} = '' OR p.part_type = ${normalizedType})
        AND (${normalized} = '' OR d.normalized_model = ${normalized} OR ${normalized} = ANY(d.normalized_aliases))
        AND (${querySku} = '' OR p.sku_normalized LIKE '%' || ${querySku} || '%' OR LOWER(p.name) LIKE '%' || ${queryName} || '%')
      ORDER BY CASE r.status WHEN 'confirmed' THEN 0 ELSE 1 END, p.name, d.model
      LIMIT 250
    `;
    const records = rows.map((row) => ({
      part: { id: row.part_id, sku: row.sku, name: row.part_name, type: row.part_type, notes: row.part_notes, imageUrl: row.image_url },
      model: { id: row.device_id, brand: row.brand, name: row.model, aliases: row.aliases || [], imageUrl: row.device_image_url || "" },
      status: row.status,
      source: { name: row.source_name, url: row.source_url, evidence: row.evidence, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, updatedAt: row.updated_at },
      confidence: { level: row.status === "confirmed" ? "high" : "none", label: row.status === "confirmed" ? CONFIDENCE_LEVELS.high : CONFIDENCE_LEVELS.none },
      notes: row.relation_notes
    }));
    return {
      provider: "manager-curated",
      status: overallMatchStatus(records),
      records
    };
  }

  async listAll() {
    const rows = await sql`
      SELECT p.id AS part_id, p.sku, p.name AS part_name, p.part_type,
             p.notes AS part_notes, p.image_url,
             d.id AS device_id, d.brand, d.model, d.aliases, d.image_url AS device_image_url,
             r.id AS relation_id, r.status, r.source_name, r.source_url,
             r.evidence, r.notes AS relation_notes, r.reviewed_by, r.reviewed_at, r.updated_at
      FROM compatibility_relations r
      JOIN compatibility_parts p ON p.id = r.part_id
      JOIN compatibility_devices d ON d.id = r.device_id
      ORDER BY p.name, d.model
    `;
    return rows.map((row) => ({
      id: row.relation_id,
      part: { id: row.part_id, sku: row.sku, name: row.part_name, type: row.part_type, notes: row.part_notes, imageUrl: row.image_url },
      model: { id: row.device_id, brand: row.brand, name: row.model, aliases: row.aliases || [], imageUrl: row.device_image_url || "" },
      status: row.status,
      source: { name: row.source_name, url: row.source_url, evidence: row.evidence, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, updatedAt: row.updated_at },
      confidence: { level: row.status === "confirmed" ? "high" : "none", label: row.status === "confirmed" ? CONFIDENCE_LEVELS.high : CONFIDENCE_LEVELS.none },
      notes: row.relation_notes
    }));
  }

  async upsert(rawInput, reviewer) {
    const input = normalizePartInput(rawInput);
    const skuNormalized = normalizeSku(input.sku);
    let partId;
    if (skuNormalized) {
      const existing = await sql`SELECT id FROM compatibility_parts WHERE sku_normalized = ${skuNormalized} LIMIT 1`;
      partId = existing[0]?.id;
    }
    partId ||= randomUUID();
    await sql`
      INSERT INTO compatibility_parts (id, sku, sku_normalized, name, part_type, notes, image_url, updated_at)
      VALUES (${partId}, ${input.sku}, ${skuNormalized}, ${input.name}, ${input.type}, ${input.notes}, ${input.imageUrl}, NOW())
      ON CONFLICT (id) DO UPDATE SET sku = EXCLUDED.sku, sku_normalized = EXCLUDED.sku_normalized,
        name = EXCLUDED.name, part_type = EXCLUDED.part_type, notes = EXCLUDED.notes,
        image_url = EXCLUDED.image_url, updated_at = NOW()
    `;
    const result = [];
    for (const modelName of input.models) {
      const normalized = normalizeModel(modelName);
      const aliases = input.aliases;
      const normalizedAliases = [...new Set(aliases.map(normalizeModel).filter(Boolean))];
      let deviceId;
      const existing = await sql`SELECT id FROM compatibility_devices WHERE normalized_model = ${normalized} LIMIT 1`;
      deviceId = existing[0]?.id || randomUUID();
      await sql`
        INSERT INTO compatibility_devices (id, brand, model, normalized_model, aliases, normalized_aliases, image_url)
        VALUES (${deviceId}, ${String(rawInput.brand ?? '').trim()}, ${modelName}, ${normalized}, ${aliases}, ${normalizedAliases}, ${input.deviceImageUrl})
        ON CONFLICT (normalized_model) DO UPDATE SET
          brand = CASE WHEN EXCLUDED.brand = '' THEN compatibility_devices.brand ELSE EXCLUDED.brand END,
          model = EXCLUDED.model,
          aliases = EXCLUDED.aliases,
          normalized_aliases = EXCLUDED.normalized_aliases,
          image_url = CASE WHEN EXCLUDED.image_url = '' THEN compatibility_devices.image_url ELSE EXCLUDED.image_url END
      `;
      const relationId = randomUUID();
      const verifiedAt = input.status === "confirmed" ? new Date().toISOString() : null;
      const relation = await sql`
        INSERT INTO compatibility_relations
          (id, part_id, device_id, status, source_name, source_url, evidence, notes, reviewed_by, reviewed_at, updated_at)
        VALUES
          (${relationId}, ${partId}, ${deviceId}, ${input.status}, ${input.sourceName}, ${input.sourceUrl}, ${input.evidence}, ${input.notes}, ${input.status === 'confirmed' ? reviewer : ''}, ${verifiedAt}, NOW())
        ON CONFLICT (part_id, device_id) DO UPDATE SET
          status = EXCLUDED.status, source_name = EXCLUDED.source_name, source_url = EXCLUDED.source_url,
          evidence = EXCLUDED.evidence, notes = EXCLUDED.notes,
          reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at, updated_at = NOW()
        RETURNING id
      `;
      result.push({ id: relation[0]?.id, model: modelName });
    }
    return { partId, relations: result };
  }

  async remove(relationId) {
    const rows = await sql`DELETE FROM compatibility_relations WHERE id = ${relationId} RETURNING id`;
    return rows.length > 0;
  }
}

/**
 * Stable provider boundary consumed by /api/compatibility.
 * A future official adapter should implement search() and return the v1
 * contract fields: part, model, status, source{name,url,updatedAt,evidence},
 * and confidence{level}. The HTTP layer validates every record before release.
 */
export class UnconfiguredCompatibilityProvider extends CompatibilityProvider {
  constructor({ managementProvider = new CuratedCompatibilityProvider(), sourceProvider = null } = {}) {
    super();
    this.managementProvider = managementProvider;
    this.sourceProvider = sourceProvider;
  }

  async initialize() {
    if (this.sourceProvider?.initialize) await this.sourceProvider.initialize();
  }

  async search(query) {
    if (this.sourceProvider) return this.sourceProvider.search(query);
    return {
      provider: "unconfigured",
      status: "no_reliable_match",
      message: NO_RELIABLE_MATCH_MESSAGE,
      records: []
    };
  }

  async listAll() {
    await this.managementProvider.initialize();
    return this.managementProvider.listAll();
  }

  async upsert(input, reviewer) {
    await this.managementProvider.initialize();
    return this.managementProvider.upsert(input, reviewer);
  }

  async remove(id) {
    await this.managementProvider.initialize();
    return this.managementProvider.remove(id);
  }
}

export function getCompatibilityProvider() {
  return new UnconfiguredCompatibilityProvider();
}