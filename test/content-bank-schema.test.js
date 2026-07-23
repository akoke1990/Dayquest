import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaPath = new URL("../content/nyc/schema/content-bank.schema.v1.json", import.meta.url);

function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

test("v1 schema defines all three collections and controlled vocabularies", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$id, "https://dayquest.app/schemas/content-bank/v1.0.0");
  assert.deepEqual(schema.required, ["schema_version", "site_id", "places", "hunt_ideas", "clue_packages"]);
  assert.ok(schema.$defs.place);
  assert.ok(schema.$defs.hunt_idea);
  assert.ok(schema.$defs.clue_package);
  assert.deepEqual(schema.$defs.lifecycle.enum, [
    "candidate", "needs_source_review", "needs_field_verification", "field_verified", "published", "retired",
  ]);
  assert.ok(schema.$defs.category.enum.includes("public_art"));
  assert.ok(schema.$defs.category.enum.includes("park_garden"));
});

test("v1 schema contains no difficulty field", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const keys = [];
  walk(schema, (node) => {
    if (node.properties) keys.push(...Object.keys(node.properties));
  });
  assert.equal(keys.includes("difficulty"), false);
});

test("v1 records support explicit canary and pause delivery controls", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert.deepEqual(schema.$defs.delivery_control.properties.canary_eligible.type, "boolean");
  assert.deepEqual(schema.$defs.delivery_control.properties.paused.type, "boolean");
  for (const kind of ["place", "hunt_idea", "clue_package"]) {
    assert.equal(schema.$defs[kind].properties.delivery.$ref, "#/$defs/delivery_control");
  }
});
