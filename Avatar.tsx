import React from 'react';

// Drop-in replacement for the "colored circle with an initial" avatar used
// across the app. Pass the exact className the div used to have (size,
// color, rounding, flex-centering) — when a photo exists it fills that same
// box; otherwise the initial renders exactly as before.
const Avatar: React.FC<{ name: string; photoUrl?: string; className: string }> = ({ name, photoUrl, className }) => (
  <div className={className}>
    {photoUrl ? (
      <img src={photoUrl} alt={name} className="w-full h-full object-cover rounded-[inherit]" />
    ) : (
      (name || '?').charAt(0).toUpperCase()
    )}
  </div>
);

export default Avatar;

// Resizes/compresses an image file client-side into a small square JPEG data
// URI, so uploads stay well under the server's size cap regardless of the
// original photo's resolution.
export function fileToAvatarDataUri(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas is not supported.'));
        // Center-crop to a square before scaling down, so the face stays framed.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
