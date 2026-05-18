import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

const API_URL = process.env.API_URL ?? "http://api:8000/api";

async function forward(req: NextRequest, params: { path: string[] }) {
  const path = params.path.join("/");
  const search = req.nextUrl.search;
  const url = `${API_URL}/${path}${search}`;

  const session = await getServerSession(authOptions);

  const contentType = req.headers.get("Content-Type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  const forwardHeaders: Record<string, string> = isMultipart
    ? { "Content-Type": contentType }
    : { "Content-Type": "application/json" };

  if (session?.user) {
    const u = session.user as { id?: string; email?: string; name?: string; role?: string };
    if (u.email) forwardHeaders["X-User-Email"] = u.email;
    if (u.id) forwardHeaders["X-User-Id"] = u.id;
    if (u.role) forwardHeaders["X-User-Role"] = u.role;
  }

  // Forward portal session token for password-protected portals
  const portalSession = req.headers.get("X-Portal-Session");
  if (portalSession) forwardHeaders["X-Portal-Session"] = portalSession;

  const init: RequestInit = {
    method: req.method,
    headers: forwardHeaders,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (isMultipart) {
      init.body = await req.arrayBuffer();
    } else {
      const body = await req.text();
      if (body) init.body = body;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ECONNREFUSED / ENOTFOUND — API container temporarily unreachable (e.g. restart)
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
      return new NextResponse(JSON.stringify({ detail: "API service temporarily unavailable. Please retry." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
  const respContentType = upstream.headers.get("Content-Type") ?? "application/json";
  const disposition = upstream.headers.get("Content-Disposition") ?? "";

  // SSE: pipe the stream through without buffering
  if (respContentType.includes("text/event-stream")) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const isBinary = respContentType.includes("octet-stream") ||
    respContentType.includes("wordprocessingml") ||
    respContentType.includes("spreadsheetml") ||
    respContentType.includes("excel") ||
    respContentType.includes("pdf");

  if (isBinary) {
    const buf = await upstream.arrayBuffer();
    const headers: Record<string, string> = { "Content-Type": respContentType };
    if (disposition) headers["Content-Disposition"] = disposition;
    return new NextResponse(buf, { status: upstream.status, headers });
  }

  if (upstream.status === 204 || upstream.status === 205) {
    return new NextResponse(null, { status: upstream.status });
  }

  const data = await upstream.text();
  const headers: Record<string, string> = { "Content-Type": respContentType };
  if (disposition) headers["Content-Disposition"] = disposition;
  return new NextResponse(data, { status: upstream.status, headers });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, await params);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, await params);
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, await params);
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, await params);
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, await params);
}
