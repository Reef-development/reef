import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";

type Folder = "repairs" | "fuel" | "downtime";
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Uploads photos and returns their stored paths. The API chooses each file's name, under the
 * signed-in person's own folder, and hands back a one-time upload link; the file then goes
 * straight to storage, so large photos do not pass through the API.
 */
export async function uploadPhotos(files: FileList | File[], folder: Folder): Promise<string[]> {
  const paths: string[] = [];
  for (const file of Array.from(files)) {
    const contentType = file.type || "image/jpeg";
    if (!ALLOWED.includes(contentType)) throw new Error(`${file.name} is not a JPEG, PNG or WebP photo`);
    const { data } = await api<{ path: string; token: string }>("/api/v1/photos/upload-url", {
      method: "POST",
      body: JSON.stringify({ folder, content_type: contentType }),
    });
    const { error } = await supabase.storage.from("reef-photos").uploadToSignedUrl(data.path, data.token, file, { contentType });
    if (error) throw error;
    paths.push(data.path);
  }
  return paths;
}

/** A link to view a stored photo for an hour, or null if it is missing or not the caller's to see. */
export async function signedPhotoUrl(path: string): Promise<string | null> {
  try {
    return (await api<{ url: string }>(`/api/v1/photos/view?path=${encodeURIComponent(path)}`)).data.url;
  } catch {
    return null;
  }
}
