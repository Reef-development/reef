import { supabase } from "@/integrations/supabase/client";

export async function uploadPhotos(files: FileList | File[], folder: string): Promise<string[]> {
  const arr = Array.from(files);
  if (!arr.length) return [];
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id ?? "anon";
  const urls: string[] = [];
  for (const file of arr) {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${folder}/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("reef-photos").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) throw error;
    urls.push(path);
  }
  return urls;
}

export async function signedPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("reef-photos").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}