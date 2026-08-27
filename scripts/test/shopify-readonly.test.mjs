/**
 * The read-only guard. The Shopify token carries write scopes, so this is the
 * thing standing between a bug and a live store.
 *
 *   node scripts/test/shopify-readonly.test.mjs
 */
import { assertReadOnly } from "../lib/shopify.mjs";

let failed = 0;
const group = (n) => console.log(`\n${n}`);
const allow = (name, doc) => {
  let err = null;
  try { assertReadOnly(doc, "test"); } catch (e) { err = e; }
  const ok = err === null;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}ALLOW  ${name}${ok ? "" : `  — ${err.message.split("\n")[0]}`}`);
};
const refuse = (name, doc) => {
  let err = null;
  try { assertReadOnly(doc, "test"); } catch (e) { err = e; }
  const ok = err !== null;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}REFUSE ${name}`);
};

group("legitimate read operations pass");
allow("named query", `query DailySales($q: String!) { orders(first: 10, query: $q) { nodes { id } } }`);
allow("anonymous selection set", `{ shop { name } }`);
allow("query with fragment", `fragment F on Order { id } query Q { orders { nodes { ...F } } }`);
allow("the script's own orders query", `
  query DailySales($q: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { id createdAt cancelledAt currentTotalPriceSet { shopMoney { amount currencyCode } } }
    }
  }`);
allow("leading comment", `# just a comment\nquery Q { shop { name } }`);
allow("field whose name merely starts with mutation", `query Q { mutationCount }`);
allow("the word mutation inside a string argument", `query Q { orders(query: "tag:mutation") { nodes { id } } }`);
allow("the word mutation inside a comment", `# TODO: never add a mutation here\nquery Q { shop { name } }`);
allow("block string containing mutation", `query Q { orders(query: """a mutation string""") { nodes { id } } }`);

group("writes are refused");
refuse("plain mutation", `mutation { orderUpdate(input: {}) { order { id } } }`);
refuse("named mutation", `mutation Kill($id: ID!) { orderDelete(orderId: $id) { deletedId } }`);
refuse("mutation smuggled after a valid query", `query Q { shop { name } } mutation M { orderClose(input: {}) { order { id } } }`);
refuse("mutation smuggled BEFORE a valid query", `mutation M { orderClose(input: {}) { order { id } } } query Q { shop { name } }`);
refuse("subscription", `subscription S { orderCreated { id } }`);
refuse("mutation hidden behind a comment line", `# query Q { shop { name } }\nmutation M { orderClose(input: {}) { order { id } } }`);
refuse("bulk mutation runner", `mutation { bulkOperationRunMutation(mutation: "x", stagedUploadPath: "y") { bulkOperation { id } } }`);
refuse("unknown future operation type", `subscribeLive S { orders { id } }`);
refuse("empty document", ``);
refuse("whitespace only", `   \n  `);
refuse("fragments with no operation", `fragment F on Order { id }`);
refuse("unbalanced braces", `query Q { shop { name }`);

group("case and spacing tricks");
refuse("extra whitespace before mutation", `

     mutation   M   { orderClose(input: {}) { order { id } } }`);
refuse("mutation on its own line after fragment", `fragment F on Order { id }\nmutation M { orderClose(input: {}) { order { id } } }`);
allow("tabs and newlines around a query", `\t\n  query   Q   {  shop { name }  }  \n`);

group("the guard is actually wired into the network path");
{
  // A guard nobody calls is decoration. This asserts, at the source level,
  // that gql() runs it BEFORE reaching the network — so deleting the call
  // breaks the build rather than silently re-arming the write scopes.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../lib/shopify.mjs", import.meta.url)), "utf8");

  const gqlStart = src.indexOf("async function gql(");
  const body = src.slice(gqlStart, src.indexOf("\nconst ORDERS_QUERY", gqlStart));
  const guardAt = body.indexOf("assertReadOnly(");
  const fetchAt = body.indexOf("httpJson(");

  const wired = guardAt !== -1;
  if (!wired) failed++;
  console.log(`${wired ? "  ok  " : "FAIL  "}gql() calls assertReadOnly()`);

  const first = wired && fetchAt !== -1 && guardAt < fetchAt;
  if (!first) failed++;
  console.log(`${first ? "  ok  " : "FAIL  "}the guard runs BEFORE the request is sent`);

  // Every network call in this module must funnel through gql(). The token
  // exchange is the one legitimate exception.
  const rawCalls = [...src.matchAll(/httpJson\(/g)].length;
  const expected = 2; // one in gql(), one in the token exchange
  const ok = rawCalls === expected;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}no network path bypasses gql()  — ${rawCalls} httpJson call(s), expected ${expected}`);
}

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
