// Large populations repeat the same object field names thousands of times.
// Share those schemas in the existing JSON column without dropping any values.
// Ordinary array snapshots remain readable and are kept when they fit in D1.
const ENCODING = "object-table-v1";
const ROW_BUDGET_BYTES = 1800000;
const encoder = new TextEncoder();

export function encodeBuilds(builds, dataJson = "") {
  const plain = JSON.stringify(builds);
  if (
    (plain.length + dataJson.length) * 3 <= ROW_BUDGET_BYTES ||
    encoder.encode(plain).byteLength + encoder.encode(dataJson).byteLength <= ROW_BUDGET_BYTES
  )
    return plain;
  const schemas = [];
  const schemaIds = new Map();
  function pack(value) {
    if (Array.isArray(value)) return value.map(pack);
    if (!value || typeof value !== "object") return value;
    const keys = Object.keys(value);
    const signature = JSON.stringify(keys);
    let id = schemaIds.get(signature);
    if (id === undefined) {
      id = schemas.length;
      schemas.push(keys);
      schemaIds.set(signature, id);
    }
    const record = [id];
    for (const key of keys) record.push(pack(value[key]));
    return { $o: record };
  }
  // Preserve JSON's handling of optional fields and values such as dates.
  const packed = JSON.parse(plain).map(pack);
  return JSON.stringify({ encoding: ENCODING, buildCount: builds.length, schemas, builds: packed });
}

export function decodeBuilds(json) {
  const stored = JSON.parse(json);
  if (Array.isArray(stored)) return stored;
  if (
    stored?.encoding !== ENCODING ||
    !Array.isArray(stored.schemas) ||
    !stored.schemas.every(
      (keys) => Array.isArray(keys) && keys.every((key) => typeof key === "string")
    ) ||
    !Array.isArray(stored.builds) ||
    stored.builds.length !== stored.buildCount
  )
    throw new Error("Invalid cached build encoding.");
  function restore(value) {
    if (Array.isArray(value)) return value.map(restore);
    if (!value || typeof value !== "object") return value;
    const record = value.$o;
    const keys = Array.isArray(record) && stored.schemas[record[0]];
    if (
      Object.keys(value).length !== 1 ||
      !keys ||
      !Number.isInteger(record[0]) ||
      record.length !== keys.length + 1
    )
      throw new Error("Invalid cached build record.");
    const object = {};
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      const restored = restore(record[index + 1]);
      if (key === "__proto__")
        Object.defineProperty(object, key, { value: restored, enumerable: true });
      else object[key] = restored;
    }
    return object;
  }
  return stored.builds.map(restore);
}

// Both array snapshots and the lossless encoding expose their original count.
export const buildCountSQL = (column) =>
  `CASE WHEN json_type(${column}) = 'array' THEN json_array_length(${column})
   WHEN json_extract(${column}, '$.encoding') = '${ENCODING}'
     THEN json_extract(${column}, '$.buildCount') ELSE 0 END`;
