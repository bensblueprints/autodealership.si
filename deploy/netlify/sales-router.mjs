const salesOrigin = "autodealership-si.netlify.app";
const platformPaths = new Set(["admin", "api", "billing", "clients", "onboarding"]);

export async function routeSales(request, fetcher = fetch) {
  const url = new URL(request.url);
  const section = url.pathname.split("/")[1];
  if (url.hostname !== "autodealership.si" || !["GET", "HEAD"].includes(request.method) ||
      platformPaths.has(section) || /^[._]/.test(section) || url.pathname.includes("%") || url.pathname.startsWith("//")) {
    return fetcher(request);
  }
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return Response.redirect(url.href, 308);
  }

  const upstream = new URL(url);
  upstream.protocol = "https:";
  upstream.host = salesOrigin;
  upstream.search = "";
  if (url.searchParams.has("v")) upstream.searchParams.set("v", url.searchParams.get("v"));
  if (url.pathname === "/robots.txt") upstream.pathname = "/_domain/robots.txt";
  if (url.pathname === "/signup" || url.pathname === "/signup.html") upstream.pathname = "/_domain/signup.html";
  const headers = new Headers();
  for (const key of ["accept", "range", "if-none-match", "if-modified-since", "if-range"]) {
    if (request.headers.has(key)) headers.set(key, request.headers.get(key));
  }
  let response;
  try {
    response = await fetcher(new Request(upstream, { method: request.method, headers, redirect: "manual" }));
  } catch {
    return fetcher(request);
  }
  if (response.status >= 400 && response.status !== 416) return fetcher(request);
  const outgoing = new Headers(response.headers);
  outgoing.delete("x-robots-tag"); // Applied to the duplicate netlify.app host only.
  outgoing.delete("set-cookie");
  outgoing.set("X-ADSI-Hosting", "Netlify");
  if (response.status >= 300 && response.status < 400 && outgoing.has("location")) {
    const destination = new URL(outgoing.get("location"), upstream);
    if (destination.host === salesOrigin) {
      destination.host = url.host;
      if (!destination.search) destination.search = url.search;
      outgoing.set("location", destination.href);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
}

export default { fetch: (request) => routeSales(request) };
