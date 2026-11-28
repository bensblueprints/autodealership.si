const primary = "https://autodealership.si";
const upstreamHost = "autodealership-si.netlify.app";

export default {
  async fetch(request) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Account actions use autodealership.si.", {status: 405, headers: {Allow: "GET, HEAD"}});
    }
    const url = new URL(request.url);
    const section = url.pathname.split("/")[1];
    if (["onboarding", "admin", "billing", "clients", "api"].includes(section) ||
        ["/signup", "/signup.html"].includes(url.pathname)) {
      const target = new URL(primary);
      target.pathname = url.pathname;
      target.search = url.search;
      return Response.redirect(target.href, 302);
    }
    const upstream = new URL(url);
    upstream.protocol = "https:";
    upstream.host = upstreamHost;
    upstream.search = "";
    const result = await fetch(new Request(upstream, {method: request.method, redirect: "manual"}));
    const headers = new Headers(result.headers);
    headers.delete("set-cookie");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("X-ADSI-Hosting", "Netlify");
    if (headers.has("location")) {
      const target = new URL(headers.get("location"), upstream);
      if (target.host === upstreamHost) {
        target.host = url.host;
        target.search = url.search;
        headers.set("location", target.href);
      }
    }
    return new Response(result.body, {status: result.status, headers});
  },
};
