import { parseUpdaterManifest, validateReleaseAssets } from "./release-assets.mjs";
import { CHECKSUM_NAME, formatChecksums, hashReleaseAssets, readSmallReleaseAsset } from "./release-checksums.mjs";

/** A public release is the last mutation, after uploaded checksums are read back and verified. */
export async function publishRelease({ github, repo, releaseId, readAsset }) {
  const release = (await github.rest.repos.getRelease({ ...repo, release_id: releaseId })).data;
  if (!release.draft) throw new Error("仅允许向尚未公开的草稿生成校验和");
  const list = () => github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: releaseId, per_page: 100 });
  let assets = await list();
  const latest = assets.find(asset => asset.name === "latest.json" && asset.size > 0);
  if (!latest) throw new Error("缺少 latest.json，保留草稿");
  const manifest = parseUpdaterManifest(await readSmallReleaseAsset(latest, readAsset));
  const hashes = await hashReleaseAssets(assets, readAsset);
  const contents = Buffer.from(formatChecksums(hashes));

  for (const old of assets.filter(asset => asset.name === CHECKSUM_NAME)) {
    await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: old.id });
  }
  await github.rest.repos.uploadReleaseAsset({ ...repo, release_id: releaseId, url: release.upload_url,
    name: CHECKSUM_NAME, data: contents, headers: { "content-type": "text/plain", "content-length": contents.length } });

  // Asset contents are immutable per GitHub asset ID. Check the refreshed IDs and
  // lengths against the byte hashes, and verify the uploaded manifest itself.
  assets = await list();
  const uploaded = assets.find(asset => asset.name === CHECKSUM_NAME);
  if (!uploaded) throw new Error("SHA256SUMS.txt 上传后不可读，保留草稿");
  const checksums = await readSmallReleaseAsset(uploaded, readAsset);
  validateReleaseAssets({ release, assets, manifest, checksums, hashes });
  await github.rest.repos.updateRelease({ ...repo, release_id: releaseId, draft: false, make_latest: "true" });
}
