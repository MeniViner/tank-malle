import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as NativeApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { localDay } from '../lib/maintenance/model';
import { loadReminderInputs } from '../lib/native/reminderSource';
import { planReminders } from '../lib/native/reminderPlan';
import { clearNativeReminders, reconcileNativeReminders, reminderCleanupPending, reminderOwner, REMINDERS_CHANGED } from '../lib/native/reminders';
import { TankRemotePush, remotePushConfigured, refreshRemotePush, releaseRemotePush, type RemoteTap } from '../lib/native/remotePush';
import { parseNotificationLink } from '../lib/push/link';

export default function NativeShell() {
  const { user, loading, signingOut } = useAuth();
  const data = useData();
  const vehicle = useVehicleData();
  const navigate = useNavigate();
  const uid = user?.uid;
  const [revision, setRevision] = useState(0);
  const pendingTap = useRef<{ uid: string; route: string; remote?: boolean } | null>(null);

  useEffect(() => {
    if (loading || !uid || signingOut) return;
    if (data.accountDeletionPending) {
      void releaseRemotePush(uid).catch(() => {});
      return;
    }
    let active = true;
    const refresh = () => { void refreshRemotePush(uid, () => active).catch(() => {}); };
    let handle: PluginListenerHandle | undefined;
    const onTap = ({ uid: owner, route }: RemoteTap) => {
      if (!active || owner !== uid || !route ||
        (route !== '/notifications' && (!route.startsWith('/open?') || !parseNotificationLink(new URLSearchParams(route.slice(6)))))) return;
      pendingTap.current = { uid, route, remote: true };
      setRevision(value => value + 1);
    };
    window.addEventListener('online', refresh);
    void remotePushConfigured().then(async supported => {
      if (!active || !supported) return;
      refresh();
      handle = await TankRemotePush.addListener('tap', onTap);
      if (!active) { await handle.remove(); return; }
      onTap(await TankRemotePush.takeTap());
    }).catch(() => {});
    return () => {
      active = false;
      window.removeEventListener('online', refresh);
      void handle?.remove();
    };
  }, [uid, loading, signingOut, data.accountDeletionPending]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('online', refresh);
    window.addEventListener(REMINDERS_CHANGED, refresh);
    let stopped = false;
    let handles: PluginListenerHandle[] = [];
    void Promise.allSettled([
      NativeApp.addListener('appStateChange', state => { if (state.isActive) refresh(); }),
      LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
        const { uid, route } = notification.extra ?? {};
        if (typeof uid !== 'string' || typeof route !== 'string' || !route.startsWith('/open?')) return;
        if (parseNotificationLink(new URLSearchParams(route.slice(6)))) {
          pendingTap.current = { uid, route };
          refresh();
        }
      }),
    ]).then(results => {
      handles = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (stopped) handles.forEach(handle => { void handle.remove(); });
    });
    return () => {
      stopped = true;
      handles.forEach(handle => { void handle.remove(); });
      window.removeEventListener('online', refresh);
      window.removeEventListener(REMINDERS_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    const tap = pendingTap.current;
    if (loading || !tap) return;
    if (tap.uid !== uid || (!tap.remote && reminderOwner() !== uid) || data.accountDeletionPending) pendingTap.current = null;
    else if (data.ready) {
      pendingTap.current = null;
      navigate(tap.route);
    }
  }, [loading, uid, data.ready, data.accountDeletionPending, navigate, revision]);

  useEffect(() => {
    if (loading) return;
    const owner = reminderOwner();
    if (!owner) {
      if (reminderCleanupPending()) void clearNativeReminders().catch(() => {});
      return;
    }
    if (uid !== owner || data.accountDeletionPending) {
      void clearNativeReminders().catch(() => {});
      return;
    }
    if (signingOut || !data.ready || data.fromCache || data.offline || data.outbox.length || data.writes.pending.length) return;

    let active = true;
    const timeout = window.setTimeout(() => {
      const now = new Date();
      void loadReminderInputs(uid, data.activeVehicles, data.settings, localDay(now)).then(inputs => {
        if (!active) return;
        const candidates = inputs.flatMap(input => planReminders(input, now)).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
        return reconcileNativeReminders(uid, candidates, () => active);
      }).catch(() => {
        // Keep the previous OS schedule if a fresh snapshot was unavailable.
      });
    }, 650);
    return () => { active = false; clearTimeout(timeout); };
  }, [uid, loading, signingOut, data.ready, data.accountDeletionPending, data.fromCache, data.offline, data.outbox.length, data.writes.pending.length,
    data.activeVehicles, data.settings, vehicle.care.data, vehicle.extra.notificationStates, data.fillups, data.observations, revision]);

  return null;
}
