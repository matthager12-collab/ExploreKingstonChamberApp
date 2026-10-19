// Harmless local HTTP proof against the built standalone artifact.
// No database, credentials, external fetches, exploit payloads or npm audit.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, cp } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const built = path.join(root, ".next/standalone");
const requireBuilt = createRequire(path.join(built, "node_modules/next/dist/server/image-optimizer.js"));
const sharp = requireBuilt("sharp");
assert.equal(sharp.versions.sharp, "0.35.3");
assert.equal(sharp.versions.vips, "8.18.3");
const serverSocket = net.createServer();
await new Promise(resolve => serverSocket.listen(0, "127.0.0.1", resolve));
const port = serverSocket.address().port;
await new Promise(resolve => serverSocket.close(resolve));
await mkdir(path.join(built, "public"), { recursive: true });
await cp(path.join(root, ".next/static"), path.join(built, ".next/static"), { recursive: true });
const fixtureNames = [];
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const pixel = { create: { width: 2, height: 2, channels: 3, background: "#336699" } };
const fixtures = {
  gif,
  png: await sharp(pixel).png().toBuffer(),
  jpg: await sharp(pixel).jpeg().toBuffer(),
  tiff: await sharp(pixel).tiff().toBuffer(),
  webp: await sharp(pixel).webp().toBuffer(),
};
for (const [extension, buffer] of Object.entries(fixtures)) {
  const name = `__synthetic_decoder_check.${extension}`;
  fixtureNames.push(name);
  await writeFile(path.join(built, "public", name), buffer);
}
const corrupt = "__synthetic_decoder_corrupt.png";
fixtureNames.push(corrupt);
await writeFile(path.join(built, "public", corrupt), "not an image");
const child = spawn(process.execPath, [path.join(built, "server.js")], {
  cwd: built,
  env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", chunk => { logs += chunk; });
child.stderr.on("data", chunk => { logs += chunk; });
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i=0; i<80; i++) {
    if (child.exitCode !== null) throw Error(`server exited: ${logs}`);
    try { const response = await fetch(`${origin}/${fixtureNames[0]}`); if (response.ok) { ready=true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server readiness timeout: ${logs}`);
  for (const extension of Object.keys(fixtures)) {
    const name = `__synthetic_decoder_check.${extension}`;
    const response = await fetch(`${origin}/_next/image?url=${encodeURIComponent('/'+name)}&w=64&q=75`, { headers: { Accept: "image/webp" } });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, `${extension}: ${bytes.toString()}`);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(bytes.subarray(8,12).toString(), "WEBP");
    console.log(`PASS HTTP ${extension} -> WebP using sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`);
  }
  const rejected = await fetch(`${origin}/_next/image?url=${encodeURIComponent('/'+corrupt)}&w=64&q=75`);
  assert.equal(rejected.status, 400);
  console.log("PASS HTTP disguised corrupt PNG rejected (400)");
} finally {
  child.kill("SIGTERM");
  await Promise.all(fixtureNames.map(name => rm(path.join(built, "public", name), { force: true })));
}
