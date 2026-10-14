import React, { useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, PhoneIncoming, PhoneCall } from 'lucide-react';
import { useCall } from './calling';
import { useLanguage } from './i18n';

const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Rendered once, globally (outside AppLayout), so a call can ring and be
// answered no matter which page the user happens to be on.
export default function CallOverlay() {
  const call = useCall();
  const { t } = useLanguage();

  // A call that failed, was declined, or went unanswered ends up idle with an
  // error. Showing nothing at all would leave the user guessing why pressing
  // Call did nothing, so surface it as a toast that clears itself.
  useEffect(() => {
    if (call.status !== 'idle' || !call.error) return;
    const t = setTimeout(call.clearError, 6000);
    return () => clearTimeout(t);
  }, [call.status, call.error, call.clearError]);

  if (call.status === 'idle') {
    if (!call.error) return null;
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] animate-in fade-in slide-in-from-bottom-2 duration-200">
        <button
          onClick={call.clearError}
          className="flex items-center gap-2.5 bg-gray-900 text-white text-xs font-bold px-5 py-3.5 rounded-2xl shadow-2xl"
        >
          <PhoneOff size={15} className="text-rose-400 shrink-0" />
          {t(call.error)}
        </button>
      </div>
    );
  }

  const isIncoming = call.status === 'incoming';
  const isCalling = call.status === 'calling';
  const isConnecting = call.status === 'connecting';
  const isConnected = call.status === 'connected';

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-sm p-10 flex flex-col items-center gap-6 text-center animate-in zoom-in-95 duration-200">
        <div className={`w-24 h-24 rounded-full flex items-center justify-center text-white shadow-xl ${
          isConnected ? 'bg-emerald-600 shadow-emerald-100' : isIncoming ? 'bg-blue-600 shadow-blue-100 animate-pulse' : 'bg-gray-900'
        }`}>
          {isIncoming ? <PhoneIncoming size={40} /> : <PhoneCall size={40} />}
        </div>

        <div>
          <p className="text-2xl font-black text-gray-900">{call.peerName || t('call.someone')}</p>
          <p className="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">
            {isIncoming ? t('call.incoming')
              : isCalling ? t('call.calling')
              : isConnecting ? t('call.connecting')
              : isConnected ? fmtDuration(call.durationSec)
              : ''}
          </p>
          {call.error && <p className="text-xs font-bold text-rose-500 mt-2">{t(call.error)}</p>}
          {/* Both sides must be able to see that the call is being recorded. */}
          {call.recording && (
            <p className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-rose-200">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {t('call.recording')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 mt-2">
          {isIncoming ? (
            <>
              <button
                onClick={call.declineCall}
                title={t('call.decline')}
                className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-xl shadow-rose-100 transition-all active:scale-95"
              >
                <PhoneOff size={24} />
              </button>
              <button
                onClick={call.answerCall}
                title={t('call.answer')}
                className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-xl shadow-emerald-100 transition-all active:scale-95"
              >
                <Phone size={24} />
              </button>
            </>
          ) : (
            <>
              {isConnected && (
                <button
                  onClick={call.toggleMute}
                  title={call.muted ? t('call.unmute') : t('call.mute')}
                  className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95 ${
                    call.muted ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-100' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {call.muted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>
              )}
              <button
                onClick={call.endCall}
                title={t('call.end')}
                className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-xl shadow-rose-100 transition-all active:scale-95"
              >
                <PhoneOff size={24} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
