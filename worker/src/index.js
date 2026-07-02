import { corsHeaders, jsonError, jsonOk } from "./http.js";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      if (!cors["Access-Control-Allow-Origin"]) {
        return jsonError("ORIGIN_DENIED", "Origin tidak diizinkan.", 403);
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (new URL(request.url).pathname === "/health") {
      return jsonOk(undefined, undefined, { headers: cors });
    }

    return jsonError("NOT_FOUND", "Not found.", 404, undefined, cors);
  },
};
