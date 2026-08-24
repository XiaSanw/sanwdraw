import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { AssetRecord, SanwDocument } from "./types";

type SerializedAsset = Omit<AssetRecord, "dataUrl"> & { path: string };
type SerializedDocument = Omit<SanwDocument, "assets"> & {
  assets: Record<string, SerializedAsset>;
};

const extensionForMime = (mimeType: string) => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "image/webp") return "webp";
  return "png";
};

const dataUrlToBytes = (dataUrl: string) => {
  const splitAt = dataUrl.indexOf(",");
  const base64 = dataUrl.slice(splitAt + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

export const exportSanwdraw = (document: SanwDocument) => {
  const files: Record<string, Uint8Array> = {};
  const assets: Record<string, SerializedAsset> = {};

  Object.values(document.assets).forEach((asset) => {
    const path = `assets/${asset.id}.${extensionForMime(asset.mimeType)}`;
    files[path] = dataUrlToBytes(asset.dataUrl);
    assets[asset.id] = {
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      path,
    };
  });

  const serialized: SerializedDocument = {
    ...document,
    updatedAt: new Date().toISOString(),
    assets,
  };

  files["document.json"] = strToU8(JSON.stringify(serialized, null, 2));
  return zipSync(files, { level: 6 });
};

export const importSanwdraw = async (file: File): Promise<SanwDocument> => {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentBytes = archive["document.json"];
  if (!documentBytes) throw new Error("这个文件里没有 document.json");

  const serialized = JSON.parse(strFromU8(documentBytes)) as SerializedDocument;
  if (serialized.format !== "sanwdraw") throw new Error("不是 SanwDraw 工程文件");
  if (serialized.schemaVersion !== 1) throw new Error("暂不支持这个文件版本");

  const assets: Record<string, AssetRecord> = {};
  Object.values(serialized.assets).forEach((asset) => {
    const bytes = archive[asset.path];
    if (!bytes) return;
    assets[asset.id] = {
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      dataUrl: bytesToDataUrl(bytes, asset.mimeType),
    };
  });

  return { ...serialized, assets };
};
