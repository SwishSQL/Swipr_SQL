import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { store } from './store';

// In-system voice calls over WebRTC, signaled through a WebSocket the server
// relays (see attachCallSignaling in server.js). A call that can't reach the
// other side live still arrives as a push notification with Answer/Decline
// acted on directly — see public/sw.js — which is what lets a call "ring"
// someone whose tab isn't open at all.
export type CallStatus = 'idle' | 'calling' | 'incoming' | 'connecting' | 'connected' | 'ended';

interface CallState {
  status: CallStatus;
  callId: string | null;
  peerName: string;
  error: string | null;
  durationSec: number;
  muted: boolean;
  recording: boolean;
}

interface CallContextType extends CallState {
  startCall: (calleeId: string, calleeName: string) => void;
  answerCall: () => void;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  clearError: () => void;
}

const CallContext = createContext<CallContextType | null>(null);
export const useCall = () => useContext(CallContext)!;

// Answering from a notification used to go through window.__swiprJoinCall, set
// by a CallProvider effect. React runs child effects before parent ones, so on
// a cold start — exactly the case where the app was closed and opened by the
// notification — the deep-link route fired before that assignment existed and
// the tap did nothing. Queue it here instead, and let the provider drain it.
let pendingDeepLinkCall: string | null = null;
let joinHandler: ((callId: string) => void) | null = null;

export function requestJoinCall(callId: string) {
  if (joinHandler) joinHandler(callId);
  else pendingDeepLinkCall = callId;
}

const WS_RECONNECT_MS = 4000;
// A browser can't send WebSocket ping frames, so we ping at the app level.
// Without this, Railway's proxy drops the idle connection — usually without a
// close frame, so readyState still reads OPEN and every message we "send"
// disappears. The pong deadline is what actually detects that.
const WS_PING_MS = 25000;
const WS_PONG_GRACE_MS = 10000;
const WS_OPEN_TIMEOUT_MS = 12000;
// If the server hasn't acknowledged our offer by now, the call never left the
// building — better to say so than to spin on "calling…" forever.
const CALL_ACK_TIMEOUT_MS = 10000;
// A tick every 1.2s makes for a recognizable "ring" pattern from one tone,
// with no audio asset to ship or fail to load.
const RINGTONE_INTERVAL_MS = 1200;

function playTone(freq: number, ms: number) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = freq;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t); o.stop(t + ms / 1000 + 0.02);
    setTimeout(() => ctx.close().catch(() => {}), ms + 200);
  } catch { /* ignore — ringing is a nicety, never load-bearing */ }
}

