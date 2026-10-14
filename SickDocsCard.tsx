import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Upload, Eye, Trash2, Lock, AlertCircle, Thermometer } from 'lucide-react';
import { format } from 'date-fns';
import { store } from './store';
import { SickDocument } from './types';

const MAX_BYTES = 8 * 1024 * 1024;

// Phone photos of a paper report are routinely 3-6 MB. Shrinking them to a
// readable 2000px JPEG keeps the database small without losing the text.
// PDFs and HEIC (which most browsers cannot draw) go up untouched.
async function shrinkIfPhoto(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const nice = (d: string) => format(new Date(d + 'T00:00:00'), 'EEE, MMM d');

// The employee's own medical reports for sick days. Only they and Admin can
// ever open these — the server enforces it; the note on the card says so.
export default function SickDocsCard() {
  const [docs, setDocs] = useState<SickDocument[]>([]);
  const [sickDays, setSickDays] = useState<string[]>([]);
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await store.getMySickDocs();
      setDocs(r.docs);
      setSickDays(r.sickDays);
      return r;
    } catch { return null; }
  };

  useEffect(() => {
    load().then((r) => {
      // Start on the most recent sick day that still has no report, if any.
      const missing = r?.sickDays.find((d) => !r.docs.some((x) => x.date === d));
      if (missing) setDate(missing);
    });
  }, []);

  const missing = useMemo(() => sickDays.filter((d) => !docs.some((x) => x.date === d)), [sickDays, docs]);

  const upload = async () => {
    if (!file) { setError('Choose the photo or PDF of your medical report.'); return; }
    setBusy(true); setError(''); setDone('');
    try {
      const body = await shrinkIfPhoto(file);
      if (body.size > MAX_BYTES) throw new Error('That file is too large (8 MB max).');
      await store.uploadSickDoc(body, date, file.name, note.trim());
      setFile(null); setNote('');
      if (fileInput.current) fileInput.current.value = '';
      setDone(`Uploaded for ${nice(date)}. Admin has been notified.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Upload failed. Try again.');
    }
    setBusy(false);
  };

  const remove = async (d: SickDocument) => {
    if (!confirm(`Delete the report "${d.filename || 'document'}" for ${nice(d.date)}?`)) return;
    try { await store.deleteSickDoc(d.id); await load(); } catch { alert('Could not delete it. Try again.'); }
  };

  const open = async (d: SickDocument) => {
    try { await store.openSickDoc(d.id); } catch (e: any) { alert(e?.message || 'Could not open it.'); }
  };

  return (
    <div className="bg-white rounded-[32px] p-8 border-2 border-gray-100 shadow-sm space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-lg">
          <Thermometer size={26} />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl font-black text-gray-900 leading-tight">Sick Leave — Medical Report</h3>
          <p className="text-xs font-bold text-gray-400 mt-1 flex items-center gap-1.5">
            <Lock size={12} /> Only you and the Admin can see what you upload here.
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl space-y-2">
          <p className="text-xs font-black text-amber-800 flex items-center gap-2"><AlertCircle size={14} /> Report still needed for:</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((d) => (
              <button key={d} onClick={() => setDate(d)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${date === d ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-100'}`}>
                {nice(d)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Sick day</p>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 font-bold text-sm text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
        </div>
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Photo or PDF</p>
          <input ref={fileInput} type="file" accept="image/*,application/pdf"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); setDone(''); }}
            className="w-full text-sm font-bold text-gray-600 file:mr-3 file:px-4 file:py-2.5 file:rounded-xl file:border-0 file:bg-gray-900 file:text-white file:font-black file:text-xs file:uppercase file:tracking-widest file:cursor-pointer" />
        </div>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional) — e.g. clinic name, number of days"
        className="w-full px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm font-medium text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-400" />

      <button onClick={upload} disabled={busy || !file}
        className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 shadow-xl shadow-rose-100 transition-all active:scale-95 disabled:opacity-50">
        <Upload size={16} /> {busy ? 'Uploading...' : 'Upload Report'}
      </button>

      {error && <p className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-black border border-rose-100">{error}</p>}
      {done && <p className="p-3 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-black border border-emerald-100">{done}</p>}

      {docs.length > 0 && (
        <div className="pt-6 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Your uploaded reports</p>
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-2xl border border-gray-100">
                <FileText size={18} className="text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-gray-900 truncate">{nice(d.date)} · {d.filename || 'document'}</p>
                  <p className="text-[10px] font-bold text-gray-400 truncate">
                    {kb(d.bytes)} · uploaded {format(new Date(d.createdAt), 'MMM d, p')}{d.note ? ` · ${d.note}` : ''}
                  </p>
                </div>
                <button onClick={() => open(d)} title="Open" className="p-2 rounded-xl text-gray-500 hover:bg-gray-50"><Eye size={16} /></button>
                <button onClick={() => remove(d)} title="Delete" className="p-2 rounded-xl text-rose-500 hover:bg-rose-50"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
