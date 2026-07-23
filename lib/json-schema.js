function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported schema reference ${ref}`);
  return ref.slice(2).split("/").reduce((value, token) => value[token.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

function validateNode(root, schema, value, path, errors) {
  if (schema.$ref) return validateNode(root, resolveRef(root, schema.$ref), value, path, errors);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) errors.push(`${path} must be one of ${schema.enum.map(JSON.stringify).join(", ")}`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${path} must be type ${types.join(" or ")}`);
      return;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match ${schema.pattern}`);
    if (schema.format === "uri") { try { new URL(value); } catch { errors.push(`${path} must be a URI`); } }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${path} must be a date-time`);
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path} requires at least ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path} items must be unique`);
    if (schema.items) value.forEach((item, index) => validateNode(root, schema.items, item, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${path}.${key} is not allowed`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) validateNode(root, child, value[key], `${path}.${key}`, errors);
  }
}

export function validateJsonSchema(schema, value, path = "value") {
  const errors = [];
  validateNode(schema, schema, value, path, errors);
  return errors;
}
