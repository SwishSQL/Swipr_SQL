import React, { useEffect, useState } from 'react';
import { BellRing, X, AlertTriangle } from 'lucide-react';
import { useLanguage } from './i18n';
import { enablePushNotifications } from './push';

type Perm = 'default' | 'granted' | 'denied' | 'unsupported';

const readPermission = (): Perm => {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as Perm;
};

// Without notification permission an incoming call can only reach someone whose
// tab happens to be open, which is why so few people were reachable. The old
// flow asked once, silently, on first load — if that prompt was dismissed there
// was no second chance and no sign anything was wrong. This makes the state
// visible and gives a way back.
export default function NotificationGate() {
  const { t } = useLanguage();
  const [perm, setPerm] = useState<Perm>(readPermission);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Permission can change in another tab or from browser settings.
  useEffect(() => {
    const sync = () => setPerm(readPermission());
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const ask = async () => {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPerm(result as Perm);
      if (result === 'granted') await enablePushNotifications();
    } catch { /* the browser refused to prompt */ } finally {
      setBusy(false);
    }
  };

  if (perm === 'granted' || perm === 'unsupported') return null;
  // "Denied" is not dismissible — it is the state where calls silently fail.
  if (dismissed && perm !== 'denied') return null;

  const blocked = perm === 'denied';

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl border mb-6 ${
      blocked ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
        blocked ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
      }`}>
        {blocked ? <AlertTriangle size={17} /> : <BellRing size={17} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-black ${blocked ? 'text-rose-900' : 'text-amber-900'}`}>
          {t('notif.gate.title')}
        </p>
        <p className={`text-xs font-medium mt-0.5 ${blocked ? 'text-rose-700' : 'text-amber-700'}`}>
          {blocked ? t('notif.gate.blocked') : t('notif.gate.body')}
        </p>
      </div>
      {!blocked && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={ask}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-95 disabled:opacity-50"
          >
            {busy ? t('notif.gate.enabling') : t('notif.gate.enable')}
          </button>
          <button
            onClick={() => setDismissed(true)}
            title={t('notif.gate.later')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-amber-500 hover:bg-amber-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
