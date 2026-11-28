import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist");
const output = join(dist, "netlify-sales");
const canonical = "https://autodealership.si";
// Direct visitors to a Netlify URL enter account flows on their authenticated origin.
const accountPaths = ["/admin", "/admin/", "/onboarding/*", "/clients/*", "/billing/*"];
const rules = accountPaths.map(path => path + " " + canonical + path.replace("*", ":splat") + " 302!");
rules.push("/signup " + canonical + "/signup.html 302!", "/signup.html " + canonical + "/signup.html 302!");
rules.push("/api/v1/vin/* " + canonical + "/api/v1/vin/:splat 200!");

await mkdir(dist, { recursive: true });
const staging = await mkdtemp(join(dist, "netlify-sales-"));
try {
  const source = join(root, "sales-site");
  await cp(source, staging, {
    recursive: true,
    filter: (path) => !basename(path).startsWith(".") && basename(path) !== "catalog-src",
  });
  await writeFile(join(staging, "_redirects"), rules.join("\n") + "\n");
  // The production router retrieves these two originals without the preview redirect/robots policy.
  const originals = join(staging, "_domain");
  await mkdir(originals);
  for (const name of ["signup.html", "robots.txt"]) {
    await cp(join(source, name), join(originals, name));
  }
  await writeFile(join(staging, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow\n");
  await writeFile(join(staging, "robots.txt"), "User-agent: *\nDisallow: /\n");
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log("Built the Netlify sales site.");
