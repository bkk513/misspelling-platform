import { api } from "../lib/api";

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function taskStateTone(state: string) {
  const normalized = String(state || "").toUpperCase();
  if (normalized === "SUCCESS") return "success";
  if (normalized === "FAILURE") return "error";
  if (normalized === "RUNNING" || normalized === "PROGRESS") return "processing";
  return "default";
}

export async function fetchArtifactJson(taskId: string) {
  try {
    const resp = await fetch(api.fileUrl(taskId, "result.json"));
    if (!resp.ok) return null;
    return asObject(await resp.json());
  } catch {
    return null;
  }
}
