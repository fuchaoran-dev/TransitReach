// Internal companion to check-meeting-online.py. Session tokens arrive through
// stdin, remain in memory and are sent only to their issuing Supabase project.
import { createClient } from '@supabase/supabase-js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const settings = JSON.parse(input);
const client = createClient(settings.url, settings.key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
await client.realtime.setAuth(settings.viewerToken);
let channel;
let timer;
try {
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Room realtime update timed out')), 25000);
    let started = false;
    channel = client.channel(`qa-room:${settings.room}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'meeting_rooms', filter: `code=eq.${settings.room}`,
      }, message => {
        const row = message.new;
        if (row.code !== settings.room ||
            new Date(row.proposed_arrival_time).getTime() !== new Date(settings.proposedTime).getTime()) return;
        const sharedFields = new Set([
          'code', 'time_budget', 'created_at', 'updated_at', 'expires_at',
          'confirmed_venue', 'confirmed_arrival_time', 'plan_version',
          'proposed_arrival_time', 'planning_revision',
        ]);
        if (Object.keys(row).some(key => !sharedFields.has(key))) {
          reject(new Error('Realtime room payload exposed private fields'));
          return;
        }
        resolve();
      })
      .on('system', {}, async message => {
        if (message.extension !== 'postgres_changes') return;
        if (message.status !== 'ok') {
          reject(new Error('Database realtime stream could not subscribe'));
          return;
        }
        if (started) return;
        started = true;
        try {
          const response = await fetch(`${settings.url}/rest/v1/rpc/propose_meeting_time`, {
            method: 'POST', headers: {
              apikey: settings.key, Authorization: `Bearer ${settings.writerToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_code: settings.room, p_arrival_time: settings.proposedTime }),
          });
          if (!response.ok) reject(new Error(`Peer proposal returned HTTP ${response.status}`));
        } catch {
          reject(new Error('Peer proposal request failed'));
        }
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Room subscription failed'));
      });
  });
  console.log('PASS Cross-session room realtime update excludes private fields');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  if (channel) await client.removeChannel(channel);
  client.realtime.disconnect();
}
