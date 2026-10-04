import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const digest = (s) => "sha256:" + createHash("sha256").update(s).digest("hex");
const names = ["00-contract.json", "10-scope.json", "30-retrieve.json", "40-assess.json", "50-compare.json", "70-human-review.json", "80-receipt.json"];
const artifactsSchema = z.array(z.object({ name: z.enum(names), content: z.string().max(60000),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()).length(7);

export function validateArtifacts(value) {
  const artifacts = artifactsSchema.parse(value);
  if (new Set(artifacts.map((a) => a.name)).size !== names.length) throw new Error("artifact_names_invalid");
  for (const a of artifacts) {
    if (digest(a.content) !== a.sha256) throw new Error("artifact_checksum_invalid");
    const content = JSON.parse(a.content);
    if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("artifact_content_invalid");
  }
  return artifacts;
}
async function containedDirectory(directory, create = false) {
  let cursor = path.resolve(directory);
  while (cursor !== path.dirname(cursor)) {
    try { if (!(await lstat(cursor)).isDirectory()) throw new Error("workspace_path_invalid"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    cursor = path.dirname(cursor);
  }
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).mode & 0o077) throw new Error("workspace_permissions_invalid");
}
export async function writeAssessmentWorkspace(packet, directory) {
  const artifacts = validateArtifacts(packet.workspace?.artifacts);
  if (packet.packetVersion !== "claim-assessment.v1" || packet.humanApprovalRequired !== true ||
      packet.judgmentAuthority !== "model_advisory") throw new Error("receipt_contract_invalid");
  await containedDirectory(directory, true);
  const run = await mkdtemp(path.join(directory, "claim-"));
  for (const artifact of artifacts) await writeFile(path.join(run, artifact.name), artifact.content + "\n", { mode: 0o600, flag: "wx" });
  const manifest = { manifestVersion: "claim-files.v1", complete: packet.workspace.complete === true,
    claimHash: packet.claimHash, inputHash: packet.inputHash, packetHash: digest(JSON.stringify(packet)),
    artifacts: artifacts.map((a) => ({ name: a.name, sha256: digest(a.content + "\n") })) };
  if (packet.humanReview) {
    const humanReview = z.array(z.object({ chunkRef: z.string().max(256),
      decision: z.enum(["unreviewed", "supports", "contradicts", "qualifies", "needs_context", "irrelevant", "rejected"]) }).strict()).max(20).parse(packet.humanReview);
    const content = JSON.stringify({ humanReview, answerApproval: "pending" }, null, 2) + "\n";
    await writeFile(path.join(run, "75-review-corrections.json"), content, { mode: 0o600, flag: "wx" });
    manifest.artifacts.push({ name: "75-review-corrections.json", sha256: digest(content) });
  }
  // Publication is last; a partial directory never claims a complete manifest.
  await writeFile(path.join(run, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return run;
}
export async function verifyAssessmentWorkspace(directory) {
  await containedDirectory(directory);
  const file = path.join(directory, "manifest.json"), info = await lstat(file);
  if (!info.isFile() || info.mode & 0o077 || info.size > 8192) throw new Error("manifest_invalid");
  const manifest = z.object({ manifestVersion: z.literal("claim-files.v1"), complete: z.boolean(),
    claimHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    packetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    artifacts: z.array(z.object({ name: z.enum([...names, "75-review-corrections.json"]), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()).min(7).max(8),
  }).strict().parse(JSON.parse(await readFile(file, "utf8")));
  if (new Set(manifest.artifacts.map((a) => a.name)).size !== manifest.artifacts.length ||
      names.some((name) => !manifest.artifacts.some((a) => a.name === name))) throw new Error("manifest_members_invalid");
  for (const artifact of manifest.artifacts) {
    const item = path.join(directory, artifact.name), stat = await lstat(item);
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > 240001 || digest(await readFile(item)) !== artifact.sha256) throw new Error("workspace_integrity_invalid");
  }
  return { integrity: "verified", complete: manifest.complete, authenticated: false, artifactCount: manifest.artifacts.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 2 && args[0] === "--verify") console.log(JSON.stringify(await verifyAssessmentWorkspace(args[1])));
    else if (args.length === 4 && args[0] === "--receipt" && args[2] === "--out") {
      const info = await lstat(args[1]);
      if (!info.isFile() || info.size > 1_000_000) throw new Error("receipt_file_invalid");
      const directory = await writeAssessmentWorkspace(JSON.parse(await readFile(args[1], "utf8")), args[3]);
      console.log(JSON.stringify({ directory, ...await verifyAssessmentWorkspace(directory) }));
    } else throw new Error("usage");
  } catch { console.error("claim_workspace_failed: check receipt, checksums, permissions and path"); process.exitCode = 1; }
}
