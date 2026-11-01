import { useRef } from "react";
import { Camera, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
};

/**
 * Photo field with two buttons: "Take photo" opens the camera (one photo at a time, which is
 * the only way browsers and the mobile app honour `capture`), and "Choose photos" opens the
 * gallery with multi-select. Photos from both are added to the same list.
 */
export function PhotoPicker({ id, label, files, onChange }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (list && list.length > 0) onChange([...files, ...Array.from(list)]);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-camera-button`} className="flex items-center gap-2">
        <Camera className="w-4 h-4" />
        {label}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <Button
          id={`${id}-camera-button`}
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="w-4 h-4 mr-2" />
          Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => galleryRef.current?.click()}
        >
          <Images className="w-4 h-4 mr-2" />
          Choose photos
        </Button>
      </div>
      <input
        ref={cameraRef}
        id={`${id}-camera`}
        aria-label={`${label}: take photo`}
        tabIndex={-1}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        id={id}
        aria-label={`${label}: choose photos`}
        tabIndex={-1}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {files.length} photo(s) selected{" "}
          <button type="button" className="underline" onClick={() => onChange([])}>
            Clear
          </button>
        </p>
      )}
    </div>
  );
}
