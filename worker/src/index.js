export default {
  async fetch(request) {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ ok: true });
    }

    return Response.json(
      { ok: false, code: "NOT_FOUND", message: "Not found." },
      { status: 404 }
    );
  },
};
