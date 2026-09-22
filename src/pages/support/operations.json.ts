import type { APIRoute } from "astro";
import { getServiceSupport } from "../../lib/generated-content";

// https://overcast.sh/support/operations.json — every listed operation and its status,
// keyed by service id. The support matrix filter fetches it the first time someone goes
// to use the filter, so the ~1,500 names are not part of every visit to the page.
type Operation = { operation: string; status: string };

export const GET: APIRoute = async () => {
  const support = await getServiceSupport();
  const index = Object.fromEntries(
    support.services.map((service) => [
      service.service,
      (service.operations as Operation[]).map((op) => [op.operation, op.status]),
    ]),
  );
  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