export const CallProvider: React.FC<{ userId: string | null; children: React.ReactNode }> = ({ userId, children }) => {
  const [state, setState] = useState<CallState>({
    status: 'idle', callId: null, peerName: '', error: null, durationSec: 0, muted: false, recording: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const ringtoneTimerRef = useRef<any>(null);
  const durationTimerRef = useRef<any>(null);
  // The single source of truth for "which call are we in" — readable
  // synchronously from inside closures (onicecandidate fires well after the
  // render that created it) without stale-state problems. state.callId
  // mirrors it for the UI, but this ref is what the WebRTC/WS plumbing reads.
  const callIdRef = useRef<string | null>(null);
  const pendingRemoteIceRef = useRef<RTCIceCandidateInit[]>([]);
  // The caller doesn't learn the server-assigned call id until "call:started"
  // comes back, but ICE candidates can start flowing from the moment the
  // offer is created — buffered here until callIdRef is set, then flushed.
  const pendingLocalIceRef = useRef<RTCIceCandidateInit[]>([]);
  // A deep-link "Answer" tap can arrive before the socket finishes its
  // handshake (this is often a cold page load) — queued here and flushed
  // the moment the connection opens.
  const pendingJoinRef = useRef<string | null>(null);
  // Holds an offer whose auto-answer failed on the microphone, so the in-app
  // Answer button can retry it without a second round-trip to the server.
  const pendingOfferRef = useRef<{ callId: string; sdp: RTCSessionDescriptionInit; callerName: string } | null>(null);
  // answerCall is defined above handleOfferSdp; this keeps that reference
  // explicit rather than relying on closure timing.
  const handleOfferRef = useRef<((id: string, sdp: RTCSessionDescriptionInit, name: string) => void) | null>(null);
  // Recording: WebRTC audio is peer-to-peer, so the server never hears it.
  // The only place both voices exist together is inside a participant's
  // browser — mix them there and upload the result when the call ends.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const mixCtxRef = useRef<AudioContext | null>(null);
  const recordingCallIdRef = useRef<string | null>(null);
  const pingTimerRef = useRef<any>(null);
  const pongTimerRef = useRef<any>(null);
  const ackTimerRef = useRef<any>(null);
  // Lets startCall force a fresh socket when the current one looks dead.
  const reconnectNowRef = useRef<() => void>(() => {});

  const send = useCallback((obj: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }, []);

  const clearAckTimer = () => {
    if (ackTimerRef.current) { clearTimeout(ackTimerRef.current); ackTimerRef.current = null; }
  };

  // Mixes the local mic and the remote voice into one track and records it.
  // Recording is a nicety for the admin log — if anything here is unsupported
  // it must never take the call down with it.
  const startRecording = useCallback((remoteStream: MediaStream) => {
    try {
      if (recorderRef.current || typeof MediaRecorder === 'undefined') return;
      const local = localStreamRef.current;
      if (!local) return;

      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(local).connect(dest);
      ctx.createMediaStreamSource(remoteStream).connect(dest);
      mixCtxRef.current = ctx;

      // Opus in WebM is what Chrome/Edge/Android give us; Safari needs mp4.
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      recordedChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) recordedChunksRef.current.push(e.data); };
      rec.start(1000);
      recorderRef.current = rec;
      setState((s) => ({ ...s, recording: true }));
    } catch { /* recording unsupported here — the call itself carries on */ }
  }, []);

  // Finishes the recording and hands it to the server. Reads the call id from
  // a dedicated ref because cleanup clears callIdRef before this resolves.
  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    const callId = recordingCallIdRef.current;
    recorderRef.current = null;
    recordingCallIdRef.current = null;
    const ctx = mixCtxRef.current;
    mixCtxRef.current = null;
    if (!rec) { ctx?.close().catch(() => {}); return; }

    rec.onstop = () => {
      ctx?.close().catch(() => {});
      const chunks = recordedChunksRef.current;
      recordedChunksRef.current = [];
      if (!callId || !chunks.length) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (!blob.size) return;
      store.uploadCallRecording(callId, blob).catch(() => { /* history is best-effort */ });
    };
    try { rec.stop(); } catch { ctx?.close().catch(() => {}); }
  }, []);

  const stopRingtone = () => {
    if (ringtoneTimerRef.current) { clearInterval(ringtoneTimerRef.current); ringtoneTimerRef.current = null; }
  };
  const startRingtone = (incoming: boolean) => {
    stopRingtone();
    const tone = () => playTone(incoming ? 880 : 440, incoming ? 250 : 400);
    tone();
    ringtoneTimerRef.current = setInterval(tone, RINGTONE_INTERVAL_MS);
  };

  const stopDurationTimer = () => {
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
  };

  const flushLocalIce = useCallback(() => {
    if (!callIdRef.current || !pendingLocalIceRef.current.length) return;
    for (const c of pendingLocalIceRef.current) send({ type: 'call:ice', callId: callIdRef.current, candidate: c });
    pendingLocalIceRef.current = [];
  }, [send]);

  const cleanupCall = useCallback(() => {
    stopRingtone();
    stopDurationTimer();
    clearAckTimer();
    // Must run before the tracks are stopped below, or the recorder captures
    // a dead stream and the final chunk is lost.
    stopRecording();
    callIdRef.current = null;
    pendingRemoteIceRef.current = [];
    pendingLocalIceRef.current = [];
    pendingOfferRef.current = null;
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* ignore */ } pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, [stopRecording]);

  const resetToIdle = useCallback((error?: string) => {
    cleanupCall();
    setState({ status: 'idle', callId: null, peerName: '', error: error || null, durationSec: 0, muted: false, recording: false });
  }, [cleanupCall]);

  // Builds a fresh RTCPeerConnection. Reads callIdRef at send-time (not a
  // parameter) since the caller's side doesn't know the real call id until
  // just after this is created — see the callId-mismatch note on startCall.
  const buildPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const c = e.candidate.toJSON();
      if (callIdRef.current) send({ type: 'call:ice', callId: callIdRef.current, candidate: c });
      else pendingLocalIceRef.current.push(c);
    };
    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(() => { /* needs a user gesture on some browsers — the Answer tap already provided one */ });
      }
      // Both voices exist only from this point on, so this is the earliest
      // moment a complete recording can start.
      recordingCallIdRef.current = callIdRef.current;
      startRecording(e.streams[0]);
      stopRingtone();
      stopDurationTimer();
      durationTimerRef.current = setInterval(() => {
        setState((s) => (s.status === 'connected' ? { ...s, durationSec: s.durationSec + 1 } : s));
      }, 1000);
      setState((s) => ({ ...s, status: 'connected' }));
    };
    pcRef.current = pc;
    return pc;
  }, [send, startRecording]);

  // ---- Actions exposed to the UI -------------------------------------------

  const startCall = useCallback(async (calleeId: string, calleeName: string) => {
    if (state.status !== 'idle') return;
    // A socket that isn't open can't carry the offer, and silently dropping it
    // is what strands the caller on "calling…". Reconnect and say so instead.
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      reconnectNowRef.current();
      resetToIdle('call.err.offline');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const pc = buildPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // callId isn't known yet — the server assigns it and tells us via
      // "call:started"; ICE candidates generated before then queue in
      // pendingLocalIceRef (see buildPeerConnection) and flush once it does.
      if (!send({ type: 'call:offer', calleeId, sdp: offer })) {
        reconnectNowRef.current();
        resetToIdle('call.err.offline');
        return;
      }
      setState({ status: 'calling', callId: null, peerName: calleeName, error: null, durationSec: 0, muted: false, recording: false });
      startRingtone(false);
      // The socket claimed to accept the offer, but a half-open connection
      // claims that too. Only a reply proves the call really started.
      clearAckTimer();
      ackTimerRef.current = setTimeout(() => {
        if (!callIdRef.current) {
          reconnectNowRef.current();
          resetToIdle('call.err.noack');
        }
      }, CALL_ACK_TIMEOUT_MS);
    } catch {
      resetToIdle('call.err.mic');
    }
  }, [state.status, buildPeerConnection, send, resetToIdle]);

  const answerCall = useCallback(() => {
    if (!callIdRef.current) return;
    // If a notification-triggered auto-answer already fetched the offer and
    // only failed on the microphone, answer from the copy we kept: it saves a
    // round-trip and still works if the socket is mid-reconnect, which is
    // likely on a phone that just woke up.
    const pending = pendingOfferRef.current;
    if (pending && pending.callId === callIdRef.current && handleOfferRef.current) {
      setState((s) => ({ ...s, status: 'connecting', error: null }));
      handleOfferRef.current(pending.callId, pending.sdp, pending.callerName);
      return;
    }
    send({ type: 'call:pickup', callId: callIdRef.current });
    setState((s) => ({ ...s, status: 'connecting' }));
  }, [send]);

  const declineCall = useCallback(() => {
    if (callIdRef.current) send({ type: 'call:decline', callId: callIdRef.current });
    resetToIdle();
  }, [send, resetToIdle]);

  const endCall = useCallback(() => {
    if (callIdRef.current) send({ type: 'call:end', callId: callIdRef.current });
    resetToIdle();
  }, [send, resetToIdle]);

  const clearError = useCallback(() => setState((s) => (s.error ? { ...s, error: null } : s)), []);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !state.muted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setState((s) => ({ ...s, muted: next }));
  }, [state.muted]);

  // Answers whichever call the "Answer" notification action pointed at, once
  // the socket is up — used by the /#/call/:id deep link route.
  const joinCallById = useCallback((callId: string) => {
    callIdRef.current = callId;
    setState((s) => (s.callId ? s : { ...s, status: 'connecting', callId }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: 'call:pickup', callId });
    } else {
      pendingJoinRef.current = callId;
    }
  }, [send]);

  // ---- Answering: once we have the caller's offer, build our side --------
  const handleOfferSdp = useCallback(async (callId: string, sdp: RTCSessionDescriptionInit, callerName: string) => {
    callIdRef.current = callId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const pc = buildPeerConnection();
      await pc.setRemoteDescription(sdp);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      for (const c of pendingRemoteIceRef.current) await pc.addIceCandidate(c).catch(() => {});
      pendingRemoteIceRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      pendingOfferRef.current = null;
      setState((s) => ({ ...s, status: 'connecting', callId, peerName: callerName || s.peerName }));
      send({ type: 'call:answer', callId, sdp: answer });
    } catch {
      // Do NOT decline here. Opening the app from a notification gives the page
      // no user activation, so mobile browsers refuse the microphone on this
      // first attempt — declining would tell the caller they were rejected when
      // nobody rejected anything. Keep the call ringing and show the in-app
      // Answer button: tapping that is a real gesture and the mic is allowed.
      pendingOfferRef.current = { callId, sdp, callerName };
      setState((s) => ({
        ...s, status: 'incoming', callId,
        peerName: callerName || s.peerName, error: 'call.err.tapAnswer',
      }));
    }
  }, [buildPeerConnection, send]);

  handleOfferRef.current = handleOfferSdp;

  // ---- WebSocket lifecycle --------------------------------------------------
  useEffect(() => {
    if (!userId) {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      return;
    }

    let cancelled = false;

    store.getIceServers().then((servers) => { iceServersRef.current = servers; }).catch(() => {});

    const stopPing = () => {
      if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
      if (pongTimerRef.current) { clearTimeout(pongTimerRef.current); pongTimerRef.current = null; }
    };

    const connect = () => {
      if (cancelled) return;
      const token = (() => { try { return localStorage.getItem('swipr_token'); } catch { return null; } })();
      if (!token) return;
      // Drop any previous socket first, so a forced reconnect can't leave two
      // live connections racing to handle the same call.
      stopPing();
      if (wsRef.current) {
        const old = wsRef.current;
        old.onclose = null; old.onmessage = null; old.onerror = null; old.onopen = null;
        try { old.close(); } catch { /* already gone */ }
        wsRef.current = null;
      }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      // A handshake that never completes leaves the socket in CONNECTING, where
      // neither onopen nor onclose fires and nothing would ever retry.
      const openDeadline = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) { try { ws.close(); } catch { /* already gone */ } }
      }, WS_OPEN_TIMEOUT_MS);

      ws.onmessage = (evt) => {
        let msg: any;
        try { msg = JSON.parse(evt.data); } catch { return; }

        switch (msg.type) {
          case 'pong':
            if (pongTimerRef.current) { clearTimeout(pongTimerRef.current); pongTimerRef.current = null; }
            break;
          case 'call:started':
            clearAckTimer();
            // The offer we just sent is now a real call — adopt the
            // server's id and send along anything ICE queued while we
            // didn't have one yet.
            callIdRef.current = msg.callId;
            setState((s) => ({ ...s, callId: msg.callId }));
            flushLocalIce();
            break;
          case 'call:incoming':
            callIdRef.current = msg.callId;
            setState({ status: 'incoming', callId: msg.callId, peerName: msg.callerName, error: null, durationSec: 0, muted: false, recording: false });
            startRingtone(true);
            break;
          case 'call:offer-sdp':
            handleOfferSdp(msg.callId, msg.sdp, msg.callerName);
            break;
          case 'call:answered':
            (async () => {
              const pc = pcRef.current;
              if (!pc) return;
              await pc.setRemoteDescription(msg.sdp);
              for (const c of pendingRemoteIceRef.current) await pc.addIceCandidate(c).catch(() => {});
              pendingRemoteIceRef.current = [];
            })();
            break;
          case 'call:ice':
            if (pcRef.current?.remoteDescription) {
              pcRef.current.addIceCandidate(msg.candidate).catch(() => {});
            } else {
              pendingRemoteIceRef.current.push(msg.candidate);
            }
            break;
          case 'call:ended':
            resetToIdle();
            break;
          case 'call:declined':
            resetToIdle('call.err.declined');
            break;
          case 'call:missed':
            resetToIdle('call.err.noanswer');
            break;
          case 'call:invalid':
          case 'call:error':
            resetToIdle(msg.error || 'call.err.gone');
            break;
        }
      };

      ws.onopen = () => {
        clearTimeout(openDeadline);
        stopPing();
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'ping' }));
          // No pong in time means the link is dead even though the browser
          // still calls it OPEN — tear it down so onclose triggers a reconnect.
          if (!pongTimerRef.current) {
            pongTimerRef.current = setTimeout(() => {
              pongTimerRef.current = null;
              try { ws.close(); } catch { /* already gone */ }
            }, WS_PONG_GRACE_MS);
          }
        }, WS_PING_MS);

        if (pendingJoinRef.current) {
          send({ type: 'call:pickup', callId: pendingJoinRef.current });
          pendingJoinRef.current = null;
        }
      };
      ws.onclose = () => {
        clearTimeout(openDeadline);
        stopPing();
        if (cancelled || wsRef.current !== ws) return;
        reconnectTimerRef.current = setTimeout(connect, WS_RECONNECT_MS);
      };
      ws.onerror = () => ws.close();
    };

    reconnectNowRef.current = () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      connect();
    };

    // Phones suspend background tabs and kill the socket without telling the
    // page. Coming back to the app is the moment to make sure we're reachable
    // again — otherwise the first call after unlocking silently fails.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) reconnectNowRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    connect();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      stopPing();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Registers the deep-link handler for the /#/call/:id route, and picks up any
  // tap that arrived before this provider had mounted — the cold-start case,
  // which is precisely when someone answers from a notification.
  useEffect(() => {
    joinHandler = joinCallById;
    if (pendingDeepLinkCall) {
      const queued = pendingDeepLinkCall;
      pendingDeepLinkCall = null;
      joinCallById(queued);
    }
    return () => { if (joinHandler === joinCallById) joinHandler = null; };
  }, [joinCallById]);

  return (
    <CallContext.Provider value={{ ...state, startCall, answerCall, declineCall, endCall, toggleMute, clearError }}>
      {children}
      <audio ref={remoteAudioRef} autoPlay />
    </CallContext.Provider>
  );
};
